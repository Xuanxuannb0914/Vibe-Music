/**
 * Aura · 通用工具
 */
(function (Aura) {
  'use strict';

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /** 秒 → m:ss */
  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var total = Math.floor(seconds);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /** 秒 → 1小时23分 这类自然语言时长 */
  function formatDurationLong(seconds) {
    var total = Math.floor(seconds || 0);
    var h = Math.floor(total / 3600);
    var m = Math.round((total % 3600) / 60);
    if (h > 0) return h + ' 小时 ' + m + ' 分';
    return m + ' 分钟';
  }

  /** 大数字 → 128.3万 / 1.2亿 */
  function formatCount(n) {
    n = Number(n) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + ' 亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + ' 万';
    return String(n);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 把 'rgb(255,55,95)' / '#ff375f' 统一转成 [r,g,b] */
  function toRgb(color) {
    if (!color) return null;
    var m = String(color).match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    var hex = String(color).trim().replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    if (hex.length !== 6 || /[^0-9a-f]/i.test(hex)) return null;
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(function (v) {
      var h = clamp(Math.round(v), 0, 255).toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('');
  }

  function withAlpha(rgb, alpha) {
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')';
  }

  /* ---------- DOM ---------- */

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'class') node.className = attrs[key];
        else if (key === 'dataset') Object.assign(node.dataset, attrs[key]);
        else if (key.indexOf('on') === 0 && typeof attrs[key] === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), attrs[key]);
        } else if (attrs[key] != null) node.setAttribute(key, attrs[key]);
      });
    }
    if (html != null) node.innerHTML = html;
    return node;
  }

  /** 事件委托 */
  function delegate(root, eventName, selector, handler) {
    root.addEventListener(eventName, function (event) {
      var target = event.target.closest(selector);
      if (target && root.contains(target)) handler(event, target);
    });
  }

  /** 把 duration(秒) 转成毫秒安全的数字 */
  function toSeconds(value) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) return 0;
    return n;
  }

  Aura.util = {
    delay: delay,
    formatTime: formatTime,
    formatDurationLong: formatDurationLong,
    formatCount: formatCount,
    clamp: clamp,
    uid: uid,
    debounce: debounce,
    escapeHtml: escapeHtml,
    toRgb: toRgb,
    rgbToHex: rgbToHex,
    withAlpha: withAlpha,
    qs: qs,
    qsa: qsa,
    el: el,
    delegate: delegate,
    toSeconds: toSeconds,
  };
})(window.Aura = window.Aura || {});
