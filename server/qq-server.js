#!/usr/bin/env node
/**
 * Aura · QQ 音乐本地后端
 *
 * QQ 音乐没有公开 API，但它自家 Web 播放器调用的一组接口是稳定可用的。
 * 这个进程把那些接口包一层，翻译成 docs/backend-contract.md 约定的统一结构，
 * 让渲染层的 qq-adapter.js 可以零改动地拿到真实曲库。
 *
 * 为什么需要它：
 *   1. 浏览器不能设置 Cookie 头，也无法跨域直连 QQ；主进程代理解决了这一点，
 *      但仍需要一个「地址稳定、结构统一」的目标，而不是让前端去猜 QQ 的字段。
 *   2. QQ 同一份数据在不同接口里字段名不一致（songmid / mid / strMediaMid…），
 *      归一化的脏活集中在这里做一次，前端只认一套结构。
 *
 * 零第三方依赖，只用 Node 内置模块。启动：npm run qq-server
 *
 * 说明：不登录也能拿到搜索结果、专辑/歌单详情与歌词，但只有非付费曲目能解析出
 * 128k 播放地址；付费曲目需要在应用设置里填登录 Cookie。
 */
'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const tls = require('node:tls');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3300);
const HOST = process.env.HOST || '127.0.0.1';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 部分环境（公司代理、杀软或自签根证书）下 Node 自带的根证书链不完整，
 * 直连 u.y.qq.com 会报「unable to get local issuer certificate」。
 * 把操作系统信任库一起交给 TLS 校验即可，不需要用户改环境变量。
 */
function buildCaBundle() {
  const bundle = [];
  ['/etc/ssl/cert.pem', '/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/certs/ca-certificates.crt'].forEach(
    (file) => {
      try {
        bundle.push(fs.readFileSync(file, 'utf8'));
      } catch {
        /* 该平台没有这个文件，跳过 */
      }
    }
  );
  try {
    bundle.push(...tls.getCACertificates('default'));
  } catch {
    /* 旧版 Node 没有这个 API，忽略 */
  }
  return bundle.length ? bundle : undefined;
}

const HTTPS_AGENT = new https.Agent({ ca: buildCaBundle(), keepAlive: true });

/** 现代接口统一走 musicu.fcg，comm 里的 ct/cv 决定 QQ 走哪套网关协议 */
const COMM = { ct: 24, cv: 0, uin: '0', format: 'json', platform: 'yqq.json', needNewCode: 0 };
/** 搜索接口要求 ct=19 / cv=1859，与其它接口不同 */
const SEARCH_COMM = Object.assign({}, COMM, { ct: 19, cv: 1859 });

/** 音质档位 → 文件名前缀与后缀。QQ 用文件名前缀区分码率。 */
const FILE_TYPES = {
  '128': { prefix: 'M500', ext: '.mp3' },
  '320': { prefix: 'M800', ext: '.mp3' },
  flac: { prefix: 'F000', ext: '.flac' },
  m4a: { prefix: 'C400', ext: '.m4a' },
};

/** 排行榜：id 直接用 QQ 的 topid，/playlist 能识别这类短数字 id */
const TOP_LISTS = [
  { id: 4, title: '飙升榜' },
  { id: 26, title: '热歌榜' },
  { id: 27, title: '新歌榜' },
  { id: 62, title: '欧美榜' },
  { id: 58, title: '韩国榜' },
  { id: 59, title: '日本榜' },
];

/* ------------------------------------------------------------------ *
 * 基础请求
 * ------------------------------------------------------------------ */

function pick(obj, paths, fallback) {
  for (let i = 0; i < paths.length; i += 1) {
    let cursor = obj;
    const parts = paths[i].split('.');
    let ok = true;
    for (let j = 0; j < parts.length; j += 1) {
      if (cursor == null || typeof cursor !== 'object') { ok = false; break; }
      cursor = cursor[parts[j]];
    }
    if (ok && cursor != null && cursor !== '') return cursor;
  }
  return fallback;
}

function firstArray() {
  for (let i = 0; i < arguments.length; i += 1) {
    if (Array.isArray(arguments[i]) && arguments[i].length) return arguments[i];
  }
  return [];
}

function fetchText(url, extraHeaders) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: target.pathname + target.search,
        method: 'GET',
        agent: target.protocol === 'https:' ? HTTPS_AGENT : undefined,
        headers: Object.assign(
          { 'User-Agent': UA, Referer: 'https://y.qq.com/', Accept: '*/*' },
          extraHeaders || {}
        ),
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`上游返回 HTTP ${res.statusCode}`));
            return;
          }
          resolve(text);
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('上游请求超时')));
    req.end();
  });
}

