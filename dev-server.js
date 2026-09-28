/**
 * Aura · 本地开发服务器（禁用缓存）
 *
 * 为什么不用 `python3 -m http.server`：
 * 它只发 Last-Modified、不发 Cache-Control，浏览器会对响应做启发式缓存，
 * 于是改完代码刷新页面仍可能看到旧内容。这里显式声明 no-store，
 * 并保留 Range 支持（音频拖动进度需要，与 http.server 行为对等）。
 *
 * 用法：npm run serve        （默认 4173 端口）
 *       node dev-server.js 8080
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'app');
const PORT = Number(process.argv[2]) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.woff2': 'font/woff2',
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  if (body === undefined) res.end();
  else res.end(body);
}

http.createServer(function (req, res) {
  var urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  var filePath = path.resolve(ROOT, '.' + urlPath);
  // 防目录穿越：解析后必须仍在 app/ 内
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, '403 Forbidden');
  }

  fs.stat(filePath, function (err, stat) {
    if (err || !stat.isFile()) {
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, '404 Not Found');
    }

    var headers = {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Accept-Ranges': 'bytes',
    };

    var range = req.headers.range;
    var m = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      var start = m[1] ? Number(m[1]) : 0;
      var end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
      if (start >= stat.size || start > end) {
        return send(res, 416, { 'Content-Range': 'bytes */' + stat.size });
      }
      headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + stat.size;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      return fs.createReadStream(filePath, { start: start, end: end }).pipe(res);
    }

    headers['Content-Length'] = stat.size;
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}).listen(PORT, '127.0.0.1', function () {
  console.log('Aura 开发服务器（已禁用缓存）→ http://127.0.0.1:' + PORT + '/index.html');
  console.log('服务目录: ' + ROOT);
});
