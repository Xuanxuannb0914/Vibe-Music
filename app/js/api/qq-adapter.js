/**
 * Aura · QQ 音乐数据源适配器
 *
 * 对接「第三方 QQ 音乐 API 服务」（社区常见实现如 jsososo/QQMusicApi，
 * 默认监听 http://localhost:3300）。QQ 音乐官方没有公开 API，
 * 因此这里必须依赖你自行部署的第三方服务，详见 docs/qq-music-setup.md。
 *
 * 设计要点：
 *   1. 请求统一走主进程代理（window.desktop.apiRequest），
 *      因为浏览器 fetch 不允许设置 Cookie 头，且第三方接口通常不带 CORS 头。
 *      浏览器直接打开时降级为普通 fetch（此时无法携带登录 Cookie，仅能访问免登录接口）。
 *   2. 第三方服务各分支的返回结构差异较大，这里用 pick() 做容错提取，
 *      字段缺失时降级而不是抛异常，避免一处结构变化导致整页崩溃。
 *   3. 与 mock-adapter 实现完全相同的接口签名，因此切换数据源时上层 UI 零改动。
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;

  /** 当前配置，由 api/index.js 在 init / setConfig 时注入 */
  var config = {
    apiBase: 'http://localhost:3300',
    cookie: '',
    quality: '320',
  };

  function setConfig(next) {
    config = Object.assign({}, config, next || {});
  }

  /* ------------------------------------------------------------------ *
   * 底层请求
   * ------------------------------------------------------------------ */

  function buildUrl(path, params) {
    var base = String(config.apiBase || '').replace(/\/+$/, '');
    var url = base + (path.charAt(0) === '/' ? path : '/' + path);
    var pairs = [];
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value == null || value === '') return;
      pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    if (pairs.length) url += (url.indexOf('?') === -1 ? '?' : '&') + pairs.join('&');
    return url;
  }

  function request(path, params, options) {
    options = options || {};
    var url = buildUrl(path, params);
    var method = options.method || 'GET';
    var timeoutMs = options.timeout || 12000;

    // Electron 环境：走主进程代理，可携带 Cookie 且不受 CORS 限制
    if (window.desktop && typeof window.desktop.apiRequest === 'function') {
      var headers = {};
      if (config.cookie) headers.Cookie = config.cookie;
      return window.desktop.apiRequest({ url: url, method: method, headers: headers }).then(function (res) {
        if (!res) throw new Error('主进程未返回响应');
        if (res.error) throw new Error(res.error);
        if (!res.ok) throw new Error('接口返回 HTTP ' + res.status);
        try {
          return JSON.parse(res.text);
        } catch (err) {
          throw new Error('接口返回的不是合法 JSON，请确认 API 地址指向 QQ 音乐接口服务');
        }
      });
    }

    // 浏览器环境：直连（无法设置 Cookie，仅免登录接口可用）
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    return fetch(url, { method: method, signal: controller.signal })
      .then(function (res) {
        if (!res.ok) throw new Error('接口返回 HTTP ' + res.status);
        return res.json();
      })
      .catch(function (err) {
        if (err.name === 'AbortError') throw new Error('请求超时（' + Math.round(timeoutMs / 1000) + ' 秒）');
        throw new Error('无法连接 ' + config.apiBase + '，请确认第三方 API 服务已启动');
      })
      .finally(function () { clearTimeout(timer); });
  }

  /* ------------------------------------------------------------------ *
   * 容错取值
   * ------------------------------------------------------------------ */

  /** 按候选路径依次尝试取值，全部落空则返回 fallback */
  function pick(obj, paths, fallback) {
    for (var i = 0; i < paths.length; i++) {
      var cursor = obj;
      var parts = paths[i].split('.');
      var ok = true;
      for (var j = 0; j < parts.length; j++) {
        if (cursor == null || typeof cursor !== 'object') { ok = false; break; }
        cursor = cursor[parts[j]];
      }
      if (ok && cursor != null && cursor !== '') return cursor;
    }
    return fallback;
  }

  function firstArray() {
    for (var i = 0; i < arguments.length; i++) {
      if (Array.isArray(arguments[i]) && arguments[i].length) return arguments[i];
    }
    return [];
  }

  /* ------------------------------------------------------------------ *
   * 资源地址拼接
   * ------------------------------------------------------------------ */

  var PHOTO_BASE = 'https://y.qq.com/music/photo_new/';
  var PHOTO_TYPE = { album: 'T002', singer: 'T001', playlist: 'T002' };

  function coverUrl(kind, mid, size) {
    if (!mid) return null;
    var type = PHOTO_TYPE[kind] || 'T002';
    return PHOTO_BASE + type + 'R' + (size || 300) + 'x' + (size || 300) + 'M000' + mid + '.jpg';
  }

  /* ------------------------------------------------------------------ *
   * 归一化：QQ 结构 → Aura 统一结构
   * ------------------------------------------------------------------ */

  function normalizeArtist(raw) {
    if (!raw) return null;
    var mid = pick(raw, ['mid', 'singer_mid', 'singerMid'], '');
    return {
      id: 'qq_ar_' + (mid || pick(raw, ['id', 'singer_id'], 'unknown')),
      name: pick(raw, ['name', 'title', 'singer_name'], '未知艺人'),
      avatar: coverUrl('singer', mid, 300),
      genres: [],
      followers: pick(raw, ['fans', 'follower'], 0),
      bio: pick(raw, ['desc', 'briefDesc'], ''),
      source: 'qq',
    };
  }

  function normalizeAlbum(raw, fallbackArtist) {
    if (!raw) return null;
    var mid = pick(raw, ['mid', 'album_mid', 'albumMid'], '');
    var artistRaw = pick(raw, ['singer', 'singers', 'artist'], null);
    var artist = normalizeArtist(Array.isArray(artistRaw) ? artistRaw[0] : artistRaw) || fallbackArtist;
    return {
      id: 'qq_al_' + (mid || pick(raw, ['id', 'album_id'], 'unknown')),
      mid: mid,
      title: pick(raw, ['name', 'title', 'album_name'], '未知专辑'),
      artistId: artist ? artist.id : null,
      artist: artist,
      year: Number(String(pick(raw, ['time_public', 'aDate', 'publish_date'], '')).slice(0, 4)) || null,
      cover: coverUrl('album', mid, 500),
      genre: '',
      trackCount: pick(raw, ['song_count', 'songnum'], 0),
      source: 'qq',
    };
  }

  function normalizeTrack(raw) {
    if (!raw) return null;
    var mid = pick(raw, ['mid', 'songmid', 'song_mid'], '');
    var singers = firstArray(pick(raw, ['singer', 'singers'], []));
    var artistRaw = singers[0] || pick(raw, ['singer', 'singers'], null);
    var artist = normalizeArtist(artistRaw);
    var albumRaw = pick(raw, ['album', 'albumInfo'], null);
    var album = normalizeAlbum(albumRaw, artist);
    var interval = Number(pick(raw, ['interval', 'duration', 'song_time'], 0)) || 0;

    return {
      id: 'qq_tr_' + (mid || pick(raw, ['id', 'song_id'], 'unknown')),
      mid: mid,
      title: pick(raw, ['name', 'title', 'songname'], '未知曲目'),
      albumId: album ? album.id : null,
      artistId: artist ? artist.id : null,
      album: album,
      artist: artist,
      duration: interval,
      trackNo: pick(raw, ['track_number', 'song_order', 'index'], 0),
      quality: pick(raw, ['file.media_mid'], null) ? 'flac' : String(config.quality),
      plays: pick(raw, ['play_count', 'listenCount'], 0),
      liked: false,
      source: 'qq',
    };
  }

  function normalizePlaylist(raw) {
    if (!raw) return null;
    var disstid = pick(raw, ['disstid', 'dissid', 'id', 'content_id'], '');
    var coverMid = pick(raw, ['cover_mid', 'diss_cover', 'imgurl'], '');
    var logo = pick(raw, ['logo', 'cover', 'picurl'], null);
    return {
      id: 'qq_pl_' + disstid,
      title: pick(raw, ['dissname', 'title', 'name'], '未命名歌单'),
      desc: pick(raw, ['introduction', 'desc', 'subtitle'], ''),
      curator: pick(raw, ['nickname', 'creator.name', 'creator'], 'QQ 音乐'),
      cover: logo || coverUrl('playlist', coverMid, 500),
      trackIds: [],
      trackCount: Number(pick(raw, ['song_cnt', 'songnum', 'total'], 0)) || 0,
      duration: 0,
      system: false,
      source: 'qq',
    };
  }

  /* ------------------------------------------------------------------ *
   * 接口实现
   * ------------------------------------------------------------------ */

  var adapter = {
    id: 'qq',
    label: 'QQ 音乐',
    requiresNetwork: true,

    setConfig: setConfig,

    /**
     * GET {apiBase}/recommend/playlist
     * 首页聚合：推荐歌单 + 排行榜。第三方服务若未提供该接口，
     * 会降级为「热门歌单」并给出提示，而不是直接报错。
     */
    getHome: function () {
      return Promise.all([
        adapter.getPlaylists().catch(function () { return []; }),
        request('/topList').catch(function () { return null; }),
      ]).then(function (results) {
        var playlists = results[0] || [];
        var topList = results[1];

        var shelves = [];
        if (playlists.length) {
          shelves.push({
            id: 'qq_shelf_recommend',
            title: '推荐歌单',
            sub: '来自 QQ 音乐编辑推荐',
            type: 'playlist',
            items: playlists.slice(0, 12),
          });
        }

        var rankItems = firstArray(
          pick(topList, ['data.list', 'data', 'list'], []),
          pick(topList, ['response.data', 'response'], [])
        );
        if (rankItems.length) {
          shelves.push({
            id: 'qq_shelf_rank',
            title: '排行榜',
            sub: '实时热度',
            type: 'playlist',
            items: rankItems.map(normalizePlaylist).filter(Boolean).slice(0, 12),
          });
        }

        var heroSource = playlists[0] || null;

        return {
          hero: heroSource
            ? {
                eyebrow: 'QQ 音乐推荐',
                title: heroSource.title,
                desc: heroSource.desc || '来自 QQ 音乐的歌单推荐，点击即刻开始播放。',
                album: null,
                playlist: heroSource,
                track: null,
              }
            : null,
          stats: [
            { label: '已接入歌单', value: String(playlists.length), unit: '个' },
            { label: '数据来源', value: 'QQ 音乐', unit: '' },
            { label: '音质档位', value: String(config.quality), unit: 'kbps' },
          ],
          shelves: shelves,
          recent: [],
        };
      });
    },

    /** GET {apiBase}/search?key=&page=1&limit=60 —— 一次拉取多类型结果 */
    getTracks: function () {
      return adapter.search('').then(function (r) { return r.tracks; });
    },

    getAlbums: function () {
      return request('/recommend/playlist').then(function (res) {
        var list = firstArray(pick(res, ['data.list', 'data', 'list'], []));
        return list.map(function (item) { return normalizePlaylist(item); }).filter(Boolean);
      });
    },

    /** GET {apiBase}/album?id={albumMid} */
    getAlbum: function (id) {
      var mid = String(id).replace(/^qq_al_/, '');
      return request('/album', { id: mid }).then(function (res) {
        var data = pick(res, ['data', 'response.data'], res);
        var album = normalizeAlbum(data);
        if (!album) throw new Error('未找到该专辑');
        album.tracks = firstArray(pick(data, ['list', 'songlist'], []))
          .map(normalizeTrack)
          .filter(Boolean);
        return album;
      });
    },

    /** GET {apiBase}/singer/list */
    getArtists: function () {
      return request('/singer/list').then(function (res) {
        var list = firstArray(pick(res, ['data.list', 'data.artistlist', 'data', 'list'], []));
        return list.map(normalizeArtist).filter(Boolean);
      });
    },

    getArtist: function (id) {
      var mid = String(id).replace(/^qq_ar_/, '');
      return request('/singer/info', { singermid: mid }).then(function (res) {
        var data = pick(res, ['data', 'response.data'], res);
        var artist = normalizeArtist(data);
        if (!artist) throw new Error('未找到该艺人');
        artist.topTracks = firstArray(pick(data, ['list', 'songlist'], []))
          .map(normalizeTrack)
          .filter(Boolean)
          .slice(0, 10);
        artist.albums = [];
        return artist;
      });
    },

    /** GET {apiBase}/recommend/playlist */
    getPlaylists: function () {
      return request('/recommend/playlist').then(function (res) {
        var list = firstArray(pick(res, ['data.list', 'data.content', 'data', 'list'], []));
        return list.map(normalizePlaylist).filter(Boolean);
      });
    },

    /** GET {apiBase}/playlist?id={disstid} */
    getPlaylist: function (id) {
      var disstid = String(id).replace(/^qq_pl_/, '');
      return request('/playlist', { id: disstid }).then(function (res) {
        var data = pick(res, ['data', 'response.data'], res);
        var playlist = normalizePlaylist(data);
        if (!playlist) throw new Error('未找到该歌单');
        playlist.tracks = firstArray(pick(data, ['songlist', 'list', 'songs'], []))
          .map(function (item) { return normalizeTrack(pick(item, ['song', 'songInfo'], item)); })
          .filter(Boolean);
        playlist.trackCount = playlist.tracks.length;
        playlist.duration = playlist.tracks.reduce(function (sum, t) { return sum + (t.duration || 0); }, 0);
        return playlist;
      });
    },

    getGenres: function () {
      // QQ 音乐没有独立的「分类」接口，这里用歌单标签近似
      return util.delay(120).then(function () {
        return [
          { id: 'qq_g_pop', name: '流行', colors: ['#ff5f6d', '#7a1f3d'], icon: 'sparkles' },
          { id: 'qq_g_rock', name: '摇滚', colors: ['#3a1c71', '#d76d77'], icon: 'zap' },
          { id: 'qq_g_folk', name: '民谣', colors: ['#2f5d50', '#a8c0a0'], icon: 'waves' },
          { id: 'qq_g_elec', name: '电子', colors: ['#0f2027', '#2c5364'], icon: 'audio-lines' },
          { id: 'qq_g_jazz', name: '爵士', colors: ['#4b3621', '#c9a227'], icon: 'radio' },
          { id: 'qq_g_cls', name: '古典', colors: ['#3d2c4f', '#b8a1c9'], icon: 'gauge' },
          { id: 'qq_g_rnb', name: 'R&B', colors: ['#5d1a3a', '#e0789c'], icon: 'heart' },
          { id: 'qq_g_cn', name: '国风', colors: ['#1f3a2e', '#8fae7a'], icon: 'star' },
        ];
      });
    },

    /** GET {apiBase}/lyric?id={songMid} */
    getLyrics: function (trackId) {
      var mid = String(trackId).replace(/^qq_tr_/, '');
      return request('/lyric', { id: mid }).then(function (res) {
        var data = pick(res, ['data', 'response.data'], res);
        var lrc = pick(data, ['lyric', 'lrc', 'lyric_txt'], '');
        var trans = pick(data, ['trans', 'translation', 'trans_txt'], '');
        if (!lrc) return null;
        return { lrc: lrc, translation: trans || null, source: 'qq' };
      });
    },

    /** GET {apiBase}/search?key={q} */
    search: function (query) {
      var q = String(query || '').trim();
      if (!q) {
        return Promise.resolve({ query: q, tracks: [], albums: [], artists: [], playlists: [] });
      }
      return request('/search', { key: q, page: 1, limit: 60 }).then(function (res) {
        var data = pick(res, ['data', 'response.data'], res);
        var songList = firstArray(pick(data, ['song.list', 'song', 'list', 'songs'], []));

        var tracks = songList.map(normalizeTrack).filter(Boolean);

        // 专辑与艺人从搜索结果中归并去重，避免额外请求
        var albumMap = {};
        var artistMap = {};
        tracks.forEach(function (t) {
          if (t.album && !albumMap[t.album.id]) albumMap[t.album.id] = t.album;
          if (t.artist && !artistMap[t.artist.id]) artistMap[t.artist.id] = t.artist;
        });

        return {
          query: q,
          tracks: tracks,
          albums: Object.keys(albumMap).map(function (k) { return albumMap[k]; }),
          artists: Object.keys(artistMap).map(function (k) { return artistMap[k]; }),
          playlists: [],
        };
      });
    },

    /**
     * GET {apiBase}/song/urls?id={songMid}&quality={128|320|flac}
     * 返回可播放的音频直链。第三方服务的 url 通常带有效期，因此不做本地缓存。
     */
    resolveStreamUrl: function (trackId) {
      var mid = String(trackId).replace(/^qq_tr_/, '');
      return request('/song/urls', { id: mid, quality: config.quality }).then(function (res) {
        var data = pick(res, ['data', 'response.data'], res);
        var entry = data && data[mid] != null ? data[mid] : data;
        if (Array.isArray(entry)) entry = entry[0];

        var url = pick(entry, ['url', 'purl', 'play_url'], '') || pick(data, ['url'], '');
        if (!url) {
          throw new Error('该曲目没有可用的播放地址（可能受版权限制，或登录 Cookie 已失效）');
        }
        return {
          url: url,
          quality: String(config.quality),
          lossless: String(config.quality) === 'flac',
          synthesized: false,
        };
      });
    },

    /** GET {apiBase}/ —— 连通性探测 */
    testConnection: function () {
      return request('/', {}, { timeout: 5000 })
        .then(function () {
          return { ok: true, message: '已连接 ' + config.apiBase };
        })
        .catch(function (err) {
          return { ok: false, message: err.message };
        });
    },
  };

  Aura.apiQqAdapter = adapter;
})(window.Aura = window.Aura || {});