async function fetchJson(url, extraHeaders) {
  const text = await fetchText(url, extraHeaders);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('上游返回的不是合法 JSON');
  }
}

/**
 * 登录流程要读响应头里的 Set-Cookie、要拿二维码的原始字节，还要发 POST 表单，
 * fetchText 只回字符串且在非 2xx 时直接抛错，满足不了，所以单开一个。
 * 注意它从不跟随重定向：OAuth 的授权码就藏在 302 的 Location 里。
 */
function rawRequest(url, options) {
  const opts = options || {};
  const body = opts.body == null ? null : Buffer.from(opts.body);
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const mod = target.protocol === 'https:' ? https : http;
    const headers = Object.assign({ 'User-Agent': UA, Accept: '*/*' }, opts.headers || {});
    if (body) headers['Content-Length'] = body.length;
    const req = mod.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: target.pathname + target.search,
        method: opts.method || 'GET',
        agent: target.protocol === 'https:' ? HTTPS_AGENT : undefined,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('上游请求超时')));
    if (body) req.write(body);
    req.end();
  });
}

/** 现代接口：POST 表单承载 JSON 会被拒，必须用 GET 查询串 */
function musicu(payload) {
  const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=' + encodeURIComponent(JSON.stringify(payload));
  return fetchJson(url);
}

