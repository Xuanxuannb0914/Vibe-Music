/**
 * Aura · 主题引擎
 *
 * 把「设置」里的偏好实时落到 CSS 变量上。所有视觉可调项都通过这里生效，
 * 因此新增一个外观选项 = 在 prefs 里加字段 + 在这里写一行映射。
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;
  var root = document.documentElement;

  /** 预设强调色（用户手动指定时使用） */
  var ACCENT_PRESETS = [
    { id: 'coral', name: '珊瑚', rgb: [255, 55, 95] },
    { id: 'amber', name: '琥珀', rgb: [255, 179, 64] },
    { id: 'mint', name: '薄荷', rgb: [48, 209, 88] },
    { id: 'azure', name: '湖蓝', rgb: [10, 132, 255] },
    { id: 'iris', name: '鸢尾', rgb: [125, 95, 255] },
    { id: 'magenta', name: '品红', rgb: [255, 45, 146] },
    { id: 'lime', name: '青柠', rgb: [190, 240, 60] },
    { id: 'graphite', name: '石墨', rgb: [142, 142, 147] },
  ];

  var DENSITY = {
    compact: { rowH: '46px', cardGap: '14px' },
    cozy: { rowH: '54px', cardGap: '20px' },
    spacious: { rowH: '66px', cardGap: '28px' },
  };

  function setVar(name, value) {
    root.style.setProperty(name, value);
  }

  function rgbTriplet(rgb) {
    return rgb[0] + ' ' + rgb[1] + ' ' + rgb[2];
  }

  /** 相对亮度（WCAG），用于决定强调色上放黑字还是白字 */
  function relativeLuminance(rgb) {
    var channels = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  /** 应用强调色（同时决定其上的文字颜色） */
  function applyAccent(rgb) {
    if (!rgb) return;
    setVar('--accent', util.rgbToHex(rgb));
    setVar('--accent-rgb', rgbTriplet(rgb));
    setVar('--accent-contrast', relativeLuminance(rgb) > 0.55 ? '#0a0a0d' : '#ffffff');
  }

  /** 应用封面环境光的两团主色 */
  function applyCoverColors(primary, secondary) {
    if (primary) setVar('--cover-a-rgb', rgbTriplet(primary));
    if (secondary) setVar('--cover-b-rgb', rgbTriplet(secondary));
  }

  /**
   * 把整套偏好写入 DOM
   * @param {object} prefs
   */
  function apply(prefs) {
    /* 明暗主题 */
    root.setAttribute('data-theme', prefs.theme === 'light' ? 'light' : 'dark');

    /* 玻璃拟态 */
    root.setAttribute('data-glass', prefs.glass ? 'on' : 'off');
    setVar('--glass-blur', (prefs.glass ? prefs.glassBlur : 0) + 'px');

    /* 环境光 */
    root.setAttribute('data-glow', prefs.glow ? 'on' : 'off');
    setVar('--glow-strength', String(prefs.glow ? prefs.glowStrength : 0.1));
    setVar('--grain-strength', String(prefs.grain));

    /* 几何与字号 */
    setVar('--radius-scale', String(prefs.radiusScale));
    setVar('--font-scale', String(prefs.fontScale));

    /* 行密度 */
    var density = DENSITY[prefs.density] || DENSITY.cozy;
    setVar('--row-h', density.rowH);
    setVar('--card-gap', density.cardGap);

    /* 强调色：手动模式直接落地；封面模式由 applyCoverColors 驱动 */
    if (prefs.accentMode === 'manual') {
      var preset = ACCENT_PRESETS.filter(function (p) { return '#' + util.rgbToHex(p.rgb).slice(1) === prefs.accent; })[0];
      applyAccent(preset ? preset.rgb : util.toRgb(prefs.accent) || ACCENT_PRESETS[0].rgb);
    }
  }

  /** 依据当前偏好决定强调色来源：手动固定色 或 封面提取色 */
  function resolveAccent(prefs, coverPrimary) {
    if (prefs.accentMode === 'manual') {
      var preset = ACCENT_PRESETS.filter(function (p) {
        return '#' + util.rgbToHex(p.rgb).slice(1) === prefs.accent;
      })[0];
      return preset ? preset.rgb : (util.toRgb(prefs.accent) || ACCENT_PRESETS[0].rgb);
    }
    return coverPrimary || ACCENT_PRESETS[0].rgb;
  }

  Aura.theme = {
    apply: apply,
    applyAccent: applyAccent,
    applyCoverColors: applyCoverColors,
    resolveAccent: resolveAccent,
    presets: ACCENT_PRESETS,
    densityMap: DENSITY,
  };
})(window.Aura = window.Aura || {});
