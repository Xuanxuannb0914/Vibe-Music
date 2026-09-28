/**
 * Aura · 详情页（专辑 / 艺人 / 歌单）
 *
 * 三种详情共用同一套「编辑式头图 + 内容区」骨架，
 * 差别只在头图文案与内容区编排，因此保持在一个文件里便于横向对照。
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;
  var ui = Aura.ui;
  var store = Aura.store;

  var state = { key: null, data: null, error: null, loading: false };
  var hostRef = null;

  function params() {
    var p = store.state.routeParams || {};
    return { kind: p.kind, id: p.id };
  }

  function load(kind, id) {
    var key = kind + ':' + id;
    if (state.key === key && (state.data || state.loading)) return;

    state = { key: key, data: null, error: null, loading: true };
    paint();

    var fetcher = kind === 'album' ? Aura.api.getAlbum(id)
      : kind === 'artist' ? Aura.api.getArtist(id)
        : Aura.api.getPlaylist(id);

    fetcher.then(function (data) {
      if (state.key !== key) return;
      state.data = data;
      state.loading = false;
      paint();
    }).catch(function (err) {
      if (state.key !== key) return;
      state.error = err.message;
      state.loading = false;
      paint();
    });
  }

  /* ------------------------------------------------------------------ *
   * 头图
   * ------------------------------------------------------------------ */

  function heroArt(art, title) {
    return art ? ui.cover(art, { cls: 'hero__art', alt: title, overlay: true }) : '';
  }

  function heroBlock(opts) {
    var bits = (opts.meta || []).filter(Boolean)
      .map(function (bit) { return '<span>' + ui.esc(bit) + '</span>'; })
      .join('<span class="dot"></span>');

    return '<section class="hero">' +
      (opts.art ? '<div class="hero__wash" style="background-image:url(' + ui.esc(opts.art) + ')"></div>' : '') +
      '<div class="hero__veil"></div>' +
      '<div class="hero__content">' +
        '<span class="hero__eyebrow">' + Aura.icon(opts.icon || 'disc', { size: 13 }) +
          ui.esc(opts.eyebrow) + '</span>' +
        '<h1 class="hero__title">' + ui.esc(opts.title) + '</h1>' +
        (opts.desc ? '<p class="hero__desc">' + ui.esc(opts.desc) + '</p>' : '') +
        (bits ? '<div class="hero__meta">' + bits + '</div>' : '') +
        '<div class="hero__actions">' + (opts.actions || '') + '</div>' +
      '</div>' +
      heroArt(opts.art, opts.title) +
    '</section>';
  }

  /* ------------------------------------------------------------------ *
   * 各类型内容
   * ------------------------------------------------------------------ */

  function renderAlbum(album) {
    var ctx = ui.setContext('detail:album:' + album.id, album.tracks || []);
    var tracks = album.tracks || [];

    var hero = heroBlock({
      eyebrow: '专辑',
      icon: 'disc',
      title: album.title,
      desc: [album.genre, album.year ? album.year + ' 年发行' : '', '共 ' + tracks.length + ' 首曲目']
        .filter(Boolean).join(' · '),
      meta: [
        album.artist && album.artist.name,
        album.year,
        tracks.length + ' 首',
        util.formatDurationLong(album.duration),
      ],
      art: album.cover,
      actions: ui.btn('播放全部', {
        variant: 'primary', icon: 'play', act: 'play-collection', data: { ctx: ctx },
      }) +
      ui.btn('随机播放', {
        icon: 'shuffle', act: 'shuffle-collection', data: { ctx: ctx },
      }),
    });

    return hero + (tracks.length
      ? ui.sectionHead('曲目', '按专辑原始顺序') +
        ui.trackList(tracks, {
          ctx: ctx,
          currentId: Aura.player.currentId(),
          playing: store.state.playing,
          liked: store.state.liked,
        })
      : ui.emptyState('music', '这张专辑还没有曲目', '换一张专辑看看。'));
  }

  function renderArtist(artist) {
    var top = artist.topTracks || [];
    var albums = artist.albums || [];
    var ctx = ui.setContext('detail:artist:' + artist.id, top);
    var art = artist.avatar || (albums[0] && albums[0].cover) || '';

    var hero = heroBlock({
      eyebrow: '艺人',
      icon: 'user',
      title: artist.name,
      desc: artist.bio || (artist.genres || []).join(' · '),
      meta: [
        artist.followers ? util.formatCount(artist.followers) + ' 关注' : '',
        albums.length ? albums.length + ' 张专辑' : '',
        top.length ? '热门 ' + top.length + ' 首' : '',
      ],
      art: art,
      actions: top.length
        ? ui.btn('播放热门', {
          variant: 'primary', icon: 'play', act: 'play-collection', data: { ctx: ctx },
        })
        : '',
    });

    return hero +
      (top.length
        ? ui.sectionHead('热门曲目', '按播放量排序') +
          ui.trackList(top, {
            ctx: ctx,
            currentId: Aura.player.currentId(),
            playing: store.state.playing,
            liked: store.state.liked,
          })
        : '') +
      (albums.length
        ? ui.sectionHead('专辑', '共 ' + albums.length + ' 张') +
          '<div class="grid-cards stagger">' + albums.map(function (album) {
            return ui.albumCard(album);
          }).join('') + '</div>'
        : '');
  }

  function renderPlaylist(playlist) {
    var tracks = playlist.tracks || [];
    var ctx = ui.setContext('detail:playlist:' + playlist.id, tracks);

    var hero = heroBlock({
      eyebrow: '歌单',
      icon: 'list-music',
      title: playlist.title,
      desc: playlist.desc,
      meta: [
        playlist.curator,
        tracks.length + ' 首',
        util.formatDurationLong(playlist.duration),
      ],
      art: playlist.cover,
      actions: tracks.length
        ? ui.btn('播放全部', {
          variant: 'primary', icon: 'play', act: 'play-collection', data: { ctx: ctx },
        }) +
        ui.btn('随机播放', {
          icon: 'shuffle', act: 'shuffle-collection', data: { ctx: ctx },
        })
        : '',
    });

    return hero + (tracks.length
      ? ui.sectionHead('曲目', '共 ' + tracks.length + ' 首') +
        ui.trackList(tracks, {
          ctx: ctx,
          currentId: Aura.player.currentId(),
          playing: store.state.playing,
          liked: store.state.liked,
        })
      : ui.emptyState('music', '这个歌单还没有曲目', '换一个歌单看看。'));
  }

  /* ------------------------------------------------------------------ *
   * 渲染
   * ------------------------------------------------------------------ */

  function paint() {
    if (!hostRef) return;

    if (state.error) {
      hostRef.innerHTML = '<div class="view">' + ui.emptyState(
        'alert-triangle', '内容加载失败', state.error,
        ui.btn('返回资料库', { variant: 'primary', act: 'go', data: { route: 'library' } })
      ) + '</div>';
      return;
    }

    if (!state.data) {
      hostRef.innerHTML = '<div class="view">' + ui.skeletonHero() +
        '<div style="margin-top:var(--sp-10)">' + ui.skeletonRows(8) + '</div></div>';
      return;
    }

    var kind = params().kind;
    var body = kind === 'album' ? renderAlbum(state.data)
      : kind === 'artist' ? renderArtist(state.data)
        : renderPlaylist(state.data);

    hostRef.innerHTML = '<div class="view">' + body + '</div>';
    ui.syncAllSliders(hostRef);
  }

  Aura.views = Aura.views || {};

  Aura.views.detail = {
    heading: function () {
      if (state.data) return state.data.title || state.data.name || '详情';
      return '详情';
    },
    eyebrow: function () {
      var kind = params().kind;
      return kind === 'album' ? '专辑' : kind === 'artist' ? '艺人' : '歌单';
    },

    render: function (host) {
      hostRef = host;
      var p = params();
      load(p.kind, p.id);
      paint();
    },

    onState: function (changed) {
      if (changed.indexOf('liked') !== -1) {
        util.qsa('.track-row [data-act="toggle-like"]').forEach(function (node) {
          var on = !!store.state.liked[node.dataset.id];
          node.classList.toggle('is-active', on);
          node.innerHTML = Aura.icon(on ? 'heart-filled' : 'heart', { size: 15 });
        });
      }
    },

    /** 供 app.js 在路由离开时清理，避免残留旧数据 */
    reset: function () {
      state = { key: null, data: null, error: null, loading: false };
      hostRef = null;
    },
  };
})(window.Aura = window.Aura || {});