/** 老接口：c.y.qq.com 上仍可用的一批 fcg 端点 */
function legacy(path, params, extraHeaders) {
  const pairs = Object.keys(params || {})
    .filter((key) => params[key] != null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`);
  const url = `https://c.y.qq.com${path}?${pairs.join('&')}`;
  return fetchJson(url, extraHeaders);
}

/* ------------------------------------------------------------------ *
 * 归一化：QQ 结构 → 统一结构
 * ------------------------------------------------------------------ */

/**
 * 同时吃两种上游形态：
 *   现代（搜索/歌手歌单）：{ mid, name, singer:[{mid,name}], album:{mid,name}, interval }
 *   老接口（专辑/歌单/榜单）：{ songmid, songname, singer:[…], albummid, albumname, songid, interval }
 */
function normalizeSong(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mid = pick(raw, ['mid', 'songmid', 'song_mid'], '');
  if (!mid) return null;

  const singers = firstArray(raw.singer, raw.singers, []);
  const albumRaw = raw.album && typeof raw.album === 'object' ? raw.album : null;
  const albumMid = pick(albumRaw, ['mid'], '') || pick(raw, ['albummid', 'album_mid'], '');
  const albumName = pick(albumRaw, ['name'], '') || pick(raw, ['albumname', 'album_name'], '');
  const albumId = pick(albumRaw, ['id'], null) || pick(raw, ['albumid'], null);

  return {
    mid,
    id: pick(raw, ['id', 'songid', 'song_id'], null),
    name: pick(raw, ['name', 'songname', 'title'], '未知曲目'),
    interval: Number(pick(raw, ['interval', 'duration'], 0)) || 0,
    singer: singers.map((item) => ({
      mid: pick(item, ['mid', 'singer_mid'], ''),
      name: pick(item, ['name', 'singer_name'], ''),
    })),
    album: albumMid || albumName ? { mid: albumMid, id: albumId, name: albumName } : null,
  };
}

function normalizeArtist(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mid = pick(raw, ['mid', 'singer_mid', 'Fsinger_mid', 'singerMid'], '');
  const name = pick(raw, ['name', 'singer_name', 'Fsinger_name', 'title'], '');
  if (!mid && !name) return null;
  return {
    mid,
    name: name || '未知艺人',
    desc: pick(raw, ['desc', 'briefDesc', 'Fother_name'], ''),
  };
}

function normalizeAlbum(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mid = pick(raw, ['mid', 'albummid', 'album_mid'], '');
  if (!mid) return null;
  // 老专辑接口只给 singername / singermid 两个平铺字段，没有 singer 数组
  let singers = firstArray(raw.singer, raw.singers, [])
    .map(normalizeArtist)
    .filter(Boolean);
  if (!singers.length && (raw.singername || raw.singermid)) {
    const artist = normalizeArtist({ name: raw.singername, mid: raw.singermid });
    if (artist) singers = [artist];
  }
  return {
    mid,
    id: pick(raw, ['id', 'albumid'], null),
    name: pick(raw, ['name', 'albumname', 'title'], '未知专辑'),
    time_public: pick(raw, ['aDate', 'time_public', 'publish_date'], ''),
    songnum: Number(pick(raw, ['songnum', 'song_count', 'total_song_num'], 0)) || 0,
    singer: singers,
  };
}

function normalizePlaylist(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const disstid = pick(raw, ['disstid', 'dissid', 'tid', 'id', 'content_id'], '');
  if (!disstid) return null;
  return {
    disstid: String(disstid),
    dissname: pick(raw, ['dissname', 'title', 'name'], '未命名歌单'),
    introduction: pick(raw, ['introduction', 'desc', 'subtitle'], ''),
    nickname: pick(raw, ['nickname', 'nick', 'creator.nick', 'creator.name'], 'QQ 音乐'),
    logo: pick(raw, ['logo', 'cover', 'picurl'], ''),
    songnum: Number(pick(raw, ['songnum', 'song_cnt', 'total', 'cur_song_num'], 0)) || 0,
  };
}

/** QQ 的歌词接口返回 base64，老接口返回明文，两种都要能认 */
function decodeLyric(text) {
  if (!text) return '';
  const decoded = Buffer.from(text, 'base64').toString('utf8');
  // 解出来带 LRC 时间戳才说明它确实是 base64，否则原文本来就是明文
  return /\[\d{2}:\d{2}/.test(decoded) ? decoded : text;
}

/* ------------------------------------------------------------------ *
 * Cookie：登录态只在本地内存里传递，不落盘
 * ------------------------------------------------------------------ */

function readCookie(header) {
  const jar = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const index = part.indexOf('=');
      if (index > 0) jar[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    });
  // QQ 的 uin cookie 常带 o 前缀（o0123456789），但接口参数要纯数字
  const rawUin = jar.qqmusic_uin || jar.uin || jar.wxuin || '';
  return {
    uin: String(rawUin).replace(/^o/, ''),
    authst: jar.qqmusic_key || jar.qm_keyst || jar.authst || '',
    header: header || '',
  };
}

/* ------------------------------------------------------------------ *
 * 扫码登录
 *
 * QQ 音乐 Web 的登录入口是 ptlogin2 的二维码流程：
 *   1. ptqrshow 取二维码图片，同时拿到 qrsig —— 它是这次登录的种子
 *   2. 由 qrsig 算出 ptqrtoken，轮询 ptqrlogin 等用户扫码并在手机上确认
 *   3. 确认后 QQ 回一条 check_sig 跳转链，跟着走完就能拿到 qqmusic_key
 *
 * qrsig 全程留在服务端内存里，前端只拿到「图片 + 状态」，不接触登录种子。
 * 会话只存内存、3 分钟过期，进程退出即失效。
 * ------------------------------------------------------------------ */

const PTLOGIN_APPID = '716027609';
const PTLOGIN_DAID = '383';
const PT_3RD_AID = '100497308';
const LOGIN_TTL = 3 * 60 * 1000;

const loginSessions = new Map();

/** QQ 的 ptqrtoken 算法：对 qrsig 逐字符做 hash33，再取低 31 位 */
function hash33(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash += (hash << 5) + text.charCodeAt(i);
  return hash & 2147483647;
}

function cookieJar(seed) {
  const jar = Object.assign({}, seed || {});
  return {
    get: () => Object.assign({}, jar),
    header: () => Object.keys(jar).map((name) => `${name}=${jar[name]}`).join('; '),
    absorb(setCookie) {
      (setCookie || []).forEach((line) => {
        const match = /^([^=;]+)=([^;]*)/.exec(line);
        if (match) jar[match[1].trim()] = match[2];
      });
    },
  };
}

/** ptuiCB('66','0','','0','二维码未失效。', '昵称') → 取出各个字段 */
function parsePtuiCB(text) {
  const outer = /ptuiCB\((.*)\)/s.exec(text);
  if (!outer) return null;
  const args = [];
  const quoted = /'([^']*)'/g;
  let match = quoted.exec(outer[1]);
  while (match) {
    args.push(match[1]);
    match = quoted.exec(outer[1]);
  }
  return { code: args[0], redirect: args[2], message: args[4], nickname: args[5] };
}

