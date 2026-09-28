# 接入 QQ 音乐

Aura 本身不含任何音乐版权内容，也不直接对接 QQ 音乐官方接口。要播放真实音源，需要在本机运行一个**第三方 QQ 音乐 API 服务**，由它处理登录态与音源解析，Aura 通过 HTTP 向它取数据。

```
Aura（渲染层） → 主进程代理 → 第三方 API 服务 → QQ 音乐
                     ↑ 携带 Cookie，绕过 CORS
```

## 一、准备第三方 API 服务

社区有若干开源实现，接口路径与响应字段各不相同。Aura 的适配器已对常见字段做容错取值（详见 [backend-contract.md](backend-contract.md)），但**路径必须与适配器约定一致**，否则需要改 `app/js/api/qq-adapter.js`。

适配器默认约定的接口如下（默认服务地址 `http://localhost:3300`）：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/` | 连通性探测（健康检查） |
| GET | `/recommend/playlist` | 首页推荐歌单 |
| GET | `/topList` | 排行榜（可选，失败时首页降级） |
| GET | `/search?key=&page=1&limit=60` | 搜索 |
| GET | `/album?id={albumMid}` | 专辑详情（含曲目） |
| GET | `/singer/list` | 艺人列表 |
| GET | `/playlist?id={disstid}` | 歌单详情（含曲目） |
| GET | `/lyric?id={songMid}` | 歌词（含翻译） |
| GET | `/song/urls?id={songMid}&quality={128\|320\|flac}` | 音频直链 |

把服务跑起来，确认 `curl http://localhost:3300/` 有响应。

## 二、在 Aura 里配置

打开 **设置 → 数据源**：

1. **当前数据源** 切到「QQ 音乐」。
2. **接口地址** 填你的服务地址，例如 `http://localhost:3300`。
3. **登录 Cookie** 粘贴浏览器里的 QQ 音乐登录态，至少包含 `uin` 与 `qqmusic_key`：
   - 在浏览器登录 `y.qq.com`；
   - 打开开发者工具 → Application/存储 → Cookies → `https://y.qq.com`；
   - 把 `uin=…; qqmusic_key=…` 这类键值对拼成一行粘贴进来。
   - 不填也能用，但只能拿到免登录内容，多数音源会返回无播放地址。
4. **音质** 选 `128 kbps` / `320 kbps` / `FLAC 无损`。实际能不能拿到取决于账号权限与音源是否提供。
5. 点 **测试连接** 确认连通。

配置会写入主进程的 `app-config.json`（位于系统 `userData` 目录），**Cookie 只保存在本机，不会上传到任何第三方**。浏览器环境下没有主进程，配置降级存到 `localStorage`，且无法设置 Cookie，只有免登录接口可用。

## 三、它是怎么工作的

**为什么必须走主进程代理。** 浏览器/渲染层直接请求第三方服务会遇到两个问题：跨域被拦；`fetch` 无法设置 `Cookie` 头。`electron/main.js` 注册了 `api:request` IPC 通道，由主进程发起请求——主进程没有同源策略，也能自由设置请求头。渲染层的 `qq-adapter.js` 检测到 `window.desktop.apiRequest` 存在时自动改走代理，浏览器环境下则降级为直连 `fetch`。

**频谱分析需要放行 CORS。** 要读取真实音频的频谱数据，`<audio>` 必须带 `crossOrigin` 且音源响应允许跨域。`electron/main.js` 里的 `corsAllowHosts`（默认 `qq.com` / `qqmusic.qq.com` / `stream.qqmusic.qq.com`）会对这些域名的响应补上 `Access-Control-Allow-Origin`。**没有关闭 `webSecurity`**，只对白名单域名生效。若你的音源来自其它域名，把它加进这份白名单。

**播放地址不做缓存。** 第三方服务返回的音频直链通常带有效期，`resolveStreamUrl` 每次播放都重新请求。若返回空地址，会给出「可能受版权限制，或登录 Cookie 已失效」的明确提示，而不是静默失败。

## 四、排错

| 现象 | 原因与处理 |
| --- | --- |
| `无法连接 http://localhost:3300，请确认第三方 API 服务已启动` | 服务没起来、端口不对，或地址写错。先 `curl` 验证。 |
| `接口返回的不是合法 JSON，请确认 API 地址指向 QQ 音乐接口服务` | 地址指向了一个返回 HTML 的服务（比如某个网页）。 |
| `接口返回 HTTP 404` | 第三方服务的路径与适配器约定不一致，需要改 `qq-adapter.js` 里的路径。 |
| 搜索/列表能出，但点播放报「没有可用的播放地址」 | Cookie 缺失或已过期；或该曲目需要付费/受版权限制；或所选音质账号无权限。换 `128 kbps` 再试。 |
| 有声音但频谱是合成的 | 音源域名不在 `corsAllowHosts` 白名单里，`getImageData` 被跨域拦下。把域名加进白名单后重启。 |
| 封面不显示 | 第三方服务返回的封面字段名不在容错列表内，或图片域名无法访问。 |
| 切换数据源后列表还是旧的 | 切回首页或重新进入对应视图；数据按视图缓存，切源会清空缓存。 |

## 五、合规提醒

第三方 API 服务与登录 Cookie 的使用需遵守 QQ 音乐的服务条款。本项目仅面向个人学习与本地播放场景，请勿用于分发、二次售卖或任何商业用途，并自行确保你的使用方式符合当地法律。
