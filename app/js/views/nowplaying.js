/**
 * Aura · 正在播放
 *
 * 同一份内容骨架，四种排布：沉浸 / 分栏 / 列表 / 画布。
 * 布局切换只改 .np 上的 data-layout，DOM 结构不变，因此切换是「重排」而不是「重建」。
 *
 * 性能约定（这一页最容易做坏的地方）：
 *   进度每 250ms 回写一次状态，若整页重绘会持续打断歌词滚动与频谱。
 *   因此 onState 里只做定点更新：
 *     currentTime → 仅切换歌词行的激活态（二分查找）
 *     playing     → 仅换播放键图标与跳动条
 *     liked       → 仅换收藏图标
 *   只有「换歌 / 换布局 / 换歌词」才整页重绘。
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;
  var ui = Aura.ui;
  var store = Aura.store;

  var LAYOUTS = [
    { id: 'immersive', name: '沉浸', desc: '封面居中，歌词浮于其下', icon: 'disc' },
    { id: 'split', name: '分栏', desc: '左封面右歌词', icon: 'panel-left' },
    { id: 'list', name: '列表', desc: '歌词 + 播放队列同屏', icon: 'list' },
    { id: 'canvas', name: '画布', desc: '频谱铺满，信息压底', icon: 'activity' },
  ];

  var hostRef = null;
  var viz = null;
  var lyricView = null;
  var renderedId = null;
  var renderedLayout = null;

  function prefs() {
    return store.state.prefs;
  }

  function currentTrack() {
    return Aura.player.current();
  }

  /* ------------------------------------------------------------------ *
   * 顶部工具条
   * ------------------------------------------------------------------ */

  function layoutPicker() {
    var active = prefs().npLayout;
    return '<div class="segmented" role="tablist" aria-label="正在播放布局">' +
      LAYOUTS.map(function (layout) {
        return '<button type="button" class="segmented__item' + (layout.id === active ? ' is-active' : '') + '"' +
          ' role="tab" aria-selected="' + (layout.id === active) + '" data-tip="' + ui.esc(layout.name) + '"' +
          ' data-act="layout-pick" data-layout="' + layout.id + '">' +
          Aura.icon(layout.icon, { size: 14 }) + '<span>' + layout.name + '</span>' +
        '</button>';
      }).join('') +
    '</div>';
  }

  function toolbar() {
    var s = store.state;
    return '<div class="view" style="padding-bottom:0"><div class="np-bar">' +
      layoutPicker() +
      '<div class="view-toolbar__group">' +
        '<button type="button" class="chip' + (s.prefs.vizEnabled ? ' is-active' : '') + '"' +
          ' data-act="pref-toggle" data-path="vizEnabled" aria-pressed="' + !!s.prefs.vizEnabled + '">' +
          Aura.icon('activity', { size: 14 }) + '<span>可视化</span>' +
        '</button>' +
        '<button type="button" class="chip" data-act="go" data-route="settings" data-section="playback">' +
          Aura.icon('sliders', { size: 14 }) + '<span>播放设置</span>' +
        '</button>' +
        ui.btn('队列', { icon: 'queue', act: 'open-queue' }) +
      '</div>' +
    '</div></div>';
  }

  /* ------------------------------------------------------------------ *
   * 封面 / 信息
   * ------------------------------------------------------------------ */

  function artBlock(track) {
    var cover = ui.coverOf(track);
    return '<div class="np__art">' +
      (cover
        ? '<img src="' + ui.esc(cover) + '" alt="' + ui.esc(track.title) + '" draggable="false">'
        : '<div class="cover__fallback">' + Aura.icon('disc', { size: 48 }) + '</div>') +
    '</div>';
  }

  function metaRow(track) {
    var bits = [];
    if (track.album && track.album.title) bits.push(track.album.title);
    if (track.album && track.album.year) bits.push(String(track.album.year));
    var pos = Aura.player.queuePosition(track.id);
    if (pos) bits.push('队列 ' + pos + ' / ' + store.state.queue.length);

    return '<div class="np__meta-row">' +
      bits.map(function (bit) { return '<span>' + ui.esc(bit) + '</span>'; })
        .join('<span class="dot" style="width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.6"></span>') +
      ui.qualityTag(track.quality) +
    '</div>';
  }

  function infoBlock(track) {
    var s = store.state;
    var liked = !!s.liked[track.id];
    return '<div class="np__info">' +
      '<div class="np__eyebrow">正在播放</div>' +
      '<div class="np__title">' + ui.esc(track.title) + '</div>' +
      '<div class="np__artist">' + ui.esc(ui.artistName(track)) + '</div>' +
      metaRow(track) +
      '<div class="np__actions">' +
        '<button type="button" class="play-btn play-btn--hero" data-act="toggle-play"' +
          ' aria-label="' + (s.playing ? '暂停' : '播放') + '">' +
          Aura.icon(s.playing ? 'pause' : 'play', { size: 22 }) + '</button>' +
        ui.iconBtn(liked ? 'heart-filled' : 'heart', {
          cls: 'icon-btn--lg' + (liked ? ' is-active' : ''),
          act: 'toggle-like', data: { id: track.id },
          tip: liked ? '取消收藏' : '收藏', size: 20,
        }) +
        ui.iconBtn('queue', {
          cls: 'icon-btn--lg', act: 'queue-add', data: { id: track.id, ctx: '' },
          tip: '加入队列', size: 20,
        }) +
        ui.iconBtn('more-horizontal', {
          cls: 'icon-btn--lg', act: 'track-menu', data: { id: track.id, ctx: '' },
          tip: '更多操作', size: 20,
        }) +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------------ *
   * 歌词
   * ------------------------------------------------------------------ */

  function lyricsBlock() {
    return '<div class="np__lyrics"><div class="lyrics__scroll" data-lyrics-scroll></div></div>';
  }

  /* ------------------------------------------------------------------ *
   * 频谱
   * ------------------------------------------------------------------ */

  function vizBlock(hero) {
    if (!prefs().vizEnabled) return '';
    return '<div class="np__viz' + (hero ? ' np__viz--hero' : '') + '">' +
      '<canvas data-viz></canvas></div>';
  }

  /* ------------------------------------------------------------------ *
   * 队列
   * ------------------------------------------------------------------ */

  function queueItem(track, index) {
    var s = store.state;
    return '<div class="queue-item' + (index === s.queueIndex ? ' is-current' : '') + '"' +
      ' data-act="queue-jump" data-index="' + index + '" role="button" tabindex="0"' +
      ' aria-label="播放 ' + ui.esc(track.title) + '">' +
      '<div class="queue-item__index">' + (index === s.queueIndex ? Aura.icon('play', { size: 11 }) : index + 1) + '</div>' +
      '<div class="queue-item__text">' +
        '<div class="queue-item__title">' + ui.esc(track.title) + '</div>' +
        '<div class="queue-item__artist">' + ui.esc(ui.artistName(track)) + '</div>' +
      '</div>' +
      '<div class="queue-item__dur">' + util.formatTime(track.duration) + '</div>' +
      ui.iconBtn('x', {
        cls: 'icon-btn--sm', act: 'queue-remove', data: { index: index }, tip: '从队列移除', size: 14,
      }) +
    '</div>';
  }

  function queueBlock() {
    var s = store.state;
    var tracks = s.queue;
    var body = tracks.length
      ? '<div class="queue-list" data-queue-list>' + tracks.map(queueItem).join('') + '</div>'
      : ui.emptyState('queue', '队列是空的', '播放任意专辑或歌单即可建立队列。');

    return '<div class="np__queue">' +
      ui.sectionHead('播放队列', tracks.length ? '共 ' + tracks.length + ' 首' : '') +
      body +
    '</div>';
  }

  /* ------------------------------------------------------------------ *
   * 渲染
   * ------------------------------------------------------------------ */

  function skeleton() {
    return '<div class="view" style="padding-bottom:0"><div class="np-bar">' + layoutPicker() + '</div></div>' +
      '<div class="np" data-layout="' + prefs().npLayout + '">' +
        '<div class="np__art skeleton"></div>' +
        '<div class="np__info">' +
          '<div class="skeleton skeleton--text" style="width:120px"></div>' +
          '<div class="skeleton" style="height:34px;width:60%"></div>' +
          '<div class="skeleton skeleton--text" style="width:40%"></div>' +
        '</div>' +
      '</div>';
  }

  function emptyState() {
    return '<div class="view">' + ui.emptyState(
      'headphones', '还没有正在播放的曲目',
      '挑一张专辑或一个歌单开始播放，这里会展示封面、歌词与频谱。',
      ui.btn('去资料库', { variant: 'primary', icon: 'library', act: 'go', data: { route: 'library' } }) +
      ui.btn('随便听听', { icon: 'shuffle', act: 'play-random' })
    ) + '</div>';
  }

  function destroyWidgets() {
    if (viz) { viz.destroy(); viz = null; }
    if (lyricView) { lyricView.destroy(); lyricView = null; }
  }

  function mountWidgets(track) {
    var layout = prefs().npLayout;

    var scroll = util.qs('[data-lyrics-scroll]', hostRef);
    if (scroll) {
      lyricView = Aura.lyrics.createView(scroll);
      syncLyrics();
      scroll.addEventListener('click', function (event) {
        var line = event.target.closest('.lyric-line');
        if (!line) return;
        var time = lyricView.getLineTime(Number(line.dataset.index));
        if (time == null) return;
        Aura.player.seek(time);
        if (!store.state.playing) Aura.player.resume();
      });
    }

    var canvas = util.qs('[data-viz]', hostRef);
    if (canvas && prefs().vizEnabled) {
      viz = Aura.visualizer.create(canvas, {
        style: prefs().vizStyle,
        sensitivity: prefs().vizSensitivity,
      });
      viz.start();
    }

    renderedId = track.id;
    renderedLayout = layout;
  }

  function syncLyrics() {
    if (!lyricView) return;
    var lyrics = store.state.lyrics;
    lyricView.setLines(lyrics ? lyrics.lines : [], {
      showTranslation: prefs().showTranslation,
      emptyMessage: store.state.lyricsLoading ? '歌词加载中…' : '这首歌暂时没有歌词',
    });
    updateLyricActive();
  }

  function updateLyricActive() {
    if (!lyricView) return;
    var lines = lyricView.lines;
    if (!lines || !lines.length) return;
    lyricView.updateActive(Aura.lyrics.findIndex(lines, store.state.currentTime));
  }

  function paint() {
    destroyWidgets();

    var track = currentTrack();
    if (!track) {
      // 队列已建立但尚未定位到曲目：给出骨架而不是空态，避免闪一下「没有内容」
      hostRef.innerHTML = store.state.queue.length ? skeleton() : emptyState();
      renderedId = null;
      return;
    }

    var layout = prefs().npLayout;
    var body =
      artBlock(track) +
      infoBlock(track) +
      vizBlock(layout === 'immersive' || layout === 'split') +
      lyricsBlock() +
      (layout === 'list' ? queueBlock() : '');

    hostRef.innerHTML = toolbar() +
      '<div class="np" data-layout="' + layout + '">' +
        (layout === 'canvas' ? vizBlock(true) : '') +
        body +
      '</div>';

    ui.syncAllSliders(hostRef);
    mountWidgets(track);
  }

  /* ------------------------------------------------------------------ *
   * 定点更新
   * ------------------------------------------------------------------ */

  function refreshTransport() {
    var s = store.state;
    var btn = util.qs('.play-btn--hero', hostRef);
    if (btn) {
      btn.innerHTML = Aura.icon(s.playing ? 'pause' : 'play', { size: 22 });
      btn.setAttribute('aria-label', s.playing ? '暂停' : '播放');
    }
  }

  function refreshLike() {
    var track = currentTrack();
    if (!track) return;
    var btn = util.qs('.np__actions [data-act="toggle-like"]', hostRef);
    if (!btn) return;
    var on = !!store.state.liked[track.id];
    btn.classList.toggle('is-active', on);
    btn.innerHTML = Aura.icon(on ? 'heart-filled' : 'heart', { size: 20 });
    btn.setAttribute('data-tip', on ? '取消收藏' : '收藏');
  }

  function refreshQueue() {
    var holder = util.qs('.np__queue', hostRef);
    if (!holder) return;
    var fresh = queueBlock();
    var replacement = util.el('div');
    replacement.innerHTML = fresh;
    holder.replaceWith(replacement.firstChild);
    ui.syncAllSliders(hostRef);
  }

  function paintOrPatch() {
    var track = currentTrack();
    var trackId = track ? track.id : null;
    var layout = prefs().npLayout;

    if (trackId !== renderedId || layout !== renderedLayout) {
      paint();
      return;
    }
    refreshQueue();
  }

  /* ------------------------------------------------------------------ *
   * 视图
   * ------------------------------------------------------------------ */

  Aura.views = Aura.views || {};

  Aura.views.nowplaying = {
    heading: '正在播放',
    eyebrow: '播放',

    render: function (host) {
      hostRef = host;
      paint();
    },

    onState: function (changed) {
      if (!hostRef) return;

      if (changed.indexOf('prefs') !== -1) {
        // 可视化参数可以直接推给实例，不必重建 DOM
        if (viz) {
          viz.setStyle(store.state.prefs.vizStyle);
          viz.setSensitivity(store.state.prefs.vizSensitivity);
        }
        var wantsViz = !!store.state.prefs.vizEnabled;
        var hasViz = !!util.qs('[data-viz]', hostRef);
        if (store.state.prefs.npLayout !== renderedLayout || wantsViz !== hasViz) {
          paint();
          return;
        }
        // 翻译开关 / 歌词字号只影响歌词区
        syncLyrics();
        return;
      }

      if (changed.indexOf('queue') !== -1 || changed.indexOf('queueIndex') !== -1) {
        paintOrPatch();
        return;
      }

      if (changed.indexOf('lyrics') !== -1 || changed.indexOf('lyricsLoading') !== -1) {
        syncLyrics();
        return;
      }

      if (changed.indexOf('currentTime') !== -1) {
        updateLyricActive();
        return;
      }

      if (changed.indexOf('playing') !== -1) {
        refreshTransport();
        return;
      }

      if (changed.indexOf('liked') !== -1) refreshLike();
    },

    /** 路由离开时释放画布与滚动监听，避免后台空转 */
    leave: function () {
      destroyWidgets();
      hostRef = null;
      renderedId = null;
    },

    /** 供播放条的「播放队列」弹层复用（只给列表本身，不含标题容器） */
    queueList: function () {
      var tracks = store.state.queue;
      return '<div class="queue-list" data-queue-list>' +
        tracks.map(queueItem).join('') +
      '</div>';
    },
  };
})(window.Aura = window.Aura || {});
