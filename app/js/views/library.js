/**
 * Aura · 资料库
 *
 * 四个分页（曲目 / 专辑 / 艺人 / 歌单）共用一套工具栏：
 * 分段控件切换分页 + 实时筛选 + 排序。
 * 筛选只重绘内容区，不重建输入框，因此连续输入时焦点与光标不会丢失。
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;
  var ui = Aura.ui;
  var store = Aura.store;

  var TABS = [
    { id: 'songs', label: '曲目', icon: 'music', stateKey: 'tracks' },
    { id: 'albums', label: '专辑', icon: 'disc', stateKey: 'albums' },
    { id: 'artists', label: '艺人', icon: 'users', stateKey: 'artists' },
    { id: 'playlists', label: '歌单', icon: 'list-music', stateKey: 'playlists' },
  ];

  var SORTS = [
    { id: 'default', label: '默认排序' },
    { id: 'title', label: '按标题' },
    { id: 'plays', label: '按播放量' },
    { id: 'duration', label: '按时长' },
  ];

  var contentEl = null;
  var sortMode = 'default';

  function tabOf(id) {
    return TABS.filter(function (tab) { return tab.id === id; })[0] || TABS[0];
  }

  function ensure(tabId) {
    var tab = tabOf(tabId);
    var cached = store.state[tab.stateKey];
    if (cached) return Promise.resolve(cached);

    store.set({ loading: true, loadError: null });
    var fetcher = tabId === 'songs' ? Aura.api.getTracks()
      : tabId === 'albums' ? Aura.api.getAlbums()
        : tabId === 'artists' ? Aura.api.getArtists()
          : Aura.api.getPlaylists();

    return fetcher.then(function (data) {
      var patch = { loading: false };
      patch[tab.stateKey] = data;
      store.set(patch);
      return data;
    }).catch(function (err) {
      store.set({ loading: false, loadError: err.message });
      throw err;
    });
  }

  function filterByQuery(list, query, fields) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter(function (item) {
      return fields.some(function (field) {
        var value = field.split('.').reduce(function (acc, key) { return acc == null ? acc : acc[key]; }, item);
        return String(value || '').toLowerCase().indexOf(q) !== -1;
      });
    });
  }

  function sortTracks(list) {
    var out = list.slice();
    if (sortMode === 'title') {
      out.sort(function (a, b) { return String(a.title).localeCompare(String(b.title), 'zh-Hans-CN'); });
    } else if (sortMode === 'plays') {
      out.sort(function (a, b) { return (b.plays || 0) - (a.plays || 0); });
    } else if (sortMode === 'duration') {
      out.sort(function (a, b) { return (a.duration || 0) - (b.duration || 0); });
    }
    return out;
  }

  function sortByName(list) {
    var out = list.slice();
    if (sortMode === 'title') {
      out.sort(function (a, b) { return String(a.title || a.name).localeCompare(String(b.title || b.name), 'zh-Hans-CN'); });
    }
    return out;
  }

  function paintSongs(query) {
    var all = store.state.tracks || [];
    var list = sortTracks(filterByQuery(all, query, ['title', 'artist.name', 'album.title']));
    var key = ui.setContext('library:songs', list);

    if (!list.length) {
      return ui.emptyState('search', '没有匹配的曲目', '换个关键词试试，或清空筛选条件。',
        ui.btn('清空筛选', { act: 'library-clear' }));
    }

    return ui.sectionHead('全部曲目', '共 ' + list.length + ' 首',
        ui.btn('播放全部', {
          variant: 'secondary', cls: 'btn--sm', icon: 'play',
          act: 'play-collection', data: { ctx: key },
        })) +
      ui.trackList(list, {
        ctx: key,
        currentId: Aura.player.currentId(),
        playing: store.state.playing,
        liked: store.state.liked,
      });
  }

  function paintAlbums(query) {
    var list = sortByName(filterByQuery(store.state.albums || [], query, ['title', 'genre', 'artist.name']));
    if (!list.length) {
      return ui.emptyState('disc', '没有匹配的专辑', '换个关键词试试。', ui.btn('清空筛选', { act: 'library-clear' }));
    }
    return ui.sectionHead('专辑', '共 ' + list.length + ' 张') +
      '<div class="grid-cards stagger">' + list.map(function (album, index) {
        return ui.albumCard(album);
      }).join('') + '</div>';
  }

  function paintArtists(query) {
    var list = sortByName(filterByQuery(store.state.artists || [], query, ['name', 'genres', 'bio']));
    if (!list.length) {
      return ui.emptyState('users', '没有匹配的艺人', '换个关键词试试。', ui.btn('清空筛选', { act: 'library-clear' }));
    }
    return ui.sectionHead('艺人', '共 ' + list.length + ' 位') +
      '<div class="grid-cards stagger">' + list.map(function (artist) {
        return ui.artistCard(artist);
      }).join('') + '</div>';
  }

  function paintPlaylists(query) {
    var list = sortByName(filterByQuery(store.state.playlists || [], query, ['title', 'desc', 'curator']));
    if (!list.length) {
      return ui.emptyState('list-music', '没有匹配的歌单', '换个关键词试试。', ui.btn('清空筛选', { act: 'library-clear' }));
    }
    return ui.sectionHead('歌单', '共 ' + list.length + ' 个') +
      '<div class="grid-cards stagger">' + list.map(function (playlist) {
        return ui.playlistCard(playlist);
      }).join('') + '</div>';
  }

  function paintContent() {
    if (!contentEl) return;
    var s = store.state;
    var tabId = s.libraryTab;
    var tab = tabOf(tabId);
    var query = s.libraryQuery;

    if (s.loadError) {
      contentEl.innerHTML = ui.emptyState('cloud-off', '内容加载失败', s.loadError,
        ui.btn('重新加载', { variant: 'primary', act: 'reload-library' }));
      return;
    }

    if (!s[tab.stateKey]) {
      contentEl.innerHTML = tabId === 'songs' ? ui.skeletonRows(8) : ui.skeletonCards(8);
      ensure(tabId).catch(function () { /* 错误已写入状态，由 onState 重绘 */ });
      return;
    }

    contentEl.innerHTML = tabId === 'songs' ? paintSongs(query)
      : tabId === 'albums' ? paintAlbums(query)
        : tabId === 'artists' ? paintArtists(query)
          : paintPlaylists(query);

    ui.syncAllSliders(contentEl);
  }

  function paintToolbar() {
    var s = store.state;
    var tabs = TABS.map(function (tab) {
      return '<button type="button" class="segmented__item' + (tab.id === s.libraryTab ? ' is-active' : '') + '"' +
        ' data-act="library-tab" data-tab="' + tab.id + '" aria-pressed="' + (tab.id === s.libraryTab) + '">' +
        Aura.icon(tab.icon, { size: 14 }) + '<span>' + tab.label + '</span>' +
      '</button>';
    }).join('');

    var sortOptions = SORTS.map(function (sort) {
      return '<option value="' + sort.id + '"' + (sort.id === sortMode ? ' selected' : '') + '>' +
        sort.label + '</option>';
    }).join('');

    return '<div class="view-toolbar">' +
      '<div class="view-toolbar__group">' +
        '<div class="segmented" role="tablist">' + tabs + '</div>' +
      '</div>' +
      '<div class="view-toolbar__group">' +
        '<div class="searchbox">' + Aura.icon('search', { size: 15 }) +
          '<input type="search" placeholder="筛选" value="' + ui.esc(s.libraryQuery) + '"' +
            ' data-input="library-filter" aria-label="筛选资料库">' +
        '</div>' +
        (s.libraryTab === 'songs'
          ? '<select class="select" data-change="library-sort" aria-label="排序方式">' + sortOptions + '</select>'
          : '') +
      '</div>' +
    '</div>';
  }

  function repaintAll() {
    var host = util.qs('[data-library-content]');
    var toolbar = host && host.parentNode ? util.qs('.view-toolbar', host.parentNode) : null;
    if (toolbar) toolbar.outerHTML = paintToolbar();
    paintContent();
  }

  Aura.views = Aura.views || {};

  Aura.views.library = {
    heading: '资料库',
    eyebrow: '收藏',

    render: function (host) {
      host.innerHTML = '<div class="view">' + paintToolbar() + '<div data-library-content></div></div>';
      contentEl = util.qs('[data-library-content]', host);
      paintContent();
    },

    /** 工具栏与内容区局部重绘（保留筛选输入框焦点） */
    refresh: repaintAll,

    /**
     * 工具栏交互入口（由 app.js 的动作注册表调用）
     * 分页与排序会改变工具栏本身（排序下拉只在曲目页出现），需要整体重绘；
     * 筛选只重绘内容区，因此连续输入时焦点与光标不会丢失。
     */
    control: function (kind, value) {
      if (kind === 'tab') {
        if (!value || value === store.state.libraryTab) return;
        store.set({ libraryTab: value, loadError: null });
        repaintAll();
        return;
      }
      if (kind === 'query') {
        store.set({ libraryQuery: value });
        paintContent();
        return;
      }
      if (kind === 'sort') {
        sortMode = value || 'default';
        paintContent();
        return;
      }
      if (kind === 'clear') {
        store.set({ libraryQuery: '' });
        var input = util.qs('[data-input="library-filter"]');
        if (input) input.value = '';
        paintContent();
      }
    },

    onState: function (changed) {
      if (changed.indexOf('tracks') !== -1 || changed.indexOf('albums') !== -1 ||
          changed.indexOf('artists') !== -1 || changed.indexOf('playlists') !== -1 ||
          changed.indexOf('loadError') !== -1) {
        paintContent();
      }
      if (changed.indexOf('liked') !== -1) {
        util.qsa('.track-row [data-act="toggle-like"]').forEach(function (node) {
          var on = !!store.state.liked[node.dataset.id];
          node.classList.toggle('is-active', on);
          node.innerHTML = Aura.icon(on ? 'heart-filled' : 'heart', { size: 15 });
        });
      }
    },
  };
})(window.Aura = window.Aura || {});
