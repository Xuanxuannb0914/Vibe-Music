/**
 * Aura · 数据源门面
 *
 * 上层 UI 只依赖 Aura.api 暴露的方法，完全不关心背后是内置演示数据还是 QQ 音乐。
 * 切换数据源 = 换一个 adapter 实例，UI 无需任何改动。
 */
(function (Aura) {
  'use strict';

  var CONFIG_KEY = 'aura.sourceConfig';

  var state = {
    source: 'mock',
    qq: { apiBase: 'http://localhost:3300', cookie: '', quality: '320' },
    ready: false,
  };

  function readLocalConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    } catch (err) {
      return {};
    }
  }

  function writeLocalConfig(patch) {
    var next = Object.assign(readLocalConfig(), patch);
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    } catch (err) {
      /* 存储不可用时静默降级，仅影响持久化 */
    }
  }

  function activeAdapter() {
    return state.source === 'qq' ? Aura.apiQqAdapter : Aura.apiMockAdapter;
  }

  /** 把当前配置推给 QQ 适配器（它需要 apiBase / cookie / quality） */
  function syncAdapterConfig() {
    if (Aura.apiQqAdapter && typeof Aura.apiQqAdapter.setConfig === 'function') {
      Aura.apiQqAdapter.setConfig(state.qq);
    }
  }

  /** 读取配置：Electron 下以 userData 中的 app-config.json 为准，浏览器下降级到 localStorage */
  function loadConfig() {
    if (window.desktop && window.desktop.config) {
      return window.desktop.config.get().then(function (cfg) {
        state.source = cfg.dataSource === 'qq' ? 'qq' : 'mock';
        state.qq = Object.assign({}, state.qq, cfg.qq || {});
        syncAdapterConfig();
        return state;
      }).catch(function () {
        applyLocal();
        return state;
      });
    }
    applyLocal();
    return Promise.resolve(state);
  }

  function applyLocal() {
    var local = readLocalConfig();
    state.source = local.dataSource === 'qq' ? 'qq' : 'mock';
    state.qq = Object.assign({}, state.qq, local.qq || {});
    syncAdapterConfig();
  }

  function persist(patch) {
    writeLocalConfig(patch);
    if (window.desktop && window.desktop.config) {
      return window.desktop.config.set(patch).catch(function () { /* 忽略持久化失败 */ });
    }
    return Promise.resolve();
  }

  var api = {
    /** 初始化：读取配置并确定数据源 */
    init: function () {
      return loadConfig().then(function () {
        state.ready = true;
        return state;
      });
    },

    getState: function () {
      return Object.assign({}, state);
    },

    getSource: function () {
      return state.source;
    },

    getSourceLabel: function () {
      return activeAdapter().label;
    },

    /** 切换数据源 */
    setSource: function (source) {
      state.source = source === 'qq' ? 'qq' : 'mock';
      return persist({ dataSource: state.source }).then(function () {
        return state.source;
      });
    },

    /** 更新 QQ 音乐接入配置 */
    setQqConfig: function (patch) {
      state.qq = Object.assign({}, state.qq, patch || {});
      syncAdapterConfig();
      return persist({ qq: state.qq }).then(function () {
        return state.qq;
      });
    },

    getQqConfig: function () {
      return Object.assign({}, state.qq);
    },

    /** 连通性探测（设置页「测试连接」按钮使用） */
    testConnection: function () {
      syncAdapterConfig();
      return activeAdapter().testConnection();
    },

    /* ---------- 领域方法：全部转发给当前适配器 ---------- */

    getHome: function () { return activeAdapter().getHome(); },
    getTracks: function () { return activeAdapter().getTracks(); },
    getAlbums: function () { return activeAdapter().getAlbums(); },
    getAlbum: function (id) { return activeAdapter().getAlbum(id); },
    getArtists: function () { return activeAdapter().getArtists(); },
    getArtist: function (id) { return activeAdapter().getArtist(id); },
    getPlaylists: function () { return activeAdapter().getPlaylists(); },
    getPlaylist: function (id) { return activeAdapter().getPlaylist(id); },
    getGenres: function () { return activeAdapter().getGenres(); },
    getLyrics: function (trackId) { return activeAdapter().getLyrics(trackId); },
    search: function (q) { return activeAdapter().search(q); },
    resolveStreamUrl: function (trackId) { return activeAdapter().resolveStreamUrl(trackId); },
  };

  Aura.api = api;
})(window.Aura = window.Aura || {});
