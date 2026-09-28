# 接入 QQ 音乐

Aura 本身不含任何音乐版权内容。要播放真实音源，需要在本机跑一个**QQ 音乐接口服务**，由它去和 QQ 通信、把各家接口五花八门的字段翻译成 Aura 认识的统一结构。

这个服务已经内置在仓库里：`server/qq-server.js`，零第三方依赖，只用 Node 内置模块。

```
Aura（渲染层） → 主进程代理 → server/qq-server.js → QQ 音乐
                     ↑ 携带 Cookie，绕过 CORS
```

## 一、启动服务

```bash
npm run qq-server          # 默认 http://127.0.0.1:3300
PORT=3400 npm run qq-server # 换端口（记得同步改应用里的接口地址）
```

验证：

```bash
curl http://127.0.0.1:3300/
# {"result":100,"message":"Aura QQ 音乐服务运行中","loggedIn":false,"routes":[...]}
```

`loggedIn` 为 `false` 说明当前是免登录模式，只能播放非付费曲目。

## 二、在 Aura 里配置

打开 **设置 → 数据源**：

1. **当前数据源** 切到「QQ 音乐」。
2. **接口地址** 填 `http://localhost:3300`。
3. **音质** 选 `128 kbps`（免登录只有这一档可用）。
4. 点 **测试连接** 确认连通。

**登录是可选的，但强烈建议。** 不登录也能搜索、看专辑/歌单、拿歌词，并播放非付费曲目；付费与版权受限曲目会返回 `104003`，此时应用会提示「该曲目需要登录 QQ 音乐才能播放」。

登录方式是在 **设置 → 数据源 → 账号** 点「扫码登录」：屏幕中央弹出二维码，用手机 QQ 扫码并在手机上确认即可。Cookie 由本地服务自动换回并写入配置，不需要手动复制。

二维码流程（`/login/qr` → `/login/poll`）的细节：

- `qrsig` 是这次登录的种子，**只留在服务端内存**，前端只拿到一张 PNG 和会话 id；
- 轮询接口用 `qrsig` 算出 `ptqrtoken` 后请求 `ptqrlogin`，扫码确认后该接口会返回「登录成功」和一个跳转地址；
- **跳转地址本身不会给出 `qqmusic_key`**，必须再走三步 QQ 互联的 OAuth 流程才能拿到登录 Cookie（`exchangeLoginCookie`）：
  1. 请求 check_sig，从 `Set-Cookie` 里取 `p_skey`，算出 `g_tk`；
  2. 带 `g_tk` 向 `graph.qq.com/oauth2.0/authorize` 换一个一次性 `code`（**必须是 multipart/form-data**，urlencoded 会被拒）；
  3. 用 `code` 调 `musicu.fcg` 的 `QQConnectLogin.LoginServer`，这一步才下发 `qqmusic_key` / `uin`；
- 会话 3 分钟过期，进程退出即失效；过期或失败时弹窗里会出现「刷新二维码」。

服务端只在扫码状态发生跳变时打一行日志（`[qq] 扫码状态 → …`），排查时看这行就能知道卡在哪一步。

**判断扫码状态别看 `ptuiCB` 的 code。** 全新二维码和已扫描都是 `66`，只有文案会变（未扫描是「二维码未失效。」，扫码后才出现「已扫描」，成功是「登录成功」），所以服务用文案关键词判断。

如果扫码走不通，还可以手动粘贴：在浏览器登录 `y.qq.com` → 开发者工具 → Application/Storage → Cookies → `https://y.qq.com` → 把 `uin=…; qqmusic_key=…` 拼成一行填进「登录 Cookie」。

配置写入主进程的 `app-config.json`（系统 `userData` 目录），**Cookie 只保存在本机**。浏览器环境下没有主进程，配置降级到 `localStorage`，且无法设置 Cookie。

## 三、接口一览

