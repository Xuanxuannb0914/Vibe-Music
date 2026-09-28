/**
 * Aura — 预加载脚本
 *
 * 通过 contextBridge 把「桌面能力」以最小权限暴露给渲染层。
 * 渲染层始终以 `window.desktop?.xxx` 的形式做存在性判断，
 * 因此 app/index.html 直接用浏览器打开时也能完整运行（仅缺少桌面能力）。
 */
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  platform: process.platform,
  version: process.versions.electron,

  window: {
    minimize: () => invoke('win:minimize'),
    maximize: () => invoke('win:maximize'),
    close: () => invoke('win:close'),
    isMaximized: () => invoke('win:is-maximized'),
    onMaximizedChange: (cb) => {
      const handler = (_e, value) => cb(value);
      ipcRenderer.on('win:maximized-changed', handler);
      return () => ipcRenderer.removeListener('win:maximized-changed', handler);
    },
  },

  config: {
    get: () => invoke('config:get'),
    set: (patch) => invoke('config:set', patch),
  },

  openExternal: (url) => invoke('shell:open-external', url),

  pickLocalFiles: () => invoke('dialog:pick-files'),

  /** 经主进程代理的 HTTP 请求（用于携带 Cookie 访问 QQ 音乐第三方接口） */
  apiRequest: (payload) => invoke('api:request', payload),

  mediaKeys: {
    on: (cb) => {
      const handler = (_e, action) => cb(action);
      ipcRenderer.on('media-key', handler);
      return () => ipcRenderer.removeListener('media-key', handler);
    },
  },
});