/** p_skey → g_tk：QQ 的 CSRF token，OAuth 授权与 musicu 登录都要带上 */
function getGtk(pSkey) {
  let hash = 5381;
  for (let i = 0; i < pSkey.length; i += 1) hash += (hash << 5) + pSkey.charCodeAt(i);
  return hash & 0x7fffffff;
}

/** OAuth 授权要求一个 uuid 形式的 ui 参数 */
function guid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    .replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return ((c === 'x' ? r : (r & 0x3) | 0x8)).toString(16);
    })
    .toUpperCase();
}

/**
 * graph.qq.com 的 authorize 接口要求 multipart/form-data
 * （QQ 登录页就是这么提交的，换成 urlencoded 会被拒）
 */
function multipart(fields) {
  const boundary = '----AuraBoundary' + crypto.randomBytes(8).toString('hex');
  const body = Object.keys(fields)
    .map((name) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${fields[name]}\r\n`)
    .join('');
  return {
    contentType: 'multipart/form-data; boundary=' + boundary,
    body: body + `--${boundary}--\r\n`,
  };
}

/**
 * 扫码确认之后，把登录态换成 QQ 音乐的 Cookie。
 *
 * 这一步是整个流程里最容易做错的地方：ptqrlogin 返回的跳转链本身并不会给出
 * qqmusic_key，必须按 QQ 互联的 OAuth 流程再走三步——
 *   1. 请求 check_sig，从 Set-Cookie 里拿到 p_skey，算出 g_tk；
 *   2. 带 g_tk 向 graph.qq.com/oauth2.0/authorize 换一个一次性 code；
 *   3. 用 code 调 musicu.fcg 的 QQConnectLogin.LoginServer，这一步才下发
 *      qqmusic_key / uin 等真正的登录 Cookie。
 */
async function exchangeLoginCookie(ptuiText, jar) {
  const urlMatch = /'(https?:\/\/[^']+)'/.exec(ptuiText);
  if (!urlMatch) throw new Error('未从登录响应里取到跳转地址');

  const checkSig = await rawRequest(urlMatch[1], { headers: { Cookie: jar.header() } });
  jar.absorb(checkSig.headers['set-cookie']);
  const pSkey = jar.get().p_skey;
  if (!pSkey) throw new Error('未取到 p_skey，无法生成 g_tk');
  const gtk = getGtk(pSkey);

  const form = multipart({
    response_type: 'code',
    client_id: PT_3RD_AID,
    redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/',
    scope: 'get_user_info,get_app_friends',
    state: 'state',
    switch: '',
    from_ptlogin: '1',
    src: '1',
    update_auth: '1',
    openapi: '1010_1030',
    g_tk: String(gtk),
    auth_time: new Date().toString(),
    ui: guid(),
  });
  const authorize = await rawRequest('https://graph.qq.com/oauth2.0/authorize', {
    method: 'POST',
    headers: Object.assign({ Cookie: jar.header() }, { 'Content-Type': form.contentType }),
    body: form.body,
  });
  const code = (/[?&]code=([^&]+)/.exec(authorize.headers.location || '') || [])[1];
  if (!code) throw new Error('OAuth 未返回授权码');

  const login = await rawRequest('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: jar.header(),
    },
    body: JSON.stringify({
      comm: { g_tk: gtk, platform: 'yqq', ct: 24, cv: 0 },
      req: { module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code } },
    }),
  });
  jar.absorb(login.headers['set-cookie']);

  // qrsig 是本次登录的种子，登录完就没用了，没必要留在用户的配置里
  const jarNow = jar.get();
  delete jarNow.qrsig;
  return Object.keys(jarNow).map((name) => `${name}=${jarNow[name]}`).join('; ');
}

async function createLoginSession() {
  const url =
    `https://ssl.ptlogin2.qq.com/ptqrshow?appid=${PTLOGIN_APPID}&e=2&l=M&s=3&d=72&v=4` +
    `&t=${Date.now()}&daid=${PTLOGIN_DAID}&pt_3rd_aid=${PT_3RD_AID}`;
  const res = await rawRequest(url, { headers: { Referer: 'https://xui.ptlogin2.qq.com/' } });

  const jar = cookieJar();
  jar.absorb(res.headers['set-cookie']);
  const qrsig = jar.get().qrsig;
  if (!qrsig) throw new Error('未取到二维码，请稍后重试');

  const session = crypto.randomBytes(12).toString('hex');
  loginSessions.set(session, { qrsig, jar, createdAt: Date.now() });

  return {
    session,
    image: 'data:image/png;base64,' + res.buffer.toString('base64'),
    expiresIn: Math.round(LOGIN_TTL / 1000),
  };
}

async function pollLogin(sessionId) {
  const entry = loginSessions.get(sessionId);
  if (!entry) return { status: 'invalid', message: '会话不存在，请刷新二维码' };
  if (Date.now() - entry.createdAt > LOGIN_TTL) {
    loginSessions.delete(sessionId);
    return { status: 'expired', message: '二维码已过期，请刷新' };
  }

  const u1 = encodeURIComponent('https://graph.qq.com/oauth2.0/login_jump');
  const url =
    `https://ssl.ptlogin2.qq.com/ptqrlogin?u1=${u1}&ptqrtoken=${hash33(entry.qrsig)}` +
    `&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-${Date.now()}` +
    `&js_ver=23111510&js_type=1&login_sig=&pt_uistyle=40&aid=${PTLOGIN_APPID}` +
    `&daid=${PTLOGIN_DAID}&pt_3rd_aid=${PT_3RD_AID}&o1vId=${crypto.randomBytes(16).toString('hex')}` +
    `&pt_js_version=v1.48.1&has_onekey=1`;
  const res = await rawRequest(url, {
    headers: { Referer: 'https://xui.ptlogin2.qq.com/', Cookie: entry.jar.header() },
  });

  const text = res.buffer.toString('utf8');

  // 状态只看 QQ 的文案，不看 code：全新二维码和已扫描都是 66，只有文案会变。
  // 未扫描是「二维码未失效。」，扫码后才会出现「已扫描」，成功则是「登录成功」。
  const status = text.includes('已失效')
    ? 'expired'
    : text.includes('登录成功')
      ? 'success'
      : /已扫描|已确认|待确认/.test(text)
        ? 'scanned'
        : 'pending';

  // 只在状态跳变时打一行日志，否则 2 秒一次会把日志刷满
  if (entry.lastStatus !== status) {
    entry.lastStatus = status;
    console.log(`[qq] 扫码状态 → ${status}（${text.slice(0, 90)}）`);
  }

  if (status === 'expired') {
    loginSessions.delete(sessionId);
    return { status: 'expired', message: '二维码已失效，请刷新' };
  }
  if (status !== 'success') {
    return status === 'scanned'
      ? { status: 'scanned', message: '已扫描，请在手机上点击确认' }
      : { status: 'pending', message: '请用手机 QQ 扫描二维码' };
  }

  const cb = parsePtuiCB(text);
  entry.jar.absorb(res.headers['set-cookie']);

  let cookie;
  try {
    cookie = await exchangeLoginCookie(text, entry.jar);
  } catch (err) {
    console.error(`[qq] 换取登录 Cookie 失败：${err.message}`);
    loginSessions.delete(sessionId);
    return { status: 'failed', message: '已确认登录，但换取 Cookie 失败：' + err.message };
  }

  loginSessions.delete(sessionId);
  const parsed = readCookie(cookie);
  if (!parsed.authst) {
    return { status: 'failed', message: '已确认登录，但未取到 qqmusic_key，请改用手动粘贴 Cookie' };
  }

  console.log(`[qq] 扫码登录成功，uin=${parsed.uin}`);
  return {
    status: 'success',
    message: '登录成功',
    nickname: cb ? cb.nickname || '' : '',
    uin: parsed.uin,
    cookie,
  };
}

/** 用配置里的 Cookie 查一次登录态，顺带取昵称；失败不抛，只如实回报 */
async function loginStatus(cookie) {
  if (!cookie.uin && !cookie.authst) return { loggedIn: false };
  try {
    const res = await musicu({
      comm: Object.assign({}, COMM, { uin: cookie.uin || '0', authst: cookie.authst || '' }),
      req: { module: 'music.UserInfo.userInfoServer', method: 'GetLoginUserInfo', param: {} },
    });
    const profile = pick(res, ['req.data'], null);
    if (!profile) return { loggedIn: false, message: '登录态已失效，请重新登录' };
    return {
      loggedIn: true,
      uin: cookie.uin,
      nickname: pick(profile, ['nick', 'nickname', 'name'], ''),
      vip: Boolean(pick(profile, ['vip', 'isVip'], false)),
    };
  } catch (err) {
    return { loggedIn: Boolean(cookie.authst), uin: cookie.uin, message: err.message };
  }
}

/* ------------------------------------------------------------------ *
 * 业务接口
 * ------------------------------------------------------------------ */

async function searchSongs(keyword, page, limit) {
  const res = await musicu({
    comm: SEARCH_COMM,
    req: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicDesktop',
      param: { query: keyword, page_num: page, num_per_page: limit },
    },
  });
  const body = pick(res, ['req.data.body'], {});
  return {
    songs: firstArray(pick(body, ['song.list'], [])).map(normalizeSong).filter(Boolean),
    albums: firstArray(pick(body, ['album.list'], [])).map(normalizeAlbum).filter(Boolean),
    artists: firstArray(pick(body, ['singer.list'], [])).map(normalizeArtist).filter(Boolean),
  };
}

