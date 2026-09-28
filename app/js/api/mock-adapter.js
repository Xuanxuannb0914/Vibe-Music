/**
 * Aura · Mock 数据源适配器
 *
 * 与 qq-adapter.js 实现完全相同的接口，因此切换数据源时上层 UI 无需任何改动。
 * 所有函数都带人工延迟，让加载态 / 骨架屏在演示中真实可见。
 *
 * 集成点：每个函数的注释里标注了它对应真实后端的 HTTP 方法 + 路径 + 响应结构，
 * 后续接入真实服务时按注释机械替换即可。
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;

  function db() {
    return Aura.mock;
  }

  /** 按 id 取对象，取不到时抛业务错误（模拟真实接口的 404 语义） */
  function mustFind(list, id, label) {
    var found = list.filter(function (item) { return item.id === id; })[0];
    if (!found) throw new Error(label + ' 不存在：' + id);
    return found;
  }

  function joinTrack(track) {
    var d = db();
    var album = d.albums.filter(function (a) { return a.id === track.albumId; })[0] || null;
    var artist = d.artists.filter(function (a) { return a.id === track.artistId; })[0] || null;
    return Object.assign({}, track, {
      album: album ? { id: album.id, title: album.title, cover: album.cover, year: album.year } : null,
      artist: artist ? { id: artist.id, name: artist.name } : null,
    });
  }

  function joinAlbum(album) {
    var d = db();
    var artist = d.artists.filter(function (a) { return a.id === album.artistId; })[0] || null;
    var tracks = d.tracks.filter(function (t) { return t.albumId === album.id; });
    var duration = tracks.reduce(function (sum, t) { return sum + t.duration; }, 0);
    return Object.assign({}, album, {
      artist: artist ? { id: artist.id, name: artist.name } : null,
      trackCount: tracks.length,
      duration: duration,
    });
  }

  function joinPlaylist(playlist) {
    var d = db();
    var tracks = playlist.trackIds
      .map(function (id) { return d.tracks.filter(function (t) { return t.id === id; })[0]; })
      .filter(Boolean);
    var duration = tracks.reduce(function (sum, t) { return sum + t.duration; }, 0);
    var cover = playlist.cover;
    if (!cover && tracks.length) {
      var firstAlbum = d.albums.filter(function (a) { return a.id === tracks[0].albumId; })[0];
      cover = firstAlbum ? firstAlbum.cover : null;
    }
    return Object.assign({}, playlist, {
      cover: cover,
      trackCount: tracks.length,
      duration: duration,
    });
  }

  var adapter = {
    id: 'mock',
    label: '内置演示数据',
    requiresNetwork: false,

    /* GET /api/home — 首页聚合 */
    getHome: function () {
      return util.delay(420).then(function () {
        var d = db();
        var heroAlbum = mustFind(d.albums, d.home.heroAlbumId, '专辑');
        var heroTrack = d.tracks.filter(function (t) { return t.albumId === heroAlbum.id; })[0];
        return {
          hero: {
            eyebrow: d.home.heroEyebrow,
            title: heroAlbum.title,
            desc: d.home.heroDesc,
            album: joinAlbum(heroAlbum),
            track: heroTrack ? joinTrack(heroTrack) : null,
          },
          stats: d.home.stats,
          shelves: d.home.shelves.map(function (shelf) {
            var items;
            if (shelf.type === 'album') items = shelf.ids.map(function (id) { return joinAlbum(mustFind(d.albums, id, '专辑')); });
            else if (shelf.type === 'playlist') items = shelf.ids.map(function (id) { return joinPlaylist(mustFind(d.playlists, id, '歌单')); });
            else items = shelf.ids.map(function (id) { return joinTrack(mustFind(d.tracks, id, '曲目')); });
            return { id: shelf.id, title: shelf.title, sub: shelf.sub, type: shelf.type, items: items };
          }),
          recent: d.home.recentTrackIds.map(function (id) { return joinTrack(mustFind(d.tracks, id, '曲目')); }),
        };
      });
    },

    /* GET /api/tracks */
    getTracks: function () {
      return util.delay(300).then(function () {
        return db().tracks.map(joinTrack);
      });
    },

    /* GET /api/albums */
    getAlbums: function () {
      return util.delay(300).then(function () {
        return db().albums.map(joinAlbum);
      });
    },

    /* GET /api/albums/:id */
    getAlbum: function (id) {
      return util.delay(320).then(function () {
        var album = joinAlbum(mustFind(db().albums, id, '专辑'));
        album.tracks = db().tracks
          .filter(function (t) { return t.albumId === id; })
          .sort(function (a, b) { return a.trackNo - b.trackNo; })
          .map(joinTrack);
        return album;
      });
    },

    /* GET /api/artists */
    getArtists: function () {
      return util.delay(300).then(function () {
        var d = db();
        return d.artists.map(function (artist) {
          var albums = d.albums.filter(function (a) { return a.artistId === artist.id; });
          var trackCount = d.tracks.filter(function (t) { return t.artistId === artist.id; }).length;
          return Object.assign({}, artist, { albumCount: albums.length, trackCount: trackCount });
        });
      });
    },

    /* GET /api/artists/:id */
    getArtist: function (id) {
      return util.delay(320).then(function () {
        var d = db();
        var artist = mustFind(d.artists, id, '艺人');
        var albums = d.albums.filter(function (a) { return a.artistId === id; }).map(joinAlbum);
        var topTracks = d.tracks
          .filter(function (t) { return t.artistId === id; })
          .sort(function (a, b) { return b.plays - a.plays; })
          .slice(0, 5)
          .map(joinTrack);
        return Object.assign({}, artist, { albums: albums, topTracks: topTracks });
      });
    },

    /* GET /api/playlists */
    getPlaylists: function () {
      return util.delay(300).then(function () {
        return db().playlists.map(joinPlaylist);
      });
    },

    /* GET /api/playlists/:id */
    getPlaylist: function (id) {
      return util.delay(340).then(function () {
        var playlist = joinPlaylist(mustFind(db().playlists, id, '歌单'));
        playlist.tracks = playlist.trackIds
          .map(function (tid) { return db().tracks.filter(function (t) { return t.id === tid; })[0]; })
          .filter(Boolean)
          .map(joinTrack);
        return playlist;
      });
    },

    /* GET /api/genres */
    getGenres: function () {
      return util.delay(160).then(function () {
        return db().genres.slice();
      });
    },

    /* GET /api/lyrics?trackId= — 返回 LRC 原文，无歌词时返回 null（前端渲染空态） */
    getLyrics: function (trackId) {
      return util.delay(240).then(function () {
        var track = mustFind(db().tracks, trackId, '曲目');
        if (!track.lyrics) return null;
        return { lrc: track.lyrics, translation: track.lyricsTrans || null, source: 'mock' };
      });
    },

    /* GET /api/search?q= */
    search: function (query) {
      return util.delay(380).then(function () {
        var d = db();
        var q = String(query || '').trim().toLowerCase();
        if (!q) return { query: q, tracks: [], albums: [], artists: [], playlists: [] };

        function hit(text) {
          return String(text || '').toLowerCase().indexOf(q) !== -1;
        }

        var artists = d.artists.filter(function (a) { return hit(a.name) || (a.genres || []).some(hit); });
        var artistIds = artists.map(function (a) { return a.id; });

        var albums = d.albums.filter(function (a) {
          return hit(a.title) || hit(a.genre) || artistIds.indexOf(a.artistId) !== -1;
        });

        var tracks = d.tracks.filter(function (t) {
          var artist = d.artists.filter(function (a) { return a.id === t.artistId; })[0];
          var album = d.albums.filter(function (a) { return a.id === t.albumId; })[0];
          return hit(t.title) || hit(artist && artist.name) || hit(album && album.title);
        });

        var playlists = d.playlists.filter(function (p) { return hit(p.title) || hit(p.desc); });

        return {
          query: q,
          artists: artists,
          albums: albums.map(joinAlbum),
          tracks: tracks.map(joinTrack),
          playlists: playlists.map(joinPlaylist),
        };
      });
    },

    /**
     * GET /api/stream/:trackId
     * 演示数据不含真实音频文件，返回 url=null。
     * 音频引擎检测到 url 为空时会启用内置合成音源（见 audio.js 的 SynthBackend），
     * 因此播放 / 进度 / 跳转 / 频谱全部真实可用，只是听感为程序生成的环境音。
     */
    resolveStreamUrl: function (trackId) {
      return util.delay(120).then(function () {
        var track = mustFind(db().tracks, trackId, '曲目');
        return {
          url: null,
          quality: track.quality || '320',
          lossless: track.quality === 'flac',
          synthesized: true,
        };
      });
    },

    /* GET /api/health */
    testConnection: function () {
      return util.delay(220).then(function () {
        return { ok: true, message: '内置演示数据已就绪，共 ' + db().tracks.length + ' 首曲目。' };
      });
    },
  };

  Aura.apiMockAdapter = adapter;
})(window.Aura = window.Aura || {});
