# 后端交接契约

这份文档描述 Aura 数据层的**完整接口约定**。任何后端（Node / Go / Python / 任意语言）只要按这里的请求与响应结构实现 13 个接口，就能直接驱动这套界面——渲染层不需要改一行代码。

## 为什么可以这样替换

视图只调用 `Aura.api.*`，`api/index.js` 再把调用转给当前生效的适配器（`mock-adapter.js` 或 `qq-adapter.js`）。两个适配器实现**同一套接口签名**，并各自把数据源的原始结构归一化成下面的统一结构。因此：

- 换数据源 = 换一个适配器实例；
- 接自建后端 = 写一个新的适配器文件，或让后端直接输出本文档定义的统一结构，再让 `qq-adapter.js` 少做归一化。

约定：所有方法返回 **Promise**；失败时 **reject 一个 Error**，其 `message` 会直接显示给用户，因此文案要写成人话。列表类接口返回数组，详情类接口返回单个对象，查不到时 reject（不要返回 `null`）。

---

## 统一数据结构

### Track（曲目）

```json
{
  "id": "tr_01",
  "title": "夜航西飞",
  "duration": 274,
  "albumId": "al_01",
  "artistId": "ar_01",
  "trackNo": 1,
  "plays": 1284000,
  "quality": "320",
  "liked": false,
  "album": { "id": "al_01", "title": "夜航", "cover": "assets/covers/01-night-flight.jpg", "year": 2025 },
  "artist": { "id": "ar_01", "name": "陈默" }
}
```

`duration` 单位为**秒**。`album` 与 `artist` 是内联摘要，列表渲染直接取用，避免前端再发请求。`quality` 取 `128` / `320` / `flac`。

### Album（专辑）

```json
{
  "id": "al_01",
  "title": "夜航",
  "artistId": "ar_01",
  "year": 2025,
  "genre": "氛围电子",
  "cover": "https://…/cover.jpg",
  "trackCount": 4,
  "duration": 1096,
  "artist": { "id": "ar_01", "name": "陈默" }
}
```

`getAlbum(id)` 额外返回 `tracks`（按 `trackNo` 升序的 Track 数组）。

### Artist（艺人）

```json
{
  "id": "ar_01",
  "name": "陈默",
  "avatar": "https://…/avatar.jpg",
  "genres": ["氛围电子"],
  "followers": 128400,
  "bio": "…",
  "albumCount": 2,
  "trackCount": 4
}
```

`getArtist(id)` 额外返回 `albums`（Album 数组）与 `topTracks`（按 `plays` 降序的 Track 数组）。

### Playlist（歌单）

```json
{
  "id": "pl_01",
  "title": "深夜通勤",
  "desc": "…",
  "curator": "Aura 编辑部",
  "cover": "https://…/cover.jpg",
  "trackIds": ["tr_01", "tr_05"],
  "trackCount": 2,
  "duration": 596,
  "system": false
}
```

`getPlaylist(id)` 额外返回 `tracks`（Track 数组，顺序即播放顺序）。

---

## 13 个接口

### 1. `getHome()`

首页聚合。一次请求返回整屏内容。

```json
{
  "hero": {
    "eyebrow": "编辑精选",
    "title": "夜航",
    "desc": "…",
    "album": { /* Album */ },
    "track": { /* Track，可空 */ }
  },
  "stats": [{ "label": "曲库曲目", "value": "32", "unit": "首" }],
  "shelves": [
    { "id": "sh_01", "title": "为你精选", "sub": "根据最近的收听偏好生成",
      "type": "album", "items": [ /* Album[] 或 Playlist[] 或 Track[]，取决于 type */ ] }
  ],
  "recent": [ /* Track[] */ ]
}
```

`type` 取 `album` / `playlist` / `track`，决定 `items` 里放什么、卡片怎么画。`stats` 最多 4 项。`shelves` 建议 4–6 组。

### 2. `getTracks()` → `Track[]`

全量曲库，用于资料库「曲目」分页。

### 3. `getAlbums()` → `Album[]`

### 4. `getAlbum(id)` → `Album`（含 `tracks`）

### 5. `getArtists()` → `Artist[]`

### 6. `getArtist(id)` → `Artist`（含 `albums`、`topTracks`）

### 7. `getPlaylists()` → `Playlist[]`

### 8. `getPlaylist(id)` → `Playlist`（含 `tracks`）

### 9. `getGenres()` → `Genre[]`

搜索页「按风格浏览」用。

```json
[{ "id": "g_01", "name": "氛围电子", "colors": ["#1b2a5e", "#0b1230"], "icon": "waves" }]
```