适配器与内置服务约定的路径（`docs/backend-contract.md` 有完整字段定义）：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/` | 连通性探测（健康检查） |
| GET | `/search?key=&page=1&limit=60` | 搜索（曲目 / 专辑 / 艺人） |
| GET | `/recommend/playlist?limit=12` | 推荐歌单 |
| GET | `/recommend/album?limit=12` | 推荐专辑（从热歌榜按专辑去重生成） |
| GET | `/topList` | 排行榜列表 |
| GET | `/album?id={albumMid}` | 专辑详情（含曲目） |
| GET | `/playlist?id={disstid}` | 歌单详情；`id` 传榜单 topid（如 `26`）也认 |
| GET | `/singer/list?limit=60` | 艺人列表 |
| GET | `/singer/info?singermid={mid}` | 艺人详情（含代表作） |
| GET | `/lyric?id={songMid}&songid={songId}` | 歌词（含翻译） |
| GET | `/song/urls?id={songMid}&quality={128\|320\|flac}` | 音频直链 |
| GET | `/login/qr` | 取登录二维码（返回 `{session, image, expiresIn}`） |
| GET | `/login/poll?session={id}` | 轮询扫码状态；`success` 时回传拼好的 Cookie |
| GET | `/login/status` | 校验当前 Cookie 的登录态（顺带取昵称、会员标记） |

`/song/urls` 返回 `{url, quality, lossless, code, needLogin}`；`url` 为空时看 `needLogin` 判断是不是缺登录态。

`/login/poll` 的 `status` 取值：`pending`（待扫码）、`scanned`（已扫描待确认）、`success`、`expired` / `invalid`（需刷新二维码）、`failed`（已确认但没取到 `qqmusic_key`，改用手动粘贴）。

## 四、几个实现上的坑

这些都是实测踩过的，记下来避免重复排查：

**CDN 文件名用的是 `media_mid`，不是 `songmid`。** 两者经常不一样（例如 `songmid=001b3yxJ17AH7C` 对应 `media_mid=000RuUeD41h1wr`）。列表接口不返回 `media_mid`，服务会按 `songmid` 单独查一次歌曲详情并缓存。用错 id 时 QQ 照样返回 vkey 和 purl，但下载会得到 `404 file not exist`——**签名有效不等于文件存在**。

**免登录只放行 128k。** 320k / FLAC 属于会员权益，未登录时返回 `104003`。128k 下还有 `.mp3`(M500) 与 `.m4a`(C400) 两种封装，不同曲目上架的形态不一样，所以服务会先试 M500，失败再试 C400，避免漏掉能播的歌。

**热门曲目基本都返回 `104003`。** 榜单前排的歌大多是付费/版权曲，这是正常的，不是接口坏了。用「纯音乐」「民谣」这类关键词搜索能更容易命中可播放的曲目。

**TLS 证书链。** 部分环境（公司代理、自签根证书）下 Node 自带根证书不完整，直连 `u.y.qq.com` 会报 `unable to get local issuer certificate`。服务会自动把操作系统信任库（`/etc/ssl/cert.pem` 等）并入 CA 列表，无需手动设 `NODE_EXTRA_CA_CERTS`。

**曲目 id 里编了数字 songid。** 歌词接口只认数字 `songid`，而列表接口给的是字母 `mid`。上层只把 `track.id` 传回来，所以适配器把它编码成 `qq_tr_{mid}~{songid}` 带着走（`encodeTrackId` / `decodeTrackId`）。改动曲目 id 的生成方式时，`getLyrics` 与 `resolveStreamUrl` 都要同步改。

**为什么必须走主进程代理。** 渲染层直接请求会遇到跨域被拦、`fetch` 无法设置 `Cookie` 头两个问题。`electron/main.js` 注册了 `api:request` IPC 通道，由主进程发起请求，并限制只能访问「设置里配置的接口地址」所在源，不会变成任意请求代理。

**频谱分析需要放行 CORS。** 要读取真实音频的频谱，`<audio>` 必须带 `crossOrigin` 且音源响应允许跨域。`electron/main.js` 的 `corsAllowHosts` 默认含 `qq.com` / `qqmusic.qq.com` / `stream.qqmusic.qq.com` / `tc.qq.com`，只对这些域名补 `Access-Control-Allow-Origin`，**没有关闭 `webSecurity`**。音源来自其它域名时把它加进白名单再重启。

## 五、排错

| 现象 | 原因与处理 |
| --- | --- |
| `无法连接 http://localhost:3300` | 服务没起来或地址写错。先 `curl http://localhost:3300/` 验证。 |
| `接口返回的不是合法 JSON` | 地址指向了一个返回 HTML 的服务。 |
| 搜索/列表正常，点播放提示需要登录 | 该曲目是付费/版权曲。换一首非付费曲目，或登录后重试。 |
| 扫码后一直停在「请用手机 QQ 扫描二维码」 | 二维码已过期（3 分钟）。点弹窗里的「刷新二维码」。 |
| 提示「已确认登录，但未取到 `qqmusic_key`」 | 跳转链上没拿到关键 Cookie，改用手动粘贴登录态。 |
| 播放地址返回但下载 `404 file not exist` | CDN 文件名与 `media_mid` 不匹配，属于服务端 bug，检查 `mediaMidOf`。 |
| `unable to get local issuer certificate` | 系统信任库没被读到。确认 `/etc/ssl/cert.pem` 存在；不存在时手动设 `NODE_EXTRA_CA_CERTS`。 |
| 端口被占用 | `PORT=3400 npm run qq-server`，并把应用里的接口地址一起改掉。 |
| 有声音但频谱是合成的 | 音源域名不在 `corsAllowHosts` 里，加白名单后重启。 |
| 封面不显示 | 封面走 `y.qq.com/music/photo_new/`，检查网络能否访问该域名。 |

## 六、合规提醒

本项目仅面向个人学习与本地播放场景。请勿用于分发、二次售卖或任何商业用途，并自行确保使用方式符合 QQ 音乐服务条款与当地法律。
