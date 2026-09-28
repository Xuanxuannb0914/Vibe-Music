/**
 * Aura · 状态中心
 *
 * 极简的单一状态树 + 订阅通知，避免引入框架。
 * 视图/组件订阅自己关心的切片，状态变化后统一重绘。
 *
 * 持久化策略：
 *   - 界面偏好（prefs）与收藏（liked）→ localStorage，刷新后保留
 *   - 数据源与 QQ 凭据 → 交给主进程写入 userData（见 api/index.js）
 */
(function (Aura) {
  'use strict';

  var PREFS_KEY = 'aura.prefs';
  var LIKED_KEY = 'aura.liked';

  var DEFAULT_PREFS = {
    /* —— 外观 —— */
    theme: 'dark',                 // dark | light
    accentMode: 'cover',           // cover | manual
    accent: '#ff375f',             // 手动强调色（accentMode=manual 时生效）
    glass: true,                   // 玻璃拟态总开关
    glassBlur: 26,                 // 毛玻璃强度 px
    glow: true,                    // 环境光总开关
    glowStrength: 0.85,            // 环境光强度 0~1
    grain: 0.035,                  // 胶片颗粒 0~1
    radiusScale: 1,                // 圆角缩放 0.5~1.5
    fontScale: 1,                  // 字号缩放 0.9~1.15
    density: 'cozy',               // compact | cozy | spacious

    /* —— 正在播放 —— */
    npLayout: 'immersive',         // immersive | split | list | canvas
    showTranslation: true,         // 歌词是否显示翻译
    lyricFontScale: 1,             // 歌词字号缩放

    /* —— 可视化 —— */
    vizEnabled: true,
    vizStyle: 'bars',              // bars | wave | radial | particles
    vizSensitivity: 1,             // 灵敏度 0.5~2

    /* —— 播放器内核 —— */
    audio: {
      speed: 1,                    // 0.5 ~ 2
      gain: 1,                     // 0.5 ~ 2
      fadeIn: 400,                 // 淡入毫秒
      fadeOut: 400,                // 淡出毫秒
      crossfade: 0,                // 交叉淡化毫秒（0 = 关闭）
      reverb: 0,                   // 空间感 0 ~ 1
      stereoWidth: 1,              // 立体声宽度 0 ~ 2
      eqPreset: 'flat',
      eq: [0, 0, 0, 0, 0],         // 5 段增益 dB，-12 ~ +12
    },
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function deepMerge(base, patch) {
    var out = Object.assign({}, base);
    Object.keys(patch || {}).forEach(function (key) {
      var value = patch[key];
      if (value && typeof value === 'object' && !Array.isArray(value) &&
          base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
        out[key] = deepMerge(base[key], value);
      } else {
        out[key] = value;
      }
    });
    return out;
  }

  function loadPrefs() {
    try {
      var saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      return deepMerge(DEFAULT_PREFS, saved);
    } catch (err) {
      return clone(DEFAULT_PREFS);
    }
  }

  function loadLiked() {
    try {
      return JSON.parse(localStorage.getItem(LIKED_KEY) || '{}');
    } catch (err) {
      return {};
    }
  }

  var state = {
    /* 路由 */
    route: 'home',
    routeParams: {},

    /* 视图局部状态 */
    libraryTab: 'songs',
    libraryQuery: '',
    searchQuery: '',
    searchResults: null,
    searchLoading: false,
    settingsSection: 'appearance',

    /* 播放状态 */
    queue: [],
    queueIndex: -1,
    playing: false,
    currentTime: 0,
    duration: 0,
    buffering: false,
    streamError: null,

    /* 播放模式 */
    volume: 0.8,
    muted: false,
    shuffle: false,
    repeat: 'off',                 // off | all | one

    /* 数据缓存 */
    home: null,
    albums: null,
    artists: null,
    playlists: null,
    tracks: null,
    genres: null,
    loading: false,
    loadError: null,

    /* 当前曲目的歌词 */
    lyrics: null,
    lyricsLoading: false,

    /* 用户数据 */
    liked: loadLiked(),

    /* 偏好 */
    prefs: loadPrefs(),
  };

  var listeners = new Set();
  var eventBus = {};

  function notify(changedKeys) {
    listeners.forEach(function (fn) {
      try {
        fn(state, changedKeys);
      } catch (err) {
        console.error('[Aura.store] 订阅回调异常:', err);
      }
    });
  }

  var store = {
    /** 只读状态快照（请勿直接修改，统一走 set） */
    get state() {
      return state;
    },

    /** 合并式更新，返回本次变更的顶层键名数组 */
    set: function (patch) {
      var changed = [];
      Object.keys(patch).forEach(function (key) {
        if (state[key] !== patch[key]) changed.push(key);
        state[key] = patch[key];
      });
      if (changed.length) notify(changed);
      return changed;
    },

    /** 更新偏好（支持嵌套对象合并），并持久化 */
    setPrefs: function (patch) {
      state.prefs = deepMerge(state.prefs, patch);
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
      } catch (err) {
        /* 忽略持久化失败 */
      }
      notify(['prefs']);
      return state.prefs;
    },

    /** 按点路径更新偏好，例如 setPref('audio.gain', 1.2) */
    setPref: function (path, value) {
      var parts = path.split('.');
      var patch = {};
      var cursor = patch;
      for (var i = 0; i < parts.length - 1; i++) {
        cursor[parts[i]] = {};
        cursor = cursor[parts[i]];
      }
      cursor[parts[parts.length - 1]] = value;
      return store.setPrefs(patch);
    },

    getPref: function (path, fallback) {
      var cursor = state.prefs;
      var parts = path.split('.');
      for (var i = 0; i < parts.length; i++) {
        if (cursor == null) return fallback;
        cursor = cursor[parts[i]];
      }
      return cursor === undefined ? fallback : cursor;
    },

    /** 切换收藏，返回切换后的状态 */
    toggleLiked: function (trackId) {
      if (state.liked[trackId]) delete state.liked[trackId];
      else state.liked[trackId] = true;
      try {
        localStorage.setItem(LIKED_KEY, JSON.stringify(state.liked));
      } catch (err) {
        /* 忽略持久化失败 */
      }
      notify(['liked']);
      return !!state.liked[trackId];
    },

    isLiked: function (trackId) {
      return !!state.liked[trackId];
    },

    /** 订阅状态变化，返回取消订阅函数 */
    subscribe: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },

    /** 一次性事件总线（如 track-ended / toast） */
    on: function (event, fn) {
      (eventBus[event] = eventBus[event] || []).push(fn);
      return function () {
        eventBus[event] = eventBus[event].filter(function (f) { return f !== fn; });
      };
    },

    emit: function (event, payload) {
      (eventBus[event] || []).forEach(function (fn) {
        try {
          fn(payload);
        } catch (err) {
          console.error('[Aura.store] 事件回调异常:', event, err);
        }
      });
    },

    /** 恢复出厂设置：清空偏好与收藏 */
    resetPrefs: function () {
      state.prefs = clone(DEFAULT_PREFS);
      try {
        localStorage.removeItem(PREFS_KEY);
      } catch (err) {
        /* 忽略 */
      }
      notify(['prefs']);
      return state.prefs;
    },

    defaults: DEFAULT_PREFS,
  };

  Aura.store = store;
})(window.Aura = window.Aura || {});