async function recommendPlaylists(size) {
  const res = await musicu({
    comm: COMM,
    req: {
      module: 'music.playlist.PlaylistSquare',
      method: 'GetRecommendFeed',
      param: { From: 0, Size: size },
    },
  });
  return firstArray(pick(res, ['req.data.List'], []))
    .map((item) => normalizePlaylist(pick(item, ['Playlist.basic'], null)))
    .filter(Boolean);
}

async function topSongs(topId, limit) {
  const res = await legacy('/v8/fcg-bin/fcg_v8_toplist_cp.fcg', {
    topid: topId,
    format: 'json',
    g_tk: 5381,
  });
  const rows = firstArray(pick(res, ['songlist'], []));
  return rows
    .slice(0, limit || rows.length)
    .map((row) => normalizeSong(pick(row, ['data'], row)))
    .filter(Boolean);
}

/** 首页的「专辑」货架：QQ 没有免登录的推荐专辑接口，从榜单曲目里按专辑去重得到真实专辑 */
async function recommendAlbums(limit) {
  const songs = await topSongs(26, 100);
  const seen = new Set();
  const albums = [];
  songs.forEach((song) => {
    if (!song.album || !song.album.mid || seen.has(song.album.mid)) return;
    seen.add(song.album.mid);
    albums.push({
      mid: song.album.mid,
      id: song.album.id,
      name: song.album.name,
      time_public: '',
      songnum: 0,
      singer: song.singer,
    });
  });
  return albums.slice(0, limit);
}

