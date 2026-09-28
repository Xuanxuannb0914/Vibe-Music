/**
 * Aura — Electron 主进程
 *
 * 职责边界：
 *   1. 创建并托管渲染窗口（macOS 使用 hiddenInset 原生交通灯，内容区自绘标题栏）
 *   2. 持久化窗口尺寸与「数据源 / QQ 音乐凭据」配置到 userData
 *   3. 为音乐 CDN 放行 CORS，使 Web Audio 频谱分析器能读取真实音频数据
 *   4. 注册系统媒体键，把播放控制转发给渲染层
 *
 * 注意：本进程不承担任何音乐业务逻辑，渲染层在浏览器中单独打开时功能同样完整。
 */
const { app, BrowserWindow, ipcMain, shell, dialog, session, globalShortcut, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const isDev = process.argv.includes('--dev');
const APP_ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------------------ *
 * 渲染层自定义协议
 *
 * 为什么不用 file://：file:// 页面被视为「不透明源」，
 *   - 把本地封面图绘制到 canvas 后会被判定跨域污染，getImageData 抛错，
 *     「封面主色驱动氛围光」这一核心特性将无法工作；
 *   - fetch 与部分 Web API 也受限。
 * 改用标准协议 aura://app/* 后，渲染层拥有真实的同源，上述问题一并解决。
 * ------------------------------------------------------------------ */

const RENDERER_SCHEME = 'aura';
const RENDERER_HOST = 'app';
const RENDERER_DIR = path.join(APP_ROOT, 'app');
const RENDERER_ENTRY = path.join(RENDERER_DIR, 'index.html');
const RENDERER_URL = `${RENDERER_SCHEME}://${RENDERER_HOST}/index.html`;

protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

function registerRendererProtocol() {
  protocol.handle(RENDERER_SCHEME, async (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
    if (url.host !== RENDERER_HOST) {
      return new Response('Not Found', { status: 404 });
    }

    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const resolved = path.resolve(RENDERER_DIR, relative);

    // 目录穿越防护：解析结果必须仍位于渲染层目录内
    if (resolved !== RENDERER_DIR && !resolved.startsWith(RENDERER_DIR + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      return await net.fetch(pathToFileURL(resolved).toString());
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });
}

/* ------------------------------------------------------------------ *
 * 配置持久化
 * ------------------------------------------------------------------ */

const CONFIG_PATH = path.join(app.getPath('userData'), 'app-config.json');
const WINDOW_STATE_PATH = path.join(app.getPath('userData'), 'window-state.json');

const DEFAULT_CONFIG = {
  /** 数据源：mock = 内置离线演示数据；qq = 真实 QQ 音乐第三方接口 */
  dataSource: 'mock',
  qq: {
    /** 第三方 QQ 音乐 API 服务地址，例如 http://localhost:3300 */
    apiBase: 'http://localhost:3300',
    /** 登录态 Cookie（uin + qqmusic_key 等），仅保存在本机 userData 中 */
    cookie: '',
    /** 音质：128 | 320 | flac */
    quality: '128',
  },
  /** 允许放行 CORS 的音频/接口域名（用于频谱分析读取真实音频数据） */
  corsAllowHosts: ['qq.com', 'qqmusic.qq.com', 'stream.qqmusic.qq.com', 'tc.qq.com'],
};

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[aura] 写入配置失败:', file, err.message);
  }
}

function loadConfig() {
  return Object.assign({}, DEFAULT_CONFIG, readJSON(CONFIG_PATH, {}), {
    qq: Object.assign({}, DEFAULT_CONFIG.qq, readJSON(CONFIG_PATH, {}).qq || {}),
  });
}

let config = loadConfig();

/* ------------------------------------------------------------------ *
 * 窗口
 * ------------------------------------------------------------------ */

const DEFAULT_BOUNDS = { width: 1320, height: 860 };
let mainWindow = null;

function loadWindowState() {
  const saved = readJSON(WINDOW_STATE_PATH, {});
  return {
    width: saved.width || DEFAULT_BOUNDS.width,
    height: saved.height || DEFAULT_BOUNDS.height,
    x: saved.x,
    y: saved.y,
  };
}

let saveBoundsTimer = null;
function scheduleSaveBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    writeJSON(WINDOW_STATE_PATH, Object.assign(bounds, { maximized: mainWindow.isMaximized() }));
  }, 400);
}

function createWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    backgroundColor: '#0a0a0d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 18, y: 22 },
    title: 'Aura',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      webSecurity: true,
    },
  });

  mainWindow.loadURL(RENDERER_URL).catch(() => mainWindow.loadFile(RENDERER_ENTRY));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (state.maximized) mainWindow.maximize();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  ['resize', 'move'].forEach((evt) => mainWindow.on(evt, scheduleSaveBounds));
  mainWindow.on('maximize', () => mainWindow.webContents.send('win:maximized-changed', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('win:maximized-changed', false));
  mainWindow.on('closed', () => { mainWindow = null; });

  // 站外链接一律交给系统浏览器，不在应用内开新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
}