`colors` 是卡片的渐变双色，`icon` 取 `icons.js` 里已有的图标名（可用 `Aura.icons.stroke` 查看全集）。点击风格卡片会触发 `play-genre`，前端按风格名去曲库里筛曲目，因此 `name` 要与 Track 的 `album.genre` 或艺人 `genres` 对得上。

### 10. `getLyrics(trackId)` → `{ lrc, translation, source }` 或 `null`

```json
{ "lrc": "[00:12.30]…\n[00:16.80]…", "translation": "[00:12.30]…", "source": "mock" }
```

`lrc` 为 LRC 原文；`translation` 为翻译轨 LRC，没有就传 `null`（前端按设置决定是否显示）。**无歌词时 resolve `null`**，前端会渲染「这首歌暂时没有歌词」空态——这是唯一允许返回 `null` 的接口。

### 11. `search(query)` → `{ query, tracks, albums, artists, playlists }`

```json
{ "query": "夜", "tracks": [], "albums": [], "artists": [], "playlists": [] }
```

空查询直接返回四个空数组，不要 reject。结果按类型分组，前端分块渲染，所以顺序不影响正确性。

### 12. `resolveStreamUrl(trackId)` → `{ url, quality, lossless, synthesized }`

```json
{ "url": "https://…/song.m4a", "quality": "320", "lossless": false, "synthesized": false }
```

- `url`：可播放的音频直链。**带有效期，前端不做缓存**，每次播放都重新请求。
- `url: null` 且 `synthesized: true`：表示没有真实音源。前端会启用内置合成音源，播放 / 进度 / 跳转 / 频谱依然可用，只是听感是程序生成的环境音。演示数据就是这样做的。
- 若该曲目**本应有音源但拿不到**（版权限制、登录失效），请 **reject** 并给出可读原因，而不是返回 `url: null`——两者的用户预期完全不同。

### 13. `testConnection()` → `{ ok, message }`

设置页「测试连接」调用，**不 reject**，用 `ok` 表达结果。

```json
{ "ok": false, "message": "无法连接 http://localhost:3300，请确认第三方 API 服务已启动" }
```

---

## 适配器接口

一个适配器就是下面这个对象。除了 13 个方法，还需要三个标识字段：

```js
var adapter = {
  id: 'mock',                    // 唯一标识，与设置里的 dataSource 取值对应
  label: '内置演示数据',          // 设置页显示的名字
  requiresNetwork: false,        // 是否需要联网（用于给出提示）

  getHome: function () {},
  getTracks: function () {},
  getAlbums: function () {},
  getAlbum: function (id) {},
  getArtists: function () {},
  getArtist: function (id) {},
  getPlaylists: function () {},
  getPlaylist: function (id) {},
  getGenres: function () {},
  getLyrics: function (trackId) {},
  search: function (query) {},
  resolveStreamUrl: function (trackId) {},
  testConnection: function () {},
};
```

若适配器需要额外配置（如接口地址、Cookie），再加一个 `setConfig(config)`，由 `api/index.js` 在配置变更时调用。

### 接入步骤

1. 新建 `app/js/api/my-adapter.js`，实现上面的对象，挂到 `Aura.apiMyAdapter`。
2. 在 `app/index.html` 的脚本列表里，紧挨着其它适配器加上 `<script src="js/api/my-adapter.js"></script>`。
3. 在 `app/js/api/index.js` 的 `activeAdapter()` 里加一个分支，并在设置页的数据源分段控件里加一个选项。

改动只涉及这三个文件，视图层零改动。

---

## 前端已有的缓存与容错

接入时不必重复实现这些：

- **按视图缓存**：`tracks` / `albums` / `artists` / `playlists` 取到后写入 store，再次进入资料库不会重复请求；切换数据源会清空缓存。
- **骨架屏与错误态**：请求进行中显示骨架屏；reject 后显示错误态并给出「重新加载」按钮。所以后端不需要返回 loading 之类的包装字段。
- **加载延迟**：演示适配器给每个请求加了 200–420ms 人工延迟，让加载态在演示中真实可见。真实后端不需要这个。

## 请求量与性能建议

- `getHome()` 一次返回整屏，避免首屏并发五六个请求。
- 列表接口一次性返回全量（演示数据是 32 首曲目 / 8 张专辑）。若曲库规模大，建议加分页参数，并同步改 `library.js` 的 `ensure()`。
- `search()` 返回曲目即可从结果里归并出专辑与艺人（QQ 适配器就是这么做的），省掉两次请求。
- 封面图建议在服务端就给出合适尺寸，前端不做缩放。