async function albumDetail(albumMid) {
  const res = await legacy('/v8/fcg-bin/fcg_v8_album_info_cp.fcg', {
    albummid: albumMid,
    format: 'json',
    g_tk: 5381,
  });
  const data = pick(res, ['data'], null);
  if (!data) return null;
  const album = normalizeAlbum(data);
  if (!album) return null;
  album.list = firstArray(pick(data, ['list'], [])).map(normalizeSong).filter(Boolean);
  album.songnum = album.songnum || album.list.length;
  return album;
}

async function playlistDetail(disstid) {
  // 排行榜与歌单在 QQ 里是两套数据，id 形态也不同（topid 是小数字）
  if (/^\d{1,5}$/.test(disstid) && TOP_LISTS.some((item) => String(item.id) === disstid)) {
    const meta = TOP_LISTS.filter((item) => String(item.id) === disstid)[0];
    const list = await topSongs(disstid, 100);
    return {
      disstid,
      dissname: meta.title,
      introduction: 'QQ 音乐实时榜单',
      nickname: 'QQ 音乐',
      logo: '',
      songnum: list.length,
      songlist: list,
    };
  }

  const res = await legacy('/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg', {
    type: 1,
    json: 1,
    utf8: 1,
    onlysong: 0,
    disstid,
    format: 'json',
    g_tk: 5381,
  });
  const cd = firstArray(pick(res, ['cdlist'], []))[0];
  if (!cd) return null;
  const playlist = normalizePlaylist(cd);
  if (!playlist) return null;
  playlist.songlist = firstArray(pick(cd, ['songlist'], [])).map(normalizeSong).filter(Boolean);
  playlist.songnum = playlist.songnum || playlist.songlist.length;
  return playlist;
}

async function singerList(limit) {
  const res = await legacy('/v8/fcg-bin/v8.fcg', {
    channel: 'singer',
    page: 'list',
    key: 'all_all_all',
    pagesize: limit,
    pagenum: 1,
    format: 'json',
    g_tk: 5381,
  });
  return firstArray(pick(res, ['data.list'], [])).map(normalizeArtist).filter(Boolean);
}