/* ------------------------------------------------------------------ *
 * CORS 放行
 *
 * 频谱可视化需要 Web Audio 的 AnalyserNode 读取音频采样。
 * 当音频来自第三方 CDN 且未返回 CORS 头时，媒体元素会被标记为「跨域污染」，
 * 分析结果恒为静音。这里仅对配置白名单内的域名补上 CORS 头，
 * 不关闭 webSecurity，也不影响其它任何请求。
 * ------------------------------------------------------------------ */

function installCorsRelaxation() {
  const hosts = (config.corsAllowHosts || []).filter(Boolean);
  if (!hosts.length) return;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url || '';
    const matched = hosts.some((host) => url.includes(host));
    if (!matched) return callback({ responseHeaders: details.responseHeaders });

    const headers = Object.assign({}, details.responseHeaders, {
      'Access-Control-Allow-Origin': ['*'],
      'Access-Control-Allow-Methods': ['GET, HEAD, OPTIONS'],
      'Access-Control-Allow-Headers': ['*'],
      'Access-Control-Expose-Headers': ['*'],
    });
    callback({ responseHeaders: headers });
  });
}

/* ------------------------------------------------------------------ *
 * 媒体键
 * ------------------------------------------------------------------ */

function registerMediaKeys() {
  const bindings = {
    MediaPlayPause: 'playpause',
    MediaNextTrack: 'next',
    MediaPreviousTrack: 'prev',
    MediaStop: 'stop',
  };
  Object.entries(bindings).forEach(([accelerator, action]) => {
    try {
      globalShortcut.register(accelerator, () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('media-key', action);
        }
      });
    } catch {
      // 部分平台/权限下注册失败不影响应用运行
    }
  });
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

function registerIPC() {
  ipcMain.handle('win:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.handle('win:maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('win:close', () => mainWindow && mainWindow.close());
  ipcMain.handle('win:is-maximized', () => !!mainWindow && mainWindow.isMaximized());

  ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:set', (_e, patch) => {
    const next = Object.assign({}, config, patch || {});
    if (patch && patch.qq) next.qq = Object.assign({}, config.qq, patch.qq);
    config = next;
    writeJSON(CONFIG_PATH, config);
    return config;
  });

  ipcMain.handle('shell:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url);
    return false;
  });

  ipcMain.handle('dialog:pick-files', async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择本地音乐',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '音频文件', extensions: ['mp3', 'm4a', 'flac', 'wav', 'aac', 'ogg', 'opus'] }],
    });
    if (result.canceled) return [];
    return result.filePaths.map((filePath) => ({
      path: filePath,
      name: path.basename(filePath, path.extname(filePath)),
      url: `file://${filePath.split(path.sep).map(encodeURIComponent).join('/')}`,
    }));
  });

  ipcMain.handle('api:request', (_e, payload) => proxyApiRequest(payload));
}

/**
 * 代理 QQ 音乐第三方接口请求。
 *
 * 为什么必须放在主进程：
 *   1. 浏览器的 fetch 禁止设置 Cookie 头，而 QQ 音乐接口需要登录态 Cookie；
 *   2. 第三方接口通常不返回 CORS 头，渲染层直连会被拦截。
 * 安全约束：只允许访问「设置里配置的 API 地址」所在源，避免变成任意请求代理。
 */
async function proxyApiRequest(payload) {
  const { url, method = 'GET', headers = {}, body } = payload || {};

  let target;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, status: 0, error: '请求地址无效' };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { ok: false, status: 0, error: '仅支持 http / https 协议' };
  }

  let allowed;
  try {
    allowed = new URL(config.qq.apiBase);
  } catch {
    return { ok: false, status: 0, error: '尚未配置有效的 API 地址' };
  }
  if (target.origin !== allowed.origin) {
    return { ok: false, status: 0, error: `已拒绝跨域请求，仅允许访问 ${allowed.origin}` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(target.toString(), {
      method,
      headers: Object.assign(
        { 'User-Agent': 'Aura/0.1 (+https://example.local)', Accept: 'application/json, text/plain, */*' },
        headers
      ),
      body: body || undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      text,
      contentType: res.headers.get('content-type') || '',
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err.name === 'AbortError' ? '请求超时（12 秒）' : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * 生命周期
 * ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerRendererProtocol();
    installCorsRelaxation();
    registerIPC();
    createWindow();
    registerMediaKeys();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
