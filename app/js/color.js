/**
 * Aura · 封面主色提取
 *
 * 「界面氛围随封面而变」是本应用的核心体验，因此这里需要从封面图里
 * 稳定地抽出 1 个可作强调色的主色 + 1 个用于环境光的副色。
 *
 * 流程：
 *   1. 用 crossOrigin=anonymous 加载图片（失败则说明该图不允许跨域读取像素）
 *   2. 缩到 44×44 后量化成颜色桶，按「出现频次 × 饱和度权重」打分
 *   3. 取最高分作主色、色相差异足够大的次高分作副色
 *   4. 主色再经一次「提饱和 + 归一亮度」，确保它能安全承载白色文字
 *
 * 全流程失败时退回「由曲目 id 派生的确定性调色板」，
 * 保证界面永远有配色，而不是变成一片灰。
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;
  var SAMPLE = 44;
  var cache = {};

  /* ---------- 色彩空间转换 ---------- */

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var h = 0;
    var l = (max + min) / 2;
    var d = max - min;
    var s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgb.map(function (v) { return Math.round((v + m) * 255); });
  }

  /**
   * 把任意颜色规范成「可安全承载白色文字」的强调色。
   * 饱和度设下限避免灰扑扑，亮度锁在中间区间保证对比度。
   */
  function toAccent(rgb) {
    var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    var h = hsl[0];
    var s = util.clamp(Math.max(hsl[1], 0.52), 0.52, 0.94);
    var l = util.clamp(hsl[2], 0.44, 0.6);
    return hslToRgb(h, s, l);
  }

  /** 环境光用的副色：色相偏移 + 提亮，与主色形成层次而不是重复 */
  function toAmbient(rgb, hueShift) {
    var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    var h = hsl[0] + (hueShift || 28);
    var s = util.clamp(hsl[1] * 1.05 + 0.08, 0.3, 0.95);
    var l = util.clamp(hsl[2] + 0.1, 0.35, 0.72);
    return hslToRgb(h, s, l);
  }

  /* ---------- 图片加载 ---------- */

  function loadImage(url, useCors) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      if (useCors) img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片加载失败')); };
      img.src = url;
    });
  }

  /* ---------- 量化与打分 ---------- */

  function quantize(data) {
    var buckets = {};
    var total = 0;

    for (var i = 0; i < data.length; i += 4) {
      var a = data[i + 3];
      if (a < 200) continue; // 忽略半透明像素

      var r = data[i];
      var g = data[i + 1];
      var b = data[i + 2];

      // 5 级量化（每通道 51 一档），兼顾精度与聚合度
      var key = ((r / 51) | 0) + ',' + ((g / 51) | 0) + ',' + ((b / 51) | 0);
      if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, n: 0 };
      var bucket = buckets[key];
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.n += 1;
      total += 1;
    }

    if (!total) return [];

    return Object.keys(buckets).map(function (key) {
      var bucket = buckets[key];
      var rgb = [Math.round(bucket.r / bucket.n), Math.round(bucket.g / bucket.n), Math.round(bucket.b / bucket.n)];
      var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      var share = bucket.n / total;

      // 打分：占比为主，饱和度加成，极端明暗降权（避免选到纯黑/纯白的边框像素）
      var lightnessPenalty = 1 - Math.abs(hsl[2] - 0.5) * 1.1;
      var score = share * (0.55 + hsl[1] * 1.7) * Math.max(0.12, lightnessPenalty);

      return { rgb: rgb, hsl: hsl, share: share, score: score };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  function hueDistance(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  /** 从候选桶里选出主色与副色 */
  function pickPalette(buckets) {
    if (!buckets.length) return null;

    var primary = buckets[0];

    // 副色：色相与主色相差 ≥ 40° 的最高分项；找不到就退化为主色的色相偏移
    var secondary = null;
    for (var i = 1; i < buckets.length; i++) {
      if (hueDistance(buckets[i].hsl[0], primary.hsl[0]) >= 40) {
        secondary = buckets[i];
        break;
      }
    }
    if (!secondary) {
      secondary = { rgb: toAmbient(primary.rgb, 40) };
    }

    return {
      primary: primary.rgb,
      secondary: secondary.rgb,
      palette: buckets.slice(0, 6).map(function (b) { return b.rgb; }),
    };
  }

  /* ---------- 确定性回退 ---------- */

  function hashString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /**
   * 由字符串派生一套稳定且好看的配色。
   * 用于：图片跨域不可读、加载失败、或纯占位场景。
   */
  function fromSeed(seed) {
    var hash = hashString(String(seed || 'aura'));
    var hue = hash % 360;
    var hue2 = (hue + 42 + (hash >> 8) % 60) % 360;
    var sat = 0.5 + ((hash >> 4) % 30) / 100;
    var light = 0.46 + ((hash >> 12) % 12) / 100;

    var primary = hslToRgb(hue, sat, light);
    var secondary = hslToRgb(hue2, util.clamp(sat + 0.06, 0, 0.95), util.clamp(light + 0.14, 0, 0.74));

    return {
      primary: primary,
      secondary: secondary,
      palette: [
        primary,
        secondary,
        hslToRgb((hue + 180) % 360, sat * 0.7, light + 0.2),
        hslToRgb(hue, sat * 0.35, 0.82),
      ],
      derived: true,
    };
  }

  /* ---------- 对外接口 ---------- */

  /**
   * 提取封面配色
   * @param {string} url 封面地址
   * @param {string} [seed] 回退用的稳定种子（建议传曲目 id）
   * @returns {Promise<{primary:number[], secondary:number[], palette:number[][], derived?:boolean}>}
   */
  function extract(url, seed) {
    var key = String(url || '') + '|' + String(seed || '');
    if (cache[key]) return Promise.resolve(cache[key]);

    if (!url) return Promise.resolve(fromSeed(seed));

    return loadImage(url, true)
      .then(function (img) {
        var canvas = document.createElement('canvas');
        canvas.width = SAMPLE;
        canvas.height = SAMPLE;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);

        var data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
        var palette = pickPalette(quantize(data));
        if (!palette) return fromSeed(seed);

        var result = {
          primary: toAccent(palette.primary),
          secondary: toAmbient(palette.secondary),
          palette: palette.palette.map(toAccent),
        };
        cache[key] = result;
        return result;
      })
      .catch(function () {
        // 图片不允许跨域读取（如部分第三方 CDN 未返回 CORS 头）→ 退回确定性配色
        var fallback = fromSeed(seed);
        cache[key] = fallback;
        return fallback;
      });
  }

  Aura.color = {
    extract: extract,
    fromSeed: fromSeed,
    toAccent: toAccent,
    toAmbient: toAmbient,
    rgbToHsl: rgbToHsl,
    hslToRgb: hslToRgb,
    clearCache: function () { cache = {}; },
  };
})(window.Aura = window.Aura || {});
