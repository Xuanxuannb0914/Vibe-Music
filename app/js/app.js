/**
 * Aura · 应用引导
 *
 * 这里是唯一的「外壳」层，负责四件事，且只做这四件事：
 *   1. 装配应用外壳：侧边栏导航 / 顶栏 / 视图挂载点 / 播放条
 *   2. 路由：五个主视图 + 详情页，带前进后退历史
 *   3. 播放条：与状态中心双向同步（进度、音量、模式、当前曲目）
 *   4. 全局动作注册表：所有 data-act 的落点
 *
 * 视图文件只声明「长什么样」，不注册动作；动作集中在这里，便于一眼看清全部交互面。
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;
  var ui = Aura.ui;
  var store = Aura.store;

  var ROUTES = ['home', 'library', 'search', 'nowplaying', 'settings', 'detail'];

  var NAV = [
    { route: 'home', label: '首页', icon: 'home' },
    { route: 'library', label: '资料库', icon: 'library' },
    { route: 'search', label: '搜索', icon: 'search' },
    { route: 'nowplaying', label: '正在播放', icon: 'headphones' },
  ];

  var els = {};
  var currentView = null;
  var lastRoute = null;
  var miniViz = null;
  var queueModalHost = null;
  var history = [];
  var historyIndex = -1;

  /* ================================================================== *
   * 1. 外壳
   * ================================================================== */

  /** 把 index.html 里 data-icon 占位替换成真实 SVG（icons.js 是唯一图标来源） */
  function hydrateStaticIcons() {
    Aura.icons.hydrate(document);
  }

  function navMarkup() {
    var route = store.state.route;
    var queueCount = store.state.queue.length;
    return NAV.map(function (item) {
      var badge = item.route === 'nowplaying' && queueCount ? queueCount : '';
      return '<button type="button" class="nav-item' + (item.route === route ? ' is-active' : '') + '"' +
        ' data-act="go" data-route="' + item.route + '">' +
        '<span class="nav-item__icon">' + Aura.icon(item.icon, { size: 18 }) + '</span>' +
        '<span class="nav-item__label">' + item.label + '</span>' +
        (badge ? '<span class="nav-item__badge">' + badge + '</span>' : '') +
      '</button>';
    }).join('');
  }

  function syncNav() {
    if (!els.nav) return;
    els.nav.innerHTML = navMarkup();
    if (els.sourceLabel) els.sourceLabel.textContent = Aura.api.getSourceLabel();
  }

  /** 胶囊里的后退/前进：按历史栈位置切换可用态（按钮在 index.html 中静态声明） */
  function syncHistory() {
    var back = util.qs('[data-act="nav-back"]');
    var forward = util.qs('[data-act="nav-forward"]');
    if (back) back.disabled = historyIndex <= 0;
    if (forward) forward.disabled = historyIndex >= history.length - 1;
  }

  /* ---------- 播放条 ---------- */

  function renderPlayerbar() {
    els.playerbar.innerHTML =
      '<div class="playerbar__now">' +
        '<div class="playerbar__cover cover cover--flat" data-pb-cover role="button" tabindex="0"' +
          ' data-act="go" data-route="nowplaying" aria-label="打开正在播放"></div>' +
        '<div class="playerbar__meta">' +
          '<div class="playerbar__title truncate" data-pb-title>未在播放</div>' +
          '<div class="playerbar__artist truncate" data-pb-artist>挑一首开始吧</div>' +
        '</div>' +
        '<span data-pb-like></span>' +
      '</div>' +
      '<div class="playerbar__center">' +
        '<div class="playerbar__controls">' +
          '<span data-pb-shuffle></span>' +
          '<span data-pb-prev></span>' +
          '<span data-pb-play></span>' +
          '<span data-pb-next></span>' +
          '<span data-pb-repeat></span>' +
        '</div>' +
        '<div class="playerbar__progress">' +
          '<span class="playerbar__time" data-pb-elapsed>0:00</span>' +
          '<div class="progress"><input type="range" class="slider slider--thin" min="0" max="1000" value="0"' +
            ' data-input="seek" data-change="seek" aria-label="播放进度"></div>' +
          '<span class="playerbar__time" data-pb-total>0:00</span>' +
        '</div>' +
      '</div>' +
      '<div class="playerbar__right">' +
        '<canvas class="mini-viz" data-pb-viz aria-hidden="true"></canvas>' +
        '<span data-pb-mute></span>' +
        '<div class="volume">' +
          '<input type="range" class="slider slider--thin" min="0" max="100" value="80"' +
            ' data-input="volume" aria-label="音量">' +
        '</div>' +
        '<span data-pb-queue></span>' +
      '</div>';

    var canvas = util.qs('[data-pb-viz]', els.playerbar);
    if (canvas) {
      miniViz = Aura.visualizer.create(canvas, {
        compact: true,
        style: store.state.prefs.vizStyle,
      });
      miniViz.start();
    }

    syncNow();
    syncTransport();
    syncVolume();
    syncProgress();
  }

  function syncNow() {
    var track = Aura.player.current();
    var cover = util.qs('[data-pb-cover]', els.playerbar);
    var title = util.qs('[data-pb-title]', els.playerbar);
    var artist = util.qs('[data-pb-artist]', els.playerbar);
    var like = util.qs('[data-pb-like]', els.playerbar);
    if (!cover) return;

    var art = track ? ui.coverOf(track) : '';
    cover.innerHTML = art
      ? '<img src="' + ui.esc(art) + '" alt="" draggable="false">'
      : '<div class="cover__fallback">' + Aura.icon('disc', { size: 22 }) + '</div>';

    title.textContent = track ? track.title : '未在播放';
    artist.textContent = track ? ui.artistName(track) : '挑一首开始吧';

    var liked = track ? !!store.state.liked[track.id] : false;
    like.innerHTML = track
      ? ui.iconBtn(liked ? 'heart-filled' : 'heart', {
          cls: 'icon-btn--sm' + (liked ? ' is-active' : ''),
          act: 'toggle-like', data: { id: track.id },
          tip: liked ? '取消收藏' : '收藏', size: 16,
        })
      : '';
  }

  function syncTransport() {
    var s = store.state;
    var shuffle = util.qs('[data-pb-shuffle]', els.playerbar);
    var prev = util.qs('[data-pb-prev]', els.playerbar);
    var play = util.qs('[data-pb-play]', els.playerbar);
    var next = util.qs('[data-pb-next]', els.playerbar);
    var repeat = util.qs('[data-pb-repeat]', els.playerbar);
    if (!play) return;

    shuffle.innerHTML = ui.iconBtn('shuffle', {
      cls: s.shuffle ? 'is-active' : '', act: 'toggle-shuffle',
      tip: s.shuffle ? '关闭随机播放' : '随机播放', size: 16,
    });
    prev.innerHTML = ui.iconBtn('skip-back', { act: 'player-prev', tip: '上一首', size: 18 });
    play.innerHTML = '<button type="button" class="play-btn" data-act="toggle-play" aria-label="' +
      (s.playing ? '暂停' : '播放') + '">' +
      Aura.icon(s.playing ? 'pause' : 'play', { size: 18 }) + '</button>';
    next.innerHTML = ui.iconBtn('skip-forward', { act: 'player-next', tip: '下一首', size: 18 });

    var repeatLabel = s.repeat === 'one' ? '单曲循环' : s.repeat === 'all' ? '列表循环' : '顺序播放';
    repeat.innerHTML = ui.iconBtn(s.repeat === 'one' ? 'repeat-one' : 'repeat', {
      cls: s.repeat === 'off' ? '' : 'is-active', act: 'cycle-repeat', tip: repeatLabel, size: 16,
    });
  }

  function syncVolume() {
    var s = store.state;
    var mute = util.qs('[data-pb-mute]', els.playerbar);
    var input = util.qs('[data-input="volume"]', els.playerbar);
    if (!mute || !input) return;

    var icon = s.muted || s.volume === 0 ? 'volume-mute' : s.volume < 0.45 ? 'volume-low' : 'volume-high';
    mute.innerHTML = ui.iconBtn(icon, {
      act: 'toggle-mute', tip: s.muted ? '取消静音' : '静音', size: 17,
    });

    input.value = String(Math.round(s.volume * 100));
    ui.syncSliderFill(input);
  }

  function syncProgress() {
    var s = store.state;
    var elapsed = util.qs('[data-pb-elapsed]', els.playerbar);
    var total = util.qs('[data-pb-total]', els.playerbar);
    var input = util.qs('[data-input="seek"]', els.playerbar);
    if (!elapsed || !input) return;

    elapsed.textContent = util.formatTime(s.currentTime);
    total.textContent = util.formatTime(s.duration);

    var ratio = s.duration ? util.clamp(s.currentTime / s.duration, 0, 1) : 0;
    input.value = String(Math.round(ratio * 1000));
    ui.syncSliderFill(input);
  }

  /* ================================================================== *
   * 2. 路由
   * ================================================================== */

  function remount() {
    var route = store.state.route;
    var view = Aura.views[route];
    if (!view || !els.viewHost) return;

    if (lastRoute === 'detail' && route !== 'detail' && Aura.views.detail.reset) {
      Aura.views.detail.reset();
    }
    if (currentView && currentView !== view && typeof currentView.leave === 'function') {
      currentView.leave();
    }

    currentView = view;
    lastRoute = route;
    els.viewHost.scrollTop = 0;
    view.render(els.viewHost);

    syncHistory();
    syncNav();
  }

  function navigate(route, params, opts) {
    opts = opts || {};
    if (ROUTES.indexOf(route) === -1) route = 'home';
    params = params || {};

    if (!opts.replace) {
      history = history.slice(0, historyIndex + 1);
      history.push({ route: route, params: params });
      historyIndex = history.length - 1;
    }

    var same = store.state.route === route &&
      JSON.stringify(store.state.routeParams) === JSON.stringify(params);

    if (same && !opts.force) {
      remount();
      return;
    }

    store.set({ route: route, routeParams: params });
  }

  function stepHistory(delta) {
    var next = historyIndex + delta;
    if (next < 0 || next >= history.length) return;
    historyIndex = next;
    var entry = history[historyIndex];
    navigate(entry.route, entry.params, { replace: true });
  }

  /* ================================================================== *
   * 3. 曲目解析
   * ================================================================== */

  function findTrack(id) {
    var s = store.state;
    var pools = [s.queue, s.tracks, (s.searchResults && s.searchResults.tracks) || []];
    if (s.home) {
      pools.push(s.home.recent || []);
      (s.home.shelves || []).forEach(function (shelf) {
        if (shelf.type === 'track') pools.push(shelf.items || []);
      });
    }
    for (var i = 0; i < pools.length; i++) {
      var hit = (pools[i] || []).filter(function (track) { return track && track.id === id; })[0];
      if (hit) return hit;
    }
    return null;
  }

  /** 行上只带短键，真实对象从「上下文注册表」取；取不到再回落到全局缓存 */
  function resolveTrack(dataset) {
    if (!dataset.id) return null;
    var context = dataset.ctx ? ui.getContext(dataset.ctx) : [];
    var hit = context.filter(function (track) { return track && track.id === dataset.id; })[0];
    return hit || findTrack(dataset.id);
  }

  function resolveContext(dataset) {
    if (dataset.ctx) return ui.getContext(dataset.ctx);
    return store.state.queue.slice();
  }

  /* ================================================================== *
   * 4. 播放条队列浮层
   * ================================================================== */

  function paintQueueModal() {
    if (!queueModalHost) return;
    var s = store.state;
    queueModalHost.innerHTML = s.queue.length
      ? Aura.views.nowplaying.queueList()
      : ui.emptyState('queue', '队列是空的', '播放任意专辑或歌单即可建立队列。');
    ui.syncAllSliders(queueModalHost);
  }

  /* ================================================================== *
   * 5. 状态订阅
   * ================================================================== */

  // 注意参数顺序：store.notify 的回调约定是 (state, changedKeys)
  function syncShell(state, changed) {
    // routeParams 必须一起判断：详情页之间互跳时 route 仍是 'detail'，
    // 只有 params 变化，若只看 route 会漏掉重绘。
    if (changed.indexOf('route') !== -1 || changed.indexOf('routeParams') !== -1) {
      remount();
    }

    if (changed.indexOf('prefs') !== -1) {
      Aura.theme.apply(state.prefs);
      if (miniViz) miniViz.setStyle(state.prefs.vizStyle);
      syncTransport();
      syncProgress();
      syncVolume();
    }

    if (changed.indexOf('queue') !== -1 || changed.indexOf('queueIndex') !== -1) {
      syncNow();
      syncNav();
    }
    if (changed.indexOf('playing') !== -1) syncTransport();
    if (changed.indexOf('currentTime') !== -1 || changed.indexOf('duration') !== -1) syncProgress();
    if (changed.indexOf('volume') !== -1 || changed.indexOf('muted') !== -1) syncVolume();
    if (changed.indexOf('shuffle') !== -1 || changed.indexOf('repeat') !== -1) syncTransport();
    if (changed.indexOf('liked') !== -1) syncNow();

    paintQueueModal();

    if (currentView && typeof currentView.onState === 'function') {
      currentView.onState(changed, state);
    }
  }

  /* ================================================================== *
   * 6. 动作
   * ================================================================== */

  function registerActions() {
    /* ---------- 导航 ---------- */

    ui.action('go', function (dataset) {
      if (dataset.section) store.set({ settingsSection: dataset.section });
      if (dataset.route === 'detail') {
        navigate('detail', { kind: dataset.kind, id: dataset.id });
        return;
      }
      navigate(dataset.route);
    });

    ui.action('nav-back', function () { stepHistory(-1); });
    ui.action('nav-forward', function () { stepHistory(1); });

    ui.action('open-album', function (dataset) { navigate('detail', { kind: 'album', id: dataset.id }); });
    ui.action('open-artist', function (dataset) { navigate('detail', { kind: 'artist', id: dataset.id }); });
    ui.action('open-playlist', function (dataset) { navigate('detail', { kind: 'playlist', id: dataset.id }); });

    ui.action('reload-home', function () {
      store.set({ home: null, loadError: null });
      remount();
    });

    ui.action('reload-library', function () {
      store.set({ albums: null, artists: null, playlists: null, tracks: null, loadError: null });
      remount();
    });

    /* ---------- 播放 ---------- */

    ui.action('play-track', function (dataset) {
      var track = resolveTrack(dataset);
      if (!track) return;
      if (Aura.player.isCurrent(track.id)) {
        Aura.player.toggle();
        return;
      }
      var context = dataset.ctx ? ui.getContext(dataset.ctx) : null;
      Aura.player.playTrack(track, context && context.length ? context : null);
    });

    ui.action('play-collection', function (dataset) {
      var tracks = resolveContext(dataset);
      if (!tracks.length) {
        ui.toast('这个列表里还没有曲目', 'info');
        return;
      }
      Aura.player.playList(tracks, 0);
      ui.toast('开始播放 ' + tracks.length + ' 首曲目', 'success');
    });

    ui.action('shuffle-collection', function (dataset) {
      var tracks = resolveContext(dataset);
      if (!tracks.length) {
        ui.toast('这个列表里还没有曲目', 'info');
        return;
      }
      Aura.player.setShuffle(true);
      Aura.player.playList(tracks, Math.floor(Math.random() * tracks.length));
    });

    ui.action('play-album', function (dataset) {
      Aura.api.getAlbum(dataset.id).then(function (album) {
        if (!album.tracks || !album.tracks.length) {
          ui.toast('这张专辑还没有曲目', 'info');
          return;
        }
        Aura.player.playList(album.tracks, 0);
      }).catch(function (err) { ui.toast(err.message, 'danger'); });
    });

    ui.action('play-playlist', function (dataset) {
      Aura.api.getPlaylist(dataset.id).then(function (playlist) {
        if (!playlist.tracks || !playlist.tracks.length) {
          ui.toast('这个歌单还没有曲目', 'info');
          return;
        }
        Aura.player.playList(playlist.tracks, 0);
      }).catch(function (err) { ui.toast(err.message, 'danger'); });
    });

    // 点任意一盘磁带 → 取回它的曲目、从第一首开始播放、切到「正在播放」。
    // 「选中」是滑动带来的：离轨道中心最近的那盘会放大点亮，点击则是明确的播放指令。
    ui.action('tape-play', function (dataset) {
      var tapes = (store.state.home && store.state.home.tapes) || [];
      var tape = tapes.filter(function (item) { return item.key === dataset.key; })[0];
      if (!tape) return;
      var isPlaylist = tape.type === 'playlist';
      var fetcher = isPlaylist ? Aura.api.getPlaylist(tape.id) : Aura.api.getAlbum(tape.id);

      fetcher.then(function (collection) {
        var tracks = (collection && collection.tracks) || [];
        if (!tracks.length) {
          ui.toast(isPlaylist ? '这个歌单还没有曲目' : '这张专辑还没有曲目', 'info');
          return;
        }
        Aura.player.playList(tracks, 0);
        ui.toast('正在播放《' + tape.title + '》', 'success');
        navigate('nowplaying');
      }).catch(function (err) { ui.toast(err.message, 'danger'); });
    });

    ui.action('tape-step', function (dataset) {
      if (Aura.views.home && Aura.views.home.step) {
        Aura.views.home.step(Number(dataset.delta) || 0);
      }
    });

    ui.action('play-genre', function (dataset) {
      var genres = store.state.genres || [];
      var genre = genres.filter(function (item) { return item.id === dataset.id; })[0];
      if (!genre) return;
      Aura.api.getTracks().then(function (tracks) {
        var hit = tracks.filter(function (track) {
          return track.album && track.album.title !== undefined &&
            (track.album.genre === genre.name ||
             (track.artist && (track.artist.genres || []).indexOf(genre.name) !== -1));
        });
        if (!hit.length) {
          ui.toast('「' + genre.name + '」暂时没有曲目', 'info');
          return;
        }
        Aura.player.setShuffle(true);
        Aura.player.playList(hit, 0);
      }).catch(function (err) { ui.toast(err.message, 'danger'); });
    });

    ui.action('play-random', function () {
      Aura.api.getTracks().then(function (tracks) {
        if (!tracks.length) return;
        Aura.player.setShuffle(true);
        Aura.player.playList(tracks, Math.floor(Math.random() * tracks.length));
      }).catch(function (err) { ui.toast(err.message, 'danger'); });
    });

    ui.action('toggle-play', function () { Aura.player.toggle(); });
    ui.action('player-next', function () { Aura.player.next(false); });
    ui.action('player-prev', function () { Aura.player.prev(); });
    ui.action('toggle-shuffle', function () { Aura.player.setShuffle(!store.state.shuffle); });
    ui.action('cycle-repeat', function () { Aura.player.cycleRepeat(); });
    ui.action('toggle-mute', function () { Aura.player.toggleMute(); });

    ui.action('volume', function (_dataset, node) {
      Aura.player.setVolume(Number(node.value) / 100);
    });

    ui.action('seek', function (_dataset, node) {
      Aura.player.seekRatio(Number(node.value) / 1000);
    });

    /* ---------- 收藏与队列 ---------- */

    ui.action('toggle-like', function (dataset) {
      var on = store.toggleLiked(dataset.id);
      ui.toast(on ? '已加入收藏' : '已取消收藏', on ? 'success' : 'info');
    });

    ui.action('queue-add', function (dataset) {
      var track = resolveTrack(dataset);
      if (track) Aura.player.addToQueue(track);
    });

    ui.action('queue-jump', function (dataset) {
      Aura.player.jumpTo(Number(dataset.index));
    });

    ui.action('queue-remove', function (dataset) {
      Aura.player.removeFromQueue(Number(dataset.index));
    });

    ui.action('queue-clear', function () {
      Aura.player.clearQueue();
      ui.closeOverlay();
    });

    ui.action('open-queue', function () {
      ui.openModal({
        title: '播放队列',
        size: 'min(520px, 100%)',
        body: '<div data-queue-modal></div>',
        foot: ui.btn('清空队列', { variant: 'danger', act: 'queue-clear' }) +
          ui.btn('关闭', { act: 'close-overlay' }),
        onMount: function (modal) {
          queueModalHost = util.qs('[data-queue-modal]', modal);
          paintQueueModal();
        },
        onClose: function () { queueModalHost = null; },
      });
    });

    /* ---------- 曲目更多操作 ---------- */

    ui.action('track-menu', function (dataset, node) {
      var track = resolveTrack(dataset);
      if (!track) return;
      var liked = !!store.state.liked[track.id];
      var rect = node.getBoundingClientRect();
      var ctx = dataset.ctx || '';
      var inQueue = Aura.player.queuePosition(track.id) > 0;

      ui.menu([
        { icon: 'play', label: '播放', act: 'menu-play', data: { id: track.id, ctx: ctx } },
        { icon: 'queue', label: '下一首播放', act: 'menu-play-next', data: { id: track.id, ctx: ctx } },
        { icon: 'plus', label: '加入队列', act: 'queue-add', data: { id: track.id, ctx: ctx } },
        { sep: true },
        { icon: liked ? 'heart-filled' : 'heart', label: liked ? '取消收藏' : '收藏',
          act: 'toggle-like', data: { id: track.id } },
        track.album ? { icon: 'disc', label: '查看专辑', act: 'open-album', data: { id: track.album.id } } : null,
        track.artist ? { icon: 'user', label: '查看艺人', act: 'open-artist', data: { id: track.artist.id } } : null,
        { icon: 'copy', label: '复制歌曲信息', act: 'copy-track', data: { id: track.id, ctx: ctx } },
        { sep: true },
        { icon: 'trash', label: '从队列移除', danger: true, disabled: !inQueue,
          act: 'menu-queue-remove', data: { id: track.id } },
      ].filter(Boolean), rect.left, rect.bottom + 6);
    });

    ui.action('menu-play', function (dataset) {
      var track = resolveTrack(dataset);
      if (!track) return;
      var context = dataset.ctx ? ui.getContext(dataset.ctx) : null;
      Aura.player.playTrack(track, context && context.length ? context : null);
    });

    ui.action('menu-play-next', function (dataset) {
      var track = resolveTrack(dataset);
      if (track) Aura.player.playNext(track);
    });

    ui.action('menu-queue-remove', function (dataset) {
      var position = Aura.player.queuePosition(dataset.id);
      if (position > 0) Aura.player.removeFromQueue(position - 1);
    });

    ui.action('copy-track', function (dataset) {
      var track = resolveTrack(dataset);
      if (!track) return;
      var text = track.title + ' — ' + ui.artistName(track) +
        (ui.albumTitle(track) ? '（' + ui.albumTitle(track) + '）' : '');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          ui.toast('已复制歌曲信息', 'success');
        }).catch(function () { ui.toast('复制失败，请手动选择文本', 'danger'); });
      } else {
        ui.toast(text, 'info');
      }
    });

    /* ---------- 搜索 ---------- */

    ui.action('search-input', function (_dataset, node) {
      Aura.views.search.schedule(node.value);
    });

    ui.action('search-use', function (dataset) {
      var input = util.qs('[data-search-input]');
      if (input) input.value = dataset.q;
      Aura.views.search.run(dataset.q);
      Aura.views.search.pushHistory(dataset.q);
    });

    ui.action('search-clear', function () {
      var input = util.qs('[data-search-input]');
      if (input) {
        input.value = '';
        input.focus();
      }
      Aura.views.search.run('');
    });

    ui.action('search-clear-history', function () {
      Aura.views.search.clearHistory();
      remount();
    });

    /* ---------- 资料库 ---------- */

    ui.action('library-tab', function (dataset) {
      Aura.views.library.control('tab', dataset.tab);
    });

    ui.action('library-filter', function (_dataset, node) {
      Aura.views.library.control('query', node.value);
    });

    ui.action('library-sort', function (_dataset, node) {
      Aura.views.library.control('sort', node.value);
    });

    ui.action('library-clear', function () {
      Aura.views.library.control('clear');
    });

    /* ---------- 偏好（通用） ---------- */

    ui.action('pref-toggle', function (dataset) {
      store.setPref(dataset.path, !store.getPref(dataset.path));
      Aura.player.refresh();
    });

    ui.action('pref-set', function (dataset) {
      store.setPref(dataset.path, dataset.value);
      Aura.player.refresh();
    });

    ui.action('pref-select', function (dataset, node) {
      store.setPref(dataset.path, node.value);
      Aura.player.refresh();
    });

    ui.action('pref-range', function (dataset, node) {
      var value = Number(node.value);
      store.setPref(dataset.path, value);
      var label = util.qs('[data-value-for="' + dataset.path + '"]');
      if (label && Aura.views.settings && Aura.views.settings.valueText) {
        label.textContent = Aura.views.settings.valueText(dataset.path, value);
      }
      Aura.player.refresh();
    });

    ui.action('layout-pick', function (dataset) {
      store.setPref('npLayout', dataset.layout);
    });

    ui.action('viz-style-pick', function (dataset) {
      store.setPref('vizStyle', dataset.style);
    });

    ui.action('close-overlay', function () {
      ui.closeOverlay();
    });
  }

  /* ================================================================== *
   * 7. 键盘
   * ================================================================== */

  function bindKeyboard() {
    document.addEventListener('keydown', function (event) {
      // ui.bind 已处理的按键（role=button 上的 Enter/Space）不再重复响应，
      // 否则空格会在磁带开始播放的同一帧又把它暂停。
      if (event.defaultPrevented) return;

      var node = event.target;
      if (node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable)) {
        if (event.key === 'Escape') node.blur();
        return;
      }
      var meta = event.metaKey || event.ctrlKey;
      var key = event.key;

      // 首页：左右方向键在货架上前后选带，而不是快进快退
      if (store.state.route === 'home' && !meta &&
          (key === 'ArrowLeft' || key === 'ArrowRight')) {
        event.preventDefault();
        if (Aura.views.home && Aura.views.home.step) {
          Aura.views.home.step(key === 'ArrowRight' ? 1 : -1);
        }
        return;
      }

      if (key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        Aura.player.toggle();
        return;
      }
      if (key === 'ArrowRight') { Aura.player.seekBy(event.shiftKey ? 30 : 5); return; }
      if (key === 'ArrowLeft') { Aura.player.seekBy(event.shiftKey ? -30 : -5); return; }
      if (key === 'ArrowUp') { event.preventDefault(); Aura.player.setVolume(store.state.volume + 0.05); return; }
      if (key === 'ArrowDown') { event.preventDefault(); Aura.player.setVolume(store.state.volume - 0.05); return; }
      if (key === '/' || (meta && key.toLowerCase() === 'f')) {
        event.preventDefault();
        navigate('search');
        Aura.views.search.focusInput();
        return;
      }
      if (meta && ['1', '2', '3', '4'].indexOf(key) !== -1) {
        event.preventDefault();
        navigate(NAV[Number(key) - 1].route);
      }
    });
  }

  /* ================================================================== *
   * 8. 启动
   * ================================================================== */

  var app = {
    info: {
      version: '0.1.0',
      runtime: window.desktop && window.desktop.isElectron
        ? 'Electron ' + window.desktop.version + ' · ' + window.desktop.platform
        : '浏览器',
    },

    navigate: navigate,
    remount: remount,

    init: function () {
      els.nav = util.qs('[data-nav]');
      els.sourceLabel = util.qs('[data-source-label]');
      els.viewHost = util.qs('[data-view-host]');
      els.playerbar = util.qs('[data-playerbar]');

      if (!window.desktop) document.documentElement.classList.add('is-browser');
      Aura.theme.apply(store.state.prefs);
      hydrateStaticIcons();
      ui.bind();
      registerActions();
      Aura.player.init();
      renderPlayerbar();
      bindKeyboard();
      store.subscribe(syncShell);

      // 首屏先给骨架，等数据源确定后再真正加载，避免用错适配器
      els.viewHost.innerHTML = '<div class="view">' + ui.skeletonHero() +
        '<div style="margin-top:var(--sp-10)">' + ui.skeletonCards(6) + '</div></div>';

      return Aura.api.init().then(function () {
        syncNav();
        navigate('home', {}, { replace: true });
        seedAccentFromHome();
      });
    },
  };

  /** 尚未播放任何曲目时，用货架第一盘磁带的封面主色作为初始强调色 */
  function seedAccentFromHome() {
    var off = store.subscribe(function (state, changed) {
      if (changed.indexOf('home') === -1 || !state.home || !state.home.tapes) return;
      off();
      if (state.prefs.accentMode !== 'cover' || Aura.player.current()) return;
      var tape = state.home.tapes[0];
      if (!tape || !tape.cover) return;
      Aura.color.extract(tape.cover, 'home-seed').then(function (palette) {
        if (Aura.player.current()) return;
        Aura.theme.applyCoverColors(palette.primary, palette.secondary);
        Aura.theme.applyAccent(Aura.theme.resolveAccent(store.state.prefs, palette.primary));
      });
    });
  }

  Aura.app = app;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { app.init(); });
  } else {
    app.init();
  }
})(window.Aura = window.Aura || {});