async function singerDetail(singerMid) {
  const [profile, songs] = await Promise.all([
    musicu({
      comm: COMM,
      req: {
        module: 'music.musichallSinger.SingerInfoInter',
        method: 'GetSingerDetail',
        param: { singer_mids: [singerMid], groups: 0, wiki: 1 },
      },
    }).catch(() => null),
    musicu({
      comm: COMM,
      req: {
        module: 'music.musichallSong.SongListInter',
        method: 'GetSingerSongList',
        param: { singerMid, begin: 0, num: 10, order: 1 },
      },
    }).catch(() => null),
  ]);

  const basic = pick(profile, ['req.data.singer_list.0.basic_info'], null);
  const artist = normalizeArtist(basic) || { mid: singerMid, name: '未知艺人', desc: '' };
  artist.list = firstArray(pick(songs, ['req.data.songList'], []))
    .map((row) => normalizeSong(pick(row, ['songInfo'], row)))
    .filter(Boolean);
  return artist;
}

async function lyric(songMid, songId) {
  if (!songMid) return null;
  const res = await musicu({
    comm: COMM,
    req: {
      module: 'music.musichallSong.PlayLyricInfo',
      method: 'GetPlayLyricInfo',
      param: { songMID: songMid, songID: Number(songId) || 0 },
    },
  });
  const data = pick(res, ['req.data'], null);
  if (!data) return null;
  const lrc = decodeLyric(pick(data, ['lyric'], ''));
  if (!lrc) return null;
  return { lyric: lrc, trans: decodeLyric(pick(data, ['trans'], '')) || null };
}

/**
 * CDN 上的文件名用的是 media_mid，而不是列表里的 songmid，两者经常不同。
 * 列表接口不返回 media_mid，只能按 songmid 单独查一次歌曲详情；结果缓存起来，
 * 同一首歌重复播放（切歌、循环）时不再重复请求。
 */
const mediaMidCache = new Map();

async function mediaMidOf(songMid) {
  if (mediaMidCache.has(songMid)) return mediaMidCache.get(songMid);
  const res = await musicu({
    comm: COMM,
    songinfo: {
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      param: { song_mid: songMid },
    },
  });
  const mediaMid = pick(res, ['songinfo.data.track_info.file.media_mid'], '') || songMid;
  mediaMidCache.set(songMid, mediaMid);
  return mediaMid;
}

