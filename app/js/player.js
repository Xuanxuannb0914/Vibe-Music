/**
 * Aura · 播放控制器
 *
 * 视图只与这里交互（Aura.player.playTrack / toggle / next …），不直接碰 Aura.audio。
 * 它统一负责四件事：
 *   1. 解析播放地址（Aura.api.resolveStreamUrl）并驱动音频引擎
 *   2. 把引擎状态回写到状态中心（进度 / 时长 / 播放中 / 缓冲 / 错误）
 *   3. 曲目切换时联动「封面主色 → 氛围光与强调色」以及歌词加载
 *   4. 播放模式（随机 / 循环）与队列增删
 *
 * 进度统一由定时器轮询引擎，而不是监听 <audio> 的 timeupdate：
 * 演示数据走的是程序化合成音源（没有 media 元素），轮询让两套后端行为一致。
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;
  var store = Aura.store;
  var audio = Aura.audio;

  var TICK_MS = 250;

  var ticker = null;
  var token = 0;          // 每次切歌自增，用于丢弃过期请求的结果
  var activeId = null;    // 当前正在播放的曲目 id（主题/歌词的过期判定）
  var lastPalette = null; // 最近一次封面提取结果，供偏好变化时重新套用

  function indexOfId(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return i;
    }
    return -1;
  }

  function current() {
    var s = store.state;
    if (s.queueIndex < 0 || s.queueIndex >= s.queue.length) return null;
    return s.queue[s.queueIndex] || null;
  }

  /* ------------------------------------------------------------------ *
   * 封面主色 → 氛围光 / 强调色
   * ------------------------------------------------------------------ */

  function syncTheme(track) {
    var cover = track.album && track.album.cover;
    Aura.color.extract(cover, track.id).then(function (palette) {
      if (activeId !== track.id) return;
      lastPalette = palette;
      applyPalette();
    });
  }

  function applyPalette() {
    if (!lastPalette) return;
    Aura.theme.applyCoverColors(lastPalette.primary, lastPalette.secondary);
    Aura.theme.applyAccent(Aura.theme.resolveAccent(store.state.prefs, lastPalette.primary));
  }

  /** 偏好变化（手动强调色 / 自动跟随封面）后重新套用配色 */
  function refreshTheme() {
    applyPalette();
  }

  /* ------------------------------------------------------------------ *
   * 歌词
   * ------------------------------------------------------------------ */

  function syncLyrics(track) {
    store.set({ lyrics: null, lyricsLoading: true });
    Aura.api.getLyrics(track.id)
      .then(function (payload) {
        if (activeId !== track.id) return;
        store.set({ lyrics: Aura.lyrics.build(payload), lyricsLoading: false });
      })
      .catch(function () {
        if (activeId !== track.id) return;
        store.set({ lyrics: null, lyricsLoading: false });
      });
  }

  /* ------------------------------------------------------------------ *
   * 进度轮询
   * ------------------------------------------------------------------ */

  function startTicker() {
    if (ticker) return;
    ticker = setInterval(function () {
      if (!store.state.playing) {
        stopTicker();
        return;
      }
      store.set({
        currentTime: audio.currentTime,
        duration: audio.duration || store.state.duration,
      });
    }, TICK_MS);
  }

  function stopTicker() {
    if (!ticker) return;
    clearInterval(ticker);
    ticker = null;
  }

  /* ------------------------------------------------------------------ *
   * 核心：播放队列中的第 index 首
   * ------------------------------------------------------------------ */

  function playAt(index, opts) {
    opts = opts || {};
    var s = store.state;
    if (index < 0 || index >= s.queue.length) return;

    var track = s.queue[index];
    var myToken = ++token;
    activeId = track.id;

    store.set({
      queueIndex: index,
      currentTime: 0,
      duration: util.toSeconds(track.duration),
      buffering: true,
      streamError: null,
    });

    // 主题与歌词和音频加载并行，互不阻塞
    syncTheme(track);
    syncLyrics(track);
    store.emit('track-changed', track);

    Aura.api.resolveStreamUrl(track.id)
      .then(function (stream) {
        if (myToken !== token) return null;
        return audio.load(track, stream).then(function () { return stream; });
      })
      .then(function (stream) {
        if (myToken !== token || stream === null) return undefined;
        store.set({
          buffering: false,
          duration: audio.duration || util.toSeconds(track.duration),
        });
        if (opts.autoplay === false) return undefined;
        return audio.play();
      })
      .then(function () {
        if (myToken !== token) return;
        store.set({ playing: true });
        startTicker();
      })
      .catch(function (err) {
        if (myToken !== token) return;
        stopTicker();
        store.set({ buffering: false, playing: false, streamError: err.message });
        Aura.ui.toast(err.message, 'danger');
      });
  }

  /* ------------------------------------------------------------------ *
   * 播放模式
   * ------------------------------------------------------------------ */

  function handleEnded() {
    var s = store.state;
    if (s.repeat === 'one') {
      audio.seek(0);
      store.set({ currentTime: 0 });
      audio.play().then(function () {
        store.set({ playing: true });
        startTicker();
      }).catch(function () { /* 单曲循环失败时保持停止态即可 */ });
      return;
    }
    player.next(true);
  }

  function step(delta, auto) {
    var s = store.state;
    if (!s.queue.length) return;

    if (delta > 0 && s.shuffle && s.queue.length > 1) {
      var pick;
      do { pick = Math.floor(Math.random() * s.queue.length); } while (pick === s.queueIndex);
      playAt(pick);
      return;
    }

    var next = s.queueIndex + delta;
    if (next >= s.queue.length) {
      if (auto && s.repeat !== 'all') {
        // 顺序播完且未开循环：停在最后一首，不自动回到开头
        stopTicker();
        store.set({ playing: false, currentTime: s.duration });
        return;
      }
      next = 0;
    }
    if (next < 0) {
      if (s.repeat === 'all') next = s.queue.length - 1;
      else { player.seek(0); return; }
    }
    playAt(next);
  }

  var player = {
    /* ---------- 查询 ---------- */

    current: current,

    currentId: function () {
      var track = current();
      return track ? track.id : null;
    },

    isCurrent: function (trackId) {
      return activeId === trackId && store.state.queueIndex >= 0;
    },

    /** 队列中该曲目的序号（从 1 开始），不在队列中返回 0 */
    queuePosition: function (trackId) {
      var i = indexOfId(store.state.queue, trackId);
      return i === -1 ? 0 : i + 1;
    },

    /* ---------- 播放 ---------- */

    /** 以给定列表为播放队列，从 index 开始播放 */
    playList: function (tracks, index) {
      var list = (tracks || []).filter(Boolean);
      if (!list.length) return;
      var start = util.clamp(index == null ? 0 : index, 0, list.length - 1);
      store.set({ queue: list.slice(), queueIndex: -1 });
      playAt(start);
    },

    /**
     * 播放单曲
     * @param {object} track
     * @param {Array} [contextTracks] 上下文列表（专辑/歌单/搜索结果），用于建立队列
     */
    playTrack: function (track, contextTracks) {
      if (!track) return;
      var s = store.state;

      var existing = indexOfId(s.queue, track.id);
      if (existing !== -1) return playAt(existing);

      if (contextTracks && contextTracks.length) {
        var at = indexOfId(contextTracks, track.id);
        return player.playList(contextTracks, at === -1 ? 0 : at);
      }

      // 无上下文：插到当前曲目之后，不打断正在播放的内容
      var queue = s.queue.slice();
      var insertAt = s.queueIndex < 0 ? queue.length : s.queueIndex + 1;
      queue.splice(insertAt, 0, track);
      store.set({ queue: queue });
      playAt(insertAt);
    },

    /** 播放 / 暂停切换 */
    toggle: function () {
      if (!current()) {
        Aura.ui.toast('先挑一首歌吧', 'info');
        return;
      }
      if (store.state.playing) player.pause();
      else player.resume();
    },

    pause: function () {
      if (!store.state.playing) return;
      stopTicker();
      store.set({ playing: false });
      audio.pause();
    },

    resume: function () {
      if (!current()) return;
      audio.play()
        .then(function () {
          store.set({ playing: true });
          startTicker();
        })
        .catch(function (err) {
          stopTicker();
          store.set({ playing: false, streamError: err.message });
          Aura.ui.toast(err.message, 'danger');
        });
    },

    next: function (auto) { step(1, auto); },

    prev: function () {
      if (!store.state.queue.length) return;
      // 播放超过 3 秒时，「上一首」先回到本曲开头，符合主流播放器手感
      if (audio.currentTime > 3) { player.seek(0); return; }
      step(-1, false);
    },

    /** 跳转到队列中的指定位置 */
    jumpTo: function (index) {
      playAt(util.clamp(index, 0, store.state.queue.length - 1));
    },

    seek: function (seconds) {
      var target = util.clamp(seconds, 0, store.state.duration || 0);
      audio.seek(target);
      store.set({ currentTime: target });
    },

    seekRatio: function (ratio) {
      player.seek(util.clamp(ratio, 0, 1) * (store.state.duration || 0));
    },

    seekBy: function (delta) {
      player.seek(audio.currentTime + delta);
    },

    /* ---------- 音量 ---------- */

    setVolume: function (value) {
      var v = util.clamp(Number(value) || 0, 0, 1);
      store.set({ volume: v, muted: v === 0 ? store.state.muted : false });
      audio.setVolume(v);
    },

    toggleMute: function () {
      var muted = !store.state.muted;
      store.set({ muted: muted });
      audio.setVolume(muted ? 0 : store.state.volume);
    },

    /* ---------- 模式 ---------- */

    setShuffle: function (on) {
      store.set({ shuffle: !!on });
      Aura.ui.toast(on ? '随机播放已开启' : '随机播放已关闭', 'info');
    },

    setRepeat: function (mode) {
      store.set({ repeat: ['off', 'all', 'one'].indexOf(mode) === -1 ? 'off' : mode });
    },

    cycleRepeat: function () {
      var order = ['off', 'all', 'one'];
      var next = order[(order.indexOf(store.state.repeat) + 1) % order.length];
      player.setRepeat(next);
      Aura.ui.toast(
        next === 'off' ? '顺序播放' : next === 'all' ? '列表循环' : '单曲循环',
        'info'
      );
    },

    /* ---------- 队列编辑 ---------- */

    addToQueue: function (track) {
      if (!track) return;
      var queue = store.state.queue.slice();
      queue.push(track);
      store.set({ queue: queue });
      Aura.ui.toast('已加入队列：' + track.title, 'success');
    },

    playNext: function (track) {
      if (!track) return;
      var s = store.state;
      var queue = s.queue.slice();
      var at = s.queueIndex < 0 ? queue.length : s.queueIndex + 1;
      queue.splice(at, 0, track);
      store.set({ queue: queue });
      Aura.ui.toast('下一首播放：' + track.title, 'success');
    },

    removeFromQueue: function (index) {
      var s = store.state;
      if (index < 0 || index >= s.queue.length) return;
      var queue = s.queue.slice();
      var removingCurrent = index === s.queueIndex;
      queue.splice(index, 1);

      var nextIndex = s.queueIndex;
      if (index < s.queueIndex) nextIndex -= 1;

      if (!queue.length) {
        store.set({ queue: [], queueIndex: -1, playing: false, currentTime: 0, duration: 0 });
        stopTicker();
        if (audio.track) audio.stop();
        return;
      }

      store.set({ queue: queue, queueIndex: nextIndex });
      if (removingCurrent) playAt(util.clamp(nextIndex, 0, queue.length - 1));
    },

    clearQueue: function () {
      stopTicker();
      store.set({ queue: [], queueIndex: -1, playing: false, currentTime: 0, duration: 0 });
      if (audio.track) audio.stop();
    },

    /* ---------- 联动 ---------- */

    /** 偏好变化后重新套用配色与内核参数 */
    refresh: function () {
      refreshTheme();
      audio.refresh();
    },

    /** 首帧启动：接管音频引擎事件与系统媒体键 */
    init: function () {
      audio.on('ended', handleEnded);
      audio.on('error', function (err) {
        stopTicker();
        store.set({ playing: false, buffering: false, streamError: err.message });
      });
      audio.on('pause', function () {
        stopTicker();
        store.set({ playing: false });
      });

      if (window.desktop && window.desktop.mediaKeys) {
        window.desktop.mediaKeys.on(function (action) {
          if (action === 'playpause') player.toggle();
          else if (action === 'next') player.next(false);
          else if (action === 'prev') player.prev();
          else if (action === 'stop') { player.pause(); player.seek(0); }
        });
      }

      audio.setVolume(store.state.volume);
      return player;
    },
  };

  Aura.player = player;
})(window.Aura = window.Aura || {});
