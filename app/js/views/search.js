/**
 * Aura · 搜索
 *
 * 无关键词时是「发现页」（风格分类 + 最近搜索），有关键词时是「结果页」。
 * 输入采用防抖 + 结果区局部重绘，连续输入不会丢失焦点与光标。
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;
  var ui = Aura.ui;
  var store = Aura.store;

  var HISTORY_KEY = 'aura.searchHistory';
  var HISTORY_MAX = 8;

  var resultsEl = null;
  var searchTimer = null;

  /* ------------------------------------------------------------------ *
   * 搜索历史
   * ------------------------------------------------------------------ */

  function readHistory() {
    try {
      var list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function pushHistory(query) {
    var q = String(query || '').trim();
    if (!q) return;
    var list = readHistory().filter(function (item) { return item !== q; });
    list.unshift(q);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
    } catch (err) {
      /* 存储不可用时仅影响历史记录 */
    }
  }

  function clearHistory() {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch (err) {
      /* 忽略 */
    }
  }

  /* ------------------------------------------------------------------ *
   * 搜索执行
   * ------------------------------------------------------------------ */

  function runSearch(query) {
    var q = String(query || '').trim();
    store.set({ searchQuery: q });

    if (!q) {
      store.set({ searchResults: null, searchLoading: false });
      return;
    }

    store.set({ searchLoading: true });
    Aura.api.search(q)
      .then(function (res) {
        if (store.state.searchQuery !== q) return;
        store.set({ searchResults: res, searchLoading: false });
      })
      .catch(function (err) {
        if (store.state.searchQuery !== q) return;
        store.set({ searchResults: null, searchLoading: false });
        ui.toast(err.message, 'danger');
      });
  }

  function scheduleSearch(query) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { runSearch(query); }, 320);
  }

  /* ------------------------------------------------------------------ *
   * 发现页
   * ------------------------------------------------------------------ */

  function genreSection() {
    var genres = store.state.genres;
    if (!genres) {
      ensureGenres();
      return ui.skeletonCards(8);
    }
    return ui.sectionHead('按风格浏览', '点开即播') +
      '<div class="genre-grid stagger">' + genres.map(function (genre) {
        return ui.genreCard(genre);
      }).join('') + '</div>';
  }

  function ensureGenres() {
    if (store.state.genres) return;
    Aura.api.getGenres()
      .then(function (genres) { store.set({ genres: genres }); })
      .catch(function () { store.set({ genres: [] }); });
  }

  function historySection() {
    var history = readHistory();
    if (!history.length) return '';
    return '<div class="search-suggest">' +
      '<div class="search-suggest__label">最近搜索</div>' +
      history.map(function (item) {
        return '<button type="button" class="search-suggest__item" data-act="search-use" data-q="' + ui.esc(item) + '">' +
          Aura.icon('history', { size: 16 }) + '<span>' + ui.esc(item) + '</span>' +
        '</button>';
      }).join('') +
      '<div style="padding:var(--sp-3) 0 0 var(--sp-3)">' +
        ui.btn('清空记录', { variant: 'ghost', cls: 'btn--sm', act: 'search-clear-history' }) +
      '</div>' +
    '</div>';
  }

  function paintDiscover() {
    if (!resultsEl) return;
    resultsEl.innerHTML = genreSection() + historySection();
    ui.syncAllSliders(resultsEl);
  }

  /* ------------------------------------------------------------------ *
   * 结果页
   * ------------------------------------------------------------------ */

  function resultCount(res) {
    return (res.tracks || []).length + (res.albums || []).length +
      (res.artists || []).length + (res.playlists || []).length;
  }

  function paintResults() {
    if (!resultsEl) return;
    var s = store.state;

    if (!s.searchQuery) return paintDiscover();

    if (s.searchLoading) {
      resultsEl.innerHTML = ui.skeletonRows(6);
      return;
    }

    var res = s.searchResults;
    if (!res) return undefined;

    if (!resultCount(res)) {
      resultsEl.innerHTML = ui.emptyState('search', '没有找到「' + s.searchQuery + '」',
        '试试更短的关键词，或者检查当前数据源是否已正确连接。');
      return undefined;
    }

    var html = '';

    if ((res.artists || []).length) {
      html += ui.sectionHead('艺人', res.artists.length + ' 位') +
        '<div class="grid-cards stagger">' + res.artists.map(function (artist) {
          return ui.artistCard(artist);
        }).join('') + '</div>';
    }

    if ((res.albums || []).length) {
      html += ui.sectionHead('专辑', res.albums.length + ' 张') +
        '<div class="grid-cards stagger">' + res.albums.map(function (album) {
          return ui.albumCard(album);
        }).join('') + '</div>';
    }

    if ((res.tracks || []).length) {
      var ctx = ui.setContext('search:tracks', res.tracks);
      html += ui.sectionHead('曲目', res.tracks.length + ' 首',
          ui.btn('播放全部', {
            variant: 'secondary', cls: 'btn--sm', icon: 'play',
            act: 'play-collection', data: { ctx: ctx },
          })) +
        ui.trackList(res.tracks, {
          ctx: ctx,
          currentId: Aura.player.currentId(),
          playing: s.playing,
          liked: s.liked,
        });
    }

    if ((res.playlists || []).length) {
      html += ui.sectionHead('歌单', res.playlists.length + ' 个') +
        '<div class="grid-cards stagger">' + res.playlists.map(function (playlist) {
          return ui.playlistCard(playlist);
        }).join('') + '</div>';
    }

    resultsEl.innerHTML = html;
    ui.syncAllSliders(resultsEl);
    return undefined;
  }

  /* ------------------------------------------------------------------ *
   * 视图
   * ------------------------------------------------------------------ */

  Aura.views = Aura.views || {};

  Aura.views.search = {
    heading: '搜索',
    eyebrow: '发现',

    render: function (host) {
      var s = store.state;
      ensureGenres();

      host.innerHTML = '<div class="view">' +
        '<div class="search-hero">' +
          '<h1 class="search-hero__title">搜索曲库</h1>' +
          '<p class="search-hero__sub">输入曲名、专辑或艺人即可检索当前数据源。' +
            '使用内置演示数据时完全离线可用。</p>' +
          '<div class="searchbox searchbox--wide">' +
            Aura.icon('search', { size: 18 }) +
            '<input type="search" placeholder="搜索曲目、专辑、艺人…" value="' + ui.esc(s.searchQuery) + '"' +
              ' data-input="search-input" data-search-input aria-label="搜索">' +
            '<button type="button" class="icon-btn icon-btn--sm" data-act="search-clear" aria-label="清空">' +
              Aura.icon('x', { size: 14 }) + '</button>' +
          '</div>' +
        '</div>' +
        '<div data-search-results></div>' +
      '</div>';

      resultsEl = util.qs('[data-search-results]', host);
      paintResults();

      var input = util.qs('[data-search-input]', host);
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    },

    onState: function (changed) {
      if (changed.indexOf('searchResults') !== -1 || changed.indexOf('searchLoading') !== -1 ||
          changed.indexOf('genres') !== -1 || changed.indexOf('liked') !== -1) {
        if (changed.indexOf('liked') !== -1) {
          util.qsa('.track-row [data-act="toggle-like"]').forEach(function (node) {
            var on = !!store.state.liked[node.dataset.id];
            node.classList.toggle('is-active', on);
            node.innerHTML = Aura.icon(on ? 'heart-filled' : 'heart', { size: 15 });
          });
        }
        paintResults();
      }
    },

    /* 供 app.js 的动作调用 */
    run: runSearch,
    schedule: scheduleSearch,
    pushHistory: pushHistory,
    clearHistory: clearHistory,
    focusInput: function () {
      var input = util.qs('[data-search-input]');
      if (input) input.focus();
    },
  };
})(window.Aura = window.Aura || {});
