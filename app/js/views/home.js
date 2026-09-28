/**
 * Aura · 首页 · 磁带架
 *
 * 首页本身就是一台「磁带机」：横向滑动浏览货架上的磁带，离轨道中心最近的那盘会被
 * 放大、点亮，成为唯一的视觉焦点；点击任意一盘，从第一首开始播放并跳转到「正在播放」。
 *
 * 专辑与歌单混排在同一个货架上，外观不做任何区分——对听众来说它们都只是「一盘磁带」。
 *
 * 选中态只有一条规则：离轨道中心最近的那盘。滚轮、拖拽、方向键、两侧箭头全部汇入
 * 同一条路径（滚动 → 计算最近 → 切换选中），因此不存在「键盘选中了但视觉没跟上」这类分叉。
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;
  var ui = Aura.ui;
  var store = Aura.store;

  var RAIL_SEL = '[data-tape-rail]';
  var SETTLE_MS = 170;   // 停止滚动多久后把最近的一盘吸附到正中间
  var LOCK_MS = 520;     // 程序化滚动期间忽略 scroll 事件，避免选中态在动画中途来回跳

  var railEl = null;
  var items = [];
  var prevBtn = null;
  var nextBtn = null;
  var activeKey = null;
  var frame = 0;
  var settleTimer = 0;
  var lockUntil = 0;
  var detach = null;

  /* ================================================================== *
   * 1. 数据：专辑 + 歌单 → 统一的「磁带」
   * ================================================================== */

  function albumTape(album) {
    var bits = [
      (album.artist && album.artist.name) || '未知艺人',
      album.year,
      album.trackCount ? album.trackCount + ' 首' : '',
    ];
    return {
      key: 'album:' + album.id,
      type: 'album',
      id: album.id,
      title: album.title,
      cover: album.cover,
      meta: bits.filter(Boolean).join(' · '),
    };
  }

  function playlistTape(playlist) {
    var bits = [
      playlist.curator || '歌单',
      playlist.trackCount ? playlist.trackCount + ' 首' : '',
    ];
    return {
      key: 'playlist:' + playlist.id,
      type: 'playlist',
      id: playlist.id,
      title: playlist.title,
      cover: playlist.cover,
      meta: bits.filter(Boolean).join(' · '),
    };
  }

  /** 专辑与歌单轮流取，让两种来源在货架上交错出现而不是前后分成两段 */
  function mergeTapes(albums, playlists) {
    var a = (albums || []).map(albumTape);
    var p = (playlists || []).map(playlistTape);
    var out = [];
    for (var i = 0; i < Math.max(a.length, p.length); i++) {
      if (a[i]) out.push(a[i]);
      if (p[i]) out.push(p[i]);
    }
    return out;
  }

  /* ================================================================== *
   * 2. 标记
   * ================================================================== */

  function art(tape) {
    return tape.cover
      ? '<img class="tape__art" src="' + ui.esc(tape.cover) + '" alt="" loading="lazy" draggable="false">'
      : '<div class="tape__art tape__art--fallback">' + Aura.icon('disc', { size: 26 }) + '</div>';
  }

  function tapeMarkup(tape, index) {
    return '<article class="tape" role="button" tabindex="0" style="--i:' + index + '"' +
      ' data-act="tape-play" data-key="' + ui.esc(tape.key) + '"' +
      ' aria-label="' + ui.esc(tape.title + ' · ' + tape.meta) + '">' +
      '<div class="tape__shell">' +
        '<div class="tape__label">' +
          art(tape) +
          '<span class="tape__play">' + Aura.icon('play', { size: 13 }) + '</span>' +
        '</div>' +
        '<div class="tape__deck">' +
          '<span class="tape__reel"></span>' +
          '<span class="tape__reel"></span>' +
        '</div>' +
      '</div>' +
      '<div class="tape__caption">' +
        '<div class="tape__title truncate">' + ui.esc(tape.title) + '</div>' +
        '<div class="tape__meta truncate">' + ui.esc(tape.meta) + '</div>' +
      '</div>' +
    '</article>';
  }

  function head(sub) {
    return '<header class="tape-head">' +
      '<span class="tape-head__eyebrow">' + Aura.icon('sparkles', { size: 13 }) + '磁带架</span>' +
      '<h1 class="tape-head__title">挑一盘磁带</h1>' +
      '<p class="tape-head__sub">' + ui.esc(sub) + '</p>' +
    '</header>';
  }

  function navBtn(delta, icon, label) {
    return '<button type="button" class="tape-nav tape-nav--' + (delta < 0 ? 'prev' : 'next') + '"' +
      ' data-act="tape-step" data-delta="' + delta + '" aria-label="' + ui.esc(label) + '">' +
      Aura.icon(icon, { size: 20 }) + '</button>';
  }

  function skeleton() {
    var one = '<div class="tape tape--ghost" aria-hidden="true">' +
      '<div class="tape__shell"><div class="skeleton" style="width:100%;height:100%;border-radius:inherit"></div></div>' +
      '<div class="tape__caption">' +
        '<div class="skeleton skeleton--title"></div>' +
        '<div class="skeleton skeleton--text" style="width:58%;margin-top:6px"></div>' +
      '</div>' +
    '</div>';
    var rail = '';
    for (var i = 0; i < 5; i++) rail += one;

    return '<div class="view tape-view">' +
      head('正在整理货架…') +
      '<div class="tape-stage"><div class="tape-rail">' + rail + '</div></div>' +
    '</div>';
  }

  function paint(host, data) {
    var tapes = (data && data.tapes) || [];

    if (!tapes.length) {
      host.innerHTML = '<div class="view">' + ui.emptyState(
        'disc', '货架是空的', '还没有可以播放的专辑或歌单。',
        ui.btn('重新加载', { variant: 'primary', act: 'reload-home' })
      ) + '</div>';
      unmountRail();
      return;
    }

    host.innerHTML = '<div class="view tape-view">' +
      head('左右滑动浏览，居中的磁带会被放大点亮；点击任意一盘即可播放。') +
      '<div class="tape-stage">' +
        navBtn(-1, 'chevron-left', '上一盘') +
        '<div class="tape-rail" data-tape-rail>' +
          tapes.map(tapeMarkup).join('') +
        '</div>' +
        navBtn(1, 'chevron-right', '下一盘') +
      '</div>' +
    '</div>';

    mountRail(host);
  }

  /* ================================================================== *
   * 3. 选中态：永远取「离轨道中心最近」的那一盘
   * ================================================================== */

  function nearestIndex() {
    if (!railEl || !items.length) return 0;
    var mid = railEl.scrollLeft + railEl.clientWidth / 2;
    var best = 0;
    var bestDist = Infinity;
    for (var i = 0; i < items.length; i++) {
      var node = items[i];
      var center = node.offsetLeft + node.offsetWidth / 2;
      var dist = Math.abs(center - mid);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    return best;
  }

  function indexOfKey(key) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].dataset.key === key) return i;
    }
    return -1;
  }

  function setActive(index) {
    var node = items[index];
    if (!node) return;
    activeKey = node.dataset.key;
    items.forEach(function (item, i) {
      var on = i === index;
      item.classList.toggle('is-active', on);
      if (on) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    });
    if (prevBtn) prevBtn.disabled = index <= 0;
    if (nextBtn) nextBtn.disabled = index >= items.length - 1;
  }

  /** 把第 index 盘滚到轨道正中间 */
  function centerOn(index, smooth) {
    var node = items[index];
    if (!railEl || !node) return;
    var max = Math.max(0, railEl.scrollWidth - railEl.clientWidth);
    var target = util.clamp(
      node.offsetLeft + node.offsetWidth / 2 - railEl.clientWidth / 2, 0, max
    );
    if (Math.abs(target - railEl.scrollLeft) < 1) return;
    railEl.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' });
  }

  /* ================================================================== *
   * 4. 挂载 / 卸载
   * ================================================================== */

  function mountRail(host) {
    unmountRail();

    var rail = util.qs(RAIL_SEL, host);
    if (!rail) return;

    railEl = rail;
    items = util.qsa('.tape', rail);
    prevBtn = util.qs('.tape-nav--prev', host);
    nextBtn = util.qs('.tape-nav--next', host);
    activeKey = null;

    function onScroll() {
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = 0;
        if (Date.now() < lockUntil) return;
        var index = nearestIndex();
        if (items[index] && items[index].dataset.key !== activeKey) setActive(index);
      });

      clearTimeout(settleTimer);
      settleTimer = setTimeout(function () {
        if (Date.now() < lockUntil) return;
        var index = nearestIndex();
        setActive(index);
        centerOn(index, true);
      }, SETTLE_MS);
    }

    // 鼠标滚轮：纵向滚动转成横向浏览，让「滑动选带」在没有触控板的机器上也成立；
    // 到达两端时不再拦截，页面可以正常继续上下滚。
    function onWheel(event) {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      var max = Math.max(0, rail.scrollWidth - rail.clientWidth);
      if ((event.deltaY < 0 && rail.scrollLeft <= 0) ||
          (event.deltaY > 0 && rail.scrollLeft >= max - 1)) return;
      event.preventDefault();
      rail.scrollLeft = util.clamp(rail.scrollLeft + event.deltaY, 0, max);
    }

    // 点磁带时不让浏览器按默认行为聚焦并把它滚进视野：那会在 click 触发前
    // 先把轨道滚一下，货架在点击落下的瞬间抖动。
    function onMouseDown(event) {
      if (event.target.closest('.tape')) event.preventDefault();
    }

    function onResize() {
      if (activeKey) {
        var index = indexOfKey(activeKey);
        if (index !== -1) centerOn(index, false);
      }
      setActive(Math.max(0, nearestIndex()));
    }

    var debouncedResize = util.debounce(onResize, 120);

    rail.addEventListener('scroll', onScroll, { passive: true });
    rail.addEventListener('wheel', onWheel, { passive: false });
    rail.addEventListener('mousedown', onMouseDown);
    window.addEventListener('resize', debouncedResize);

    detach = function () {
      rail.removeEventListener('scroll', onScroll);
      rail.removeEventListener('wheel', onWheel);
      rail.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('resize', debouncedResize);
      clearTimeout(settleTimer);
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (railEl === rail) railEl = null;
      items = [];
      prevBtn = null;
      nextBtn = null;
    };

    setActive(nearestIndex());
  }

  function unmountRail() {
    if (detach) detach();
    detach = null;
  }

  /* ================================================================== *
   * 5. 对外接口
   * ================================================================== */

  function load() {
    store.set({ loading: true, loadError: null });
    Promise.all([Aura.api.getAlbums(), Aura.api.getPlaylists()])
      .then(function (result) {
        store.set({
          home: { tapes: mergeTapes(result[0], result[1]) },
          loading: false,
        });
      })
      .catch(function (err) {
        store.set({ loading: false, loadError: err.message });
      });
  }

  Aura.views = Aura.views || {};

  Aura.views.home = {
    heading: '首页',
    eyebrow: '磁带架',

    render: function (host) {
      var s = store.state;

      if (s.home) { paint(host, s.home); return undefined; }

      if (s.loadError) {
        host.innerHTML = '<div class="view">' + ui.emptyState(
          'cloud-off', '货架加载失败', s.loadError,
          ui.btn('重新加载', { variant: 'primary', act: 'reload-home' })
        ) + '</div>';
        unmountRail();
        return undefined;
      }

      host.innerHTML = skeleton();
      unmountRail();
      load();
      return undefined;
    },

    /** 键盘 / 两侧箭头：在当前选中基础上前后移动 */
    step: function (delta) {
      if (!railEl || !items.length) return;
      var next = util.clamp(nearestIndex() + delta, 0, items.length - 1);
      lockUntil = Date.now() + LOCK_MS;
      setActive(next);
      centerOn(next, true);
      var node = items[next];
      if (node) node.focus({ preventScroll: true });
    },

    skeleton: skeleton,

    leave: function () { unmountRail(); },

    onState: function (changed) {
      if (changed.indexOf('home') !== -1 || changed.indexOf('loadError') !== -1) {
        Aura.app.remount();
      }
    },
  };
})(window.Aura = window.Aura || {});
