/**
 * Aura · UI 原语
 *
 * 视图只做两件事：拼 HTML 字符串 + 声明 data-act。
 * 所有交互都由这里安装的一次性事件委托统一分发到 Aura.actions，
 * 因此不存在「渲染完忘记绑定事件」这类问题。
 *
 * 约定：
 *   data-act="动作名"      → click
 *   data-input="动作名"    → input（滑块实时反馈）
 *   data-change="动作名"   → change（下拉 / 复选框）
 *   其余参数以 data-* 传入，动作函数收到 (dataset, element, event)
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;

  function esc(value) {
    return util.escapeHtml(value);
  }

  /* ------------------------------------------------------------------ *
   * 上下文注册表
   *
   * 「播放这首」需要知道它属于哪个列表（用于建立播放队列）。
   * 视图渲染时把列表登记进来，行上只带一个短键，避免把数组塞进 data 属性。
   * ------------------------------------------------------------------ */

  var contexts = {};

  function setContext(key, tracks) {
    if (!key) return '';
    contexts[key] = tracks || [];
    return key;
  }

  function getContext(key) {
    return contexts[key] || [];
  }

  /* ------------------------------------------------------------------ *
   * 基础片段
   * ------------------------------------------------------------------ */

  function attr(map) {
    var out = '';
    Object.keys(map || {}).forEach(function (key) {
      var value = map[key];
      if (value == null || value === false) return;
      out += ' data-' + key + '="' + esc(value) + '"';
    });
    return out;
  }

  function iconBtn(name, opts) {
    opts = opts || {};
    var cls = 'icon-btn' + (opts.cls ? ' ' + opts.cls : '');
    var tip = opts.tip ? ' data-tip="' + esc(opts.tip) + '" aria-label="' + esc(opts.tip) + '"' : '';
    var act = opts.act ? ' data-act="' + esc(opts.act) + '"' : '';
    return '<button type="button" class="' + cls + '"' + act + attr(opts.data) + tip + '>' +
      Aura.icon(name, { size: opts.size || 18, stroke: opts.stroke || 1.75 }) + '</button>';
  }

  function btn(label, opts) {
    opts = opts || {};
    var cls = 'btn btn--' + (opts.variant || 'secondary') + (opts.cls ? ' ' + opts.cls : '');
    var act = opts.act ? ' data-act="' + esc(opts.act) + '"' : '';
    var icon = opts.icon ? Aura.icon(opts.icon, { size: opts.iconSize || 16 }) : '';
    var disabled = opts.disabled ? ' disabled' : '';
    return '<button type="button" class="' + cls + '"' + act + attr(opts.data) + disabled + '>' +
      icon + '<span>' + esc(label) + '</span></button>';
  }

  /** 封面块；opts: { url, alt, cls, overlay, playAct, playData, style } */
  function cover(url, opts) {
    opts = opts || {};
    var cls = 'cover' + (opts.round ? ' cover--round' : '') + (opts.flat ? ' cover--flat' : '') +
      (opts.cls ? ' ' + opts.cls : '');
    var img = url
      ? '<img src="' + esc(url) + '" alt="' + esc(opts.alt || '') + '" loading="lazy" draggable="false">'
      : '<div class="cover__fallback">' + Aura.icon('disc', { size: 28 }) + '</div>';
    var overlay = '';
    if (opts.overlay) {
      var inner = opts.playAct
        ? '<button type="button" class="play-btn" data-act="' + esc(opts.playAct) + '"' +
          attr(opts.playData) + ' aria-label="播放">' + Aura.icon('play', { size: 18 }) + '</button>'
        : '<span class="play-btn">' + Aura.icon('play', { size: 18 }) + '</span>';
      overlay = '<div class="cover__overlay">' + inner + '</div>';
    }
    return '<div class="' + cls + '"' + (opts.style ? ' style="' + opts.style + '"' : '') + '>' +
      img + overlay + '</div>';
  }

  /* ------------------------------------------------------------------ *
   * 曲目行
   * ------------------------------------------------------------------ */

  function artistName(track) {
    if (!track) return '未知艺人';
    if (track.artist && track.artist.name) return track.artist.name;
    return '未知艺人';
  }

  function albumTitle(track) {
    if (!track) return '';
    if (track.album && track.album.title) return track.album.title;
    return '';
  }

  function coverOf(item) {
    if (!item) return '';
    if (item.cover) return item.cover;
    if (item.album && item.album.cover) return item.album.cover;
    if (item.avatar) return item.avatar;
    return '';
  }

  function qualityTag(quality) {
    if (!quality) return '';
    if (String(quality).toLowerCase() === 'flac') {
      return '<span class="tag tag--lossless">FLAC</span>';
    }
    return '<span class="tag">' + esc(String(quality).toUpperCase()) + 'K</span>';
  }

  /**
   * 曲目行
   * @param {object} track
   * @param {object} [opts] { index, ctx, current, playing, liked, showCover, showAlbum }
   */
  function trackRow(track, opts) {
    opts = opts || {};
    var current = !!opts.current;
    var liked = !!opts.liked;

    var indexCell;
    if (current) {
      indexCell = '<span class="equalizer' + (opts.playing ? '' : ' is-paused') + '">' +
        '<span></span><span></span><span></span><span></span></span>';
    } else {
      indexCell = '<span class="track-row__num">' + esc(opts.index == null ? '' : opts.index + 1) + '</span>' +
        '<span class="track-row__play">' + Aura.icon('play', { size: 14 }) + '</span>';
    }

    var coverCell = opts.showCover === false ? '' :
      cover(coverOf(track), { cls: 'track-row__cover', flat: true, alt: track.title });

    return '<div class="track-row' + (current ? ' is-current' : '') + '" role="button" tabindex="0"' +
      ' data-act="play-track" data-id="' + esc(track.id) + '"' + attr({ ctx: opts.ctx }) +
      ' aria-label="播放 ' + esc(track.title) + '">' +
      '<div class="track-row__index">' + indexCell + '</div>' +
      '<div class="track-row__main">' + coverCell +
        '<div class="track-row__text">' +
          '<div class="track-row__title">' + esc(track.title) + '</div>' +
          '<div class="track-row__artist">' + esc(artistName(track)) + '</div>' +
        '</div>' +
      '</div>' +
      (opts.showAlbum === false ? '<div class="track-row__album"></div>'
        : '<div class="track-row__album">' + esc(albumTitle(track)) + '</div>') +
      '<div class="track-row__actions">' +
        iconBtn(liked ? 'heart-filled' : 'heart', {
          cls: 'icon-btn--sm' + (liked ? ' is-active' : ''),
          act: 'toggle-like', data: { id: track.id },
          tip: liked ? '取消收藏' : '收藏', size: 15,
        }) +
        iconBtn('more-horizontal', {
          cls: 'icon-btn--sm', act: 'track-menu',
          data: { id: track.id, ctx: opts.ctx || '' }, tip: '更多操作', size: 15,
        }) +
      '</div>' +
      '<div class="track-row__duration">' + util.formatTime(track.duration) + '</div>' +
    '</div>';
  }

  function trackListHead() {
    return '<div class="tracklist__head">' +
      '<div>#</div><div>标题</div><div>专辑</div><div></div>' +
      '<div style="text-align:right">时长</div>' +
    '</div>';
  }

  /**
   * 曲目列表
   * @param {Array} tracks
   * @param {object} [opts] { ctx, currentId, playing, liked, compact, showCover, showAlbum }
   */
  function trackList(tracks, opts) {
    opts = opts || {};
    var liked = opts.liked || {};
    var rows = (tracks || []).map(function (track, index) {
      return trackRow(track, {
        index: index,
        ctx: opts.ctx,
        current: track.id === opts.currentId,
        playing: opts.playing,
        liked: !!liked[track.id],
        showCover: opts.showCover,
        showAlbum: opts.showAlbum,
      });
    }).join('');
    return '<div class="tracklist' + (opts.compact ? ' tracklist--compact' : '') + '">' +
      (opts.head === false ? '' : trackListHead()) + rows + '</div>';
  }

  /* ------------------------------------------------------------------ *
   * 卡片
   * ------------------------------------------------------------------ */

  function albumCard(album, opts) {
    opts = opts || {};
    return '<article class="card" role="button" tabindex="0" data-act="open-album" data-id="' + esc(album.id) + '">' +
      cover(album.cover, {
        alt: album.title,
        overlay: true,
        playAct: 'play-album',
        playData: { id: album.id },
      }) +
      '<div>' +
        '<div class="card__title truncate">' + esc(album.title) + '</div>' +
        '<div class="card__meta truncate">' +
          esc((album.artist && album.artist.name) || '未知艺人') +
          (album.year ? ' · ' + album.year : '') +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function playlistCard(playlist) {
    return '<article class="card" role="button" tabindex="0" data-act="open-playlist" data-id="' + esc(playlist.id) + '">' +
      cover(playlist.cover, {
        alt: playlist.title,
        overlay: true,
        playAct: 'play-playlist',
        playData: { id: playlist.id },
      }) +
      '<div>' +
        '<div class="card__title truncate">' + esc(playlist.title) + '</div>' +
        '<div class="card__meta truncate">' +
          esc(playlist.trackCount ? playlist.trackCount + ' 首' : (playlist.curator || '歌单')) +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function artistCard(artist) {
    return '<article class="artist-card" role="button" tabindex="0" data-act="open-artist" data-id="' + esc(artist.id) + '">' +
      '<div class="artist-card__avatar">' +
        (artist.avatar
          ? '<img src="' + esc(artist.avatar) + '" alt="' + esc(artist.name) + '" loading="lazy" draggable="false">'
          : '') +
      '</div>' +
      '<div>' +
        '<div class="artist-card__name truncate">' + esc(artist.name) + '</div>' +
        '<div class="artist-card__meta truncate">' +
          esc(artist.trackCount ? artist.trackCount + ' 首曲目' : (artist.genres || []).join(' · ') || '艺人') +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function genreCard(genre) {
    var colors = genre.colors || ['#333', '#111'];
    return '<article class="genre-card" role="button" tabindex="0" data-act="play-genre" data-id="' + esc(genre.id) + '"' +
      ' style="background: linear-gradient(135deg, ' + esc(colors[0]) + ', ' + esc(colors[1]) + ')">' +
      '<div class="genre-card__name">' + esc(genre.name) + '</div>' +
      '<div class="genre-card__glyph">' + Aura.icon(genre.icon || 'disc', { size: 26, stroke: 1.5 }) + '</div>' +
    '</article>';
  }

  /** 根据条目类型自动选择卡片 */
  function anyCard(item) {
    if (!item) return '';
    if (item.avatar) return artistCard(item);
    if (item.curator !== undefined || item.system !== undefined) return playlistCard(item);
    return albumCard(item);
  }

  /* ------------------------------------------------------------------ *
   * 区块
   * ------------------------------------------------------------------ */

  function sectionHead(title, sub, actionHtml) {
    return '<div class="section-head">' +
      '<div>' +
        '<div class="section-head__title">' + esc(title) + '</div>' +
        (sub ? '<div class="section-head__sub">' + esc(sub) + '</div>' : '') +
      '</div>' +
      (actionHtml || '') +
    '</div>';
  }

  /** 横向货架（可横向滚动） */
  function shelf(items, type) {
    var cards = (items || []).map(function (item) {
      if (type === 'playlist') return playlistCard(item);
      if (type === 'artist') return artistCard(item);
      if (type === 'track') {
        return '<article class="card" role="button" tabindex="0" data-act="play-track" data-id="' + esc(item.id) + '"' +
          attr({ ctx: 'shelf' }) + '>' +
          cover(coverOf(item), { alt: item.title, overlay: true }) +
          '<div>' +
            '<div class="card__title truncate">' + esc(item.title) + '</div>' +
            '<div class="card__meta truncate">' + esc(artistName(item)) + '</div>' +
          '</div>' +
        '</article>';
      }
      return albumCard(item);
    }).join('');
    return '<div class="shelf scroll-x stagger">' + cards + '</div>';
  }

  /* ------------------------------------------------------------------ *
   * 状态：骨架 / 空态 / 提示条
   * ------------------------------------------------------------------ */

  function skeletonCards(count) {
    var one = '<div class="card" aria-hidden="true">' +
      '<div class="skeleton skeleton--cover"></div>' +
      '<div class="skeleton skeleton--title"></div>' +
      '<div class="skeleton skeleton--text" style="width:40%"></div>' +
    '</div>';
    var out = '';
    for (var i = 0; i < (count || 6); i++) out += one;
    return '<div class="grid-cards">' + out + '</div>';
  }

  function skeletonRows(count) {
    var one = '<div class="track-row" aria-hidden="true">' +
      '<div class="skeleton skeleton--text"></div>' +
      '<div class="track-row__main">' +
        '<div class="skeleton track-row__cover"></div>' +
        '<div style="flex:1"><div class="skeleton skeleton--title"></div>' +
        '<div class="skeleton skeleton--text" style="width:34%;margin-top:6px"></div></div>' +
      '</div>' +
      '<div class="skeleton skeleton--text"></div>' +
      '<div></div>' +
      '<div class="skeleton skeleton--text"></div>' +
    '</div>';
    var out = '';
    for (var i = 0; i < (count || 8); i++) out += one;
    return '<div class="tracklist">' + out + '</div>';
  }

  function skeletonHero() {
    return '<div class="hero" aria-hidden="true">' +
      '<div class="hero__content">' +
        '<div class="skeleton skeleton--text" style="width:96px;height:22px;border-radius:99px"></div>' +
        '<div class="skeleton" style="height:48px;width:60%"></div>' +
        '<div class="skeleton skeleton--text" style="width:80%"></div>' +
        '<div class="skeleton skeleton--text" style="width:64%"></div>' +
        '<div class="skeleton" style="height:42px;width:180px;border-radius:99px;margin-top:8px"></div>' +
      '</div>' +
      '<div class="skeleton" style="width:300px;height:300px;border-radius:var(--r-lg)"></div>' +
    '</div>';
  }

  function emptyState(icon, title, desc, actionHtml) {
    return '<div class="empty-state">' +
      '<div class="empty-state__icon">' + Aura.icon(icon || 'music', { size: 28, stroke: 1.5 }) + '</div>' +
      '<div class="empty-state__title">' + esc(title) + '</div>' +
      (desc ? '<div class="empty-state__desc">' + esc(desc) + '</div>' : '') +
      (actionHtml || '') +
    '</div>';
  }

  function notice(icon, html, variant) {
    return '<div class="notice' + (variant ? ' notice--' + variant : '') + '">' +
      '<span class="notice__icon">' + Aura.icon(icon || 'info', { size: 16 }) + '</span>' +
      '<div>' + html + '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------------ *
   * 轻提示
   * ------------------------------------------------------------------ */

  var TOAST_ICON = { info: 'info', success: 'check-circle', danger: 'alert-triangle' };
  var toastStack = null;

  function toast(message, type) {
    if (!toastStack) {
      toastStack = util.el('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastStack);
    }
    var kind = TOAST_ICON[type] ? type : 'info';
    var node = util.el('div', { class: 'toast toast--' + kind });
    node.innerHTML = '<span class="toast__icon">' + Aura.icon(TOAST_ICON[kind], { size: 16 }) + '</span>' +
      '<span>' + esc(message) + '</span>';
    toastStack.appendChild(node);

    setTimeout(function () {
      node.classList.add('is-leaving');
      setTimeout(function () { node.remove(); }, 220);
    }, 2600);
  }

  /* ------------------------------------------------------------------ *
   * 浮层：菜单 / 模态
   * ------------------------------------------------------------------ */

  var openMenu = null;

  function closeMenu() {
    if (!openMenu) return;
    openMenu.remove();
    openMenu = null;
  }

  /**
   * 右键 / 更多操作菜单
   * @param {Array} items [{ icon, label, act, data, danger, sep, disabled }]
   */
  function menu(items, x, y) {
    closeMenu();
    var node = util.el('div', { class: 'context-menu', role: 'menu' });
    node.innerHTML = (items || []).map(function (item) {
      if (item.sep) return '<div class="context-menu__sep"></div>';
      return '<button type="button" class="context-menu__item' + (item.danger ? ' context-menu__item--danger' : '') + '"' +
        ' role="menuitem"' + (item.act ? ' data-act="' + esc(item.act) + '"' : '') + attr(item.data) +
        (item.disabled ? ' disabled' : '') + '>' +
        (item.icon ? Aura.icon(item.icon, { size: 16 }) : '<span style="width:16px"></span>') +
        '<span>' + esc(item.label) + '</span>' +
      '</button>';
    }).join('');

    document.body.appendChild(node);

    var rect = node.getBoundingClientRect();
    var left = util.clamp(x, 8, window.innerWidth - rect.width - 8);
    var top = util.clamp(y, 8, window.innerHeight - rect.height - 8);
    node.style.left = left + 'px';
    node.style.top = top + 'px';
    openMenu = node;
    return node;
  }

  var overlayStack = [];

  function closeOverlay() {
    var top = overlayStack.pop();
    if (!top) return;
    // onClose 是调用方清理副作用（定时器、外部引用）的唯一时机，必须先于移除节点
    if (typeof top.onClose === 'function') top.onClose();
    top.el.remove();
  }

  function closeAllOverlays() {
    while (overlayStack.length) closeOverlay();
  }

  /**
   * 打开一个模态浮层
   * @param {object} opts { title, body, foot, size, onMount, onClose }
   */
  function openModal(opts) {
    opts = opts || {};
    var overlay = util.el('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' });
    var modal = util.el('div', { class: 'modal' });
    if (opts.size) modal.style.width = opts.size;

    modal.innerHTML =
      '<div class="modal__head">' +
        '<div class="modal__title">' + esc(opts.title || '') + '</div>' +
        iconBtn('x', { act: 'close-overlay', tip: '关闭' }) +
      '</div>' +
      '<div class="modal__body">' + (opts.body || '') + '</div>' +
      (opts.foot ? '<div class="modal__foot">' + opts.foot + '</div>' : '');

    overlay.appendChild(modal);
    overlay.addEventListener('mousedown', function (event) {
      if (event.target === overlay) closeOverlay();
    });

    document.body.appendChild(overlay);
    overlayStack.push({ el: overlay, onClose: opts.onClose });
    if (typeof opts.onMount === 'function') opts.onMount(modal);
    return modal;
  }

  function confirm(opts) {
    opts = opts || {};
    return openModal({
      title: opts.title || '确认操作',
      size: 'min(440px, 100%)',
      body: '<div class="text-sub" style="font-size:var(--text-sm);line-height:1.7">' +
        esc(opts.desc || '') + '</div>',
      foot: btn('取消', { act: 'close-overlay' }) +
        btn(opts.confirmText || '确认', {
          variant: opts.danger ? 'danger' : 'primary',
          act: 'confirm-accept',
        }),
      onMount: function () {
        Aura.actions['confirm-accept'] = function () {
          closeOverlay();
          if (typeof opts.onConfirm === 'function') opts.onConfirm();
        };
      },
    });
  }

  /* ------------------------------------------------------------------ *
   * 滑块填充
   * ------------------------------------------------------------------ */

  /** 让 .slider 的轨道按当前值填充强调色 */
  function syncSliderFill(input) {
    var min = Number(input.min || 0);
    var max = Number(input.max || 100);
    var value = Number(input.value || 0);
    var ratio = max === min ? 0 : (value - min) / (max - min);
    input.style.setProperty('--fill', (ratio * 100).toFixed(2) + '%');
  }

  function syncAllSliders(root) {
    util.qsa('.slider', root || document).forEach(syncSliderFill);
  }

  /* ------------------------------------------------------------------ *
   * 事件委托
   * ------------------------------------------------------------------ */

  function runAction(name, node, event) {
    var handler = Aura.actions[name];
    if (typeof handler !== 'function') {
      console.warn('[Aura.ui] 未注册的动作:', name);
      return;
    }
    handler(node.dataset, node, event);
  }

  function isTextEntry(node) {
    return node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);
  }

  function bind() {
    document.addEventListener('click', function (event) {
      var node = event.target.closest('[data-act]');
      var menuBefore = openMenu;

      // 在输入框内部点击时，不触发外层容器上的动作
      if (node && !(isTextEntry(event.target) && event.target !== node)) {
        event.preventDefault();
        runAction(node.dataset.act, node, event);
      }

      // 已打开的菜单：点外部或点菜单项都关闭；若动作又打开了新菜单则保留新的
      if (openMenu && openMenu === menuBefore) closeMenu();
    });

    document.addEventListener('input', function (event) {
      var node = event.target.closest('[data-input]');
      if (!node) return;
      if (node.classList.contains('slider')) syncSliderFill(node);
      runAction(node.dataset.input, node, event);
    });

    document.addEventListener('change', function (event) {
      var node = event.target.closest('[data-change]');
      if (!node) return;
      runAction(node.dataset.change, node, event);
    });

    // 让 role=button 的卡片支持键盘操作
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (openMenu) { closeMenu(); return; }
        if (overlayStack.length) { closeOverlay(); return; }
      }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var node = event.target.closest('[role="button"][data-act]');
      if (!node || isTextEntry(event.target)) return;
      event.preventDefault();
      runAction(node.dataset.act, node, event);
    });

    window.addEventListener('resize', closeMenu);
    window.addEventListener('blur', closeMenu);
  }

  Aura.actions = Aura.actions || {};

  Aura.ui = {
    action: function (name, fn) { Aura.actions[name] = fn; },
    bind: bind,
    esc: esc,
    attr: attr,
    setContext: setContext,
    getContext: getContext,
    iconBtn: iconBtn,
    btn: btn,
    cover: cover,
    coverOf: coverOf,
    artistName: artistName,
    albumTitle: albumTitle,
    qualityTag: qualityTag,
    trackRow: trackRow,
    trackList: trackList,
    trackListHead: trackListHead,
    albumCard: albumCard,
    playlistCard: playlistCard,
    artistCard: artistCard,
    genreCard: genreCard,
    anyCard: anyCard,
    sectionHead: sectionHead,
    shelf: shelf,
    skeletonCards: skeletonCards,
    skeletonRows: skeletonRows,
    skeletonHero: skeletonHero,
    emptyState: emptyState,
    notice: notice,
    toast: toast,
    menu: menu,
    closeMenu: closeMenu,
    openModal: openModal,
    closeOverlay: closeOverlay,
    closeAllOverlays: closeAllOverlays,
    confirm: confirm,
    syncSliderFill: syncSliderFill,
    syncAllSliders: syncAllSliders,
  };
})(window.Aura = window.Aura || {});