/** 单个 mid 取一次 vkey；命中返回 { url, code }，未命中 code 是 QQ 的原始结果码 */
async function fetchVkey(songMid, mediaMid, fileType, cookie) {
  const res = await musicu({
    comm: Object.assign({}, COMM, { uin: cookie.uin || '0', authst: cookie.authst || '' }),
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: {
        guid: '2796982635',
        songmid: [songMid],
        songtype: [0],
        uin: cookie.uin || '0',
        loginflag: 1,
        platform: '20',
        filename: [`${fileType.prefix}${mediaMid}${fileType.ext}`],
      },
    },
  });

  const data = pick(res, ['req_0.data'], null);
  const info = pick(data, ['midurlinfo.0'], null);
  const purl = pick(info, ['purl'], '');
  if (!purl) return { url: '', code: pick(info, ['result'], null) };

  const sip = firstArray(pick(data, ['sip'], [])).filter((host) => !host.startsWith('http://ws'))[0];
  const domain = sip || pick(data, ['sip.0'], '');
  // 统一升到 https：Electron 渲染层是安全上下文，http 音源会被判为混合内容
  return { url: (domain + purl).replace(/^http:\/\//, 'https://'), code: 0 };
}

/**
 * 取音频直链。
 *
 * 免登录时 QQ 只放行 128k，且同一档位有两种封装：M500(.mp3) 与 C400(.m4a)。
 * 不同曲目上架的文件形态不一样，只试一种会漏掉一批能播的歌，所以 128k 下互为兜底。
 * 320k / flac 属于会员权益，拿不到就如实返回结果码，由前端提示用户补 Cookie。
 */
async function streamUrl(songMid, quality, cookie) {
  const primary = FILE_TYPES[quality] || FILE_TYPES['128'];
  const mediaMid = await mediaMidOf(songMid).catch(() => songMid);
  const first = await fetchVkey(songMid, mediaMid, primary, cookie);
  if (first.url || quality !== '128') return first;

  const fallback = await fetchVkey(songMid, mediaMid, FILE_TYPES.m4a, cookie);
  return fallback.url ? fallback : first;
}

/* ------------------------------------------------------------------ *
 * HTTP 层
 * ------------------------------------------------------------------ */

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const ROUTES = {
  '/search': async (query, cookie) => {
    const keyword = String(query.key || '').trim();
    if (!keyword) return { data: { song: { list: [] }, album: { list: [] }, singer: { list: [] } } };
    const result = await searchSongs(keyword, Number(query.page) || 1, Number(query.limit) || 30);
    return {
      data: {
        song: { list: result.songs },
        album: { list: result.albums },
        singer: { list: result.artists },
      },
    };
  },

  '/recommend/playlist': async (query) => ({
    data: { list: await recommendPlaylists(Number(query.limit) || 12) },
  }),

  '/recommend/album': async (query) => ({
    data: { list: await recommendAlbums(Number(query.limit) || 12) },
  }),

  '/topList': async () => ({
    data: {
      list: TOP_LISTS.map((item) => ({
        disstid: String(item.id),
        dissname: item.title,
        introduction: 'QQ 音乐实时榜单',
        nickname: 'QQ 音乐',
        logo: '',
        songnum: 0,
      })),
    },
  }),

  '/album': async (query) => {
    if (!query.id) throw new Error('缺少参数 id（专辑 mid）');
    const album = await albumDetail(String(query.id));
    if (!album) throw new Error('未找到该专辑');
    return { data: album };
  },

  '/playlist': async (query) => {
    if (!query.id) throw new Error('缺少参数 id（歌单 id）');
    const playlist = await playlistDetail(String(query.id));
    if (!playlist) throw new Error('未找到该歌单');
    return { data: playlist };
  },

  '/singer/list': async (query) => ({
    data: { list: await singerList(Number(query.limit) || 60) },
  }),

  '/singer/info': async (query) => {
    if (!query.singermid) throw new Error('缺少参数 singermid');
    return { data: await singerDetail(String(query.singermid)) };
  },

  '/lyric': async (query) => {
    if (!query.id) throw new Error('缺少参数 id（歌曲 mid）');
    return { data: await lyric(String(query.id), query.songid) };
  },

  '/song/urls': async (query, cookie) => {
    const mid = String(query.id || '');
    if (!mid) throw new Error('缺少参数 id（歌曲 mid）');
    const quality = String(query.quality || '128');
    const result = await streamUrl(mid, quality, cookie);
    const data = {};
    data[mid] = {
      url: result.url,
      quality,
      lossless: quality === 'flac',
      // 104003 = 需要登录 / 会员版权；前端据此给出「请填 Cookie」而不是笼统失败
      code: result.code,
      needLogin: result.code === 104003,
    };
    return { data };
  },

  /** 取一张二维码，返回图片与本次登录的会话 id */
  '/login/qr': async () => ({ data: await createLoginSession() }),

  /** 轮询扫码状态；success 时一并回传 cookie，由前端存进配置 */
  '/login/poll': async (query) => {
    if (!query.session) throw new Error('缺少参数 session');
    return { data: await pollLogin(String(query.session)) };
  },

  /** 校验当前配置的 Cookie 是否还有效 */
  '/login/status': async (_query, cookie) => ({ data: await loginStatus(cookie) }),
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }
  if (req.method !== 'GET') {
    send(res, 405, { error: '仅支持 GET' });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const query = Object.fromEntries(url.searchParams.entries());
  const cookie = readCookie(req.headers.cookie);

  if (path === '/') {
    send(res, 200, {
      result: 100,
      message: 'Aura QQ 音乐服务运行中',
      loggedIn: Boolean(cookie.uin && cookie.authst),
      routes: Object.keys(ROUTES),
    });
    return;
  }

  const handler = ROUTES[path];
  if (!handler) {
    send(res, 404, { error: `未知接口 ${path}` });
    return;
  }

  try {
    const payload = await handler(query, cookie);
    send(res, 200, payload);
  } catch (err) {
    console.error(`[qq] ${path} 失败：${err.message}`);
    send(res, 502, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Aura · QQ 音乐本地后端 → http://${HOST}:${PORT}`);
  console.log('在应用「设置 → 数据源」中选择 QQ 音乐，接口地址填上面这个地址。');
  console.log('未登录只能播放非付费曲目；付费曲目请在设置里粘贴登录 Cookie。');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。换一个：PORT=3400 npm run qq-server（记得同步改应用里的接口地址）`);
  } else {
    console.error('服务启动失败：', err.message);
  }
  process.exit(1);
});
