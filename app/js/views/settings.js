/**
 * Aura · 设置
 *
 * 「高自由度」这一主张的落点：界面上几乎每一个视觉与听觉参数都能实时调整，
 * 且全部写入偏好后持久化。左侧分组导航 + 右侧面板，改动即时生效、无需保存按钮。
 *
 * 约定：每个可调项都是一个 .setting-row，控件只声明 data-*，
 * 真正的写状态逻辑集中在 app.js 的 pref-* 通用动作里，本文件只负责「长什么样」。
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;
  var ui = Aura.ui;
  var store = Aura.store;

  var SECTIONS = [
    { id: 'appearance', name: '外观', icon: 'palette' },
    { id: 'playback', name: '正在播放', icon: 'headphones' },
    { id: 'audio', name: '播放内核', icon: 'equalizer' },
    { id: 'visual', name: '可视化', icon: 'activity' },
    { id: 'source', name: '数据源', icon: 'plug' },
    { id: 'about', name: '关于', icon: 'info' },
  ];

  var EQ_PRESETS = [
    { id: 'flat', name: '平直', bands: [0, 0, 0, 0, 0] },
    { id: 'warm', name: '温暖', bands: [3.5, 2, 0, -1, -2] },
    { id: 'bright', name: '明亮', bands: [-2, -1, 1, 3, 4.5] },
    { id: 'vocal', name: '人声', bands: [-2.5, 0, 3, 2, 0.5] },
    { id: 'bass', name: '低频增强', bands: [6, 4, 0.5, -1, -2] },
    { id: 'night', name: '夜间', bands: [-3, -2, 0, 2, 1] },
  ];

  var EQ_FREQS = ['60Hz', '230Hz', '910Hz', '3.6kHz', '14kHz'];

  var VIZ_STYLES = [
    { id: 'bars', name: '柱状' },
    { id: 'wave', name: '波形' },
    { id: 'radial', name: '环形' },
    { id: 'particles', name: '粒子' },
  ];

  var LAYOUTS = [
    { id: 'immersive', name: '沉浸', desc: '封面居中' },
    { id: 'split', name: '分栏', desc: '左封面右歌词' },
    { id: 'list', name: '列表', desc: '歌词 + 队列' },
    { id: 'canvas', name: '画布', desc: '频谱铺满' },
  ];

  var panelRef = null;
  var qqSaveTimer = null;

  function prefs() {
    return store.state.prefs;
  }

  /* ------------------------------------------------------------------ *
   * 控件
   * ------------------------------------------------------------------ */

  function switchCtl(path, value, disabled) {
    return '<button type="button" class="switch" role="switch" aria-checked="' + (!!value) + '"' +
      ' data-act="pref-toggle" data-path="' + path + '" aria-label="切换"' + (disabled ? ' disabled' : '') + '></button>';
  }

  function valueText(path, value) {
    var n = Number(value);
    switch (path) {
      case 'audio.speed': return n.toFixed(2) + '×';
      case 'audio.gain': return n.toFixed(2) + '×';
      case 'audio.stereoWidth': return n.toFixed(2) + '×';
      case 'audio.fadeIn':
      case 'audio.fadeOut':
      case 'audio.crossfade': return Math.round(n) + ' ms';
      case 'audio.reverb': return Math.round(n * 100) + '%';
      case 'glassBlur': return Math.round(n) + ' px';
      case 'glowStrength': return Math.round(n * 100) + '%';
      case 'grain': return n.toFixed(3);
      case 'radiusScale':
      case 'fontScale':
      case 'lyricFontScale':
      case 'vizSensitivity': return n.toFixed(2) + '×';
      default: return String(n);
    }
  }

  function rangeCtl(path, value, opts) {
    opts = opts || {};
    return '<div class="setting-row__control">' +
      '<input type="range" class="slider slider--thin" style="width:' + (opts.width || 160) + 'px"' +
        ' min="' + opts.min + '" max="' + opts.max + '" step="' + (opts.step || 0.01) + '"' +
        ' value="' + value + '" data-input="pref-range" data-path="' + path + '"' +
        ' aria-label="' + ui.esc(opts.label || path) + '">' +
      '<span class="setting-value" data-value-for="' + path + '">' + valueText(path, value) + '</span>' +
    '</div>';
  }

  function selectCtl(path, value, options) {
    return '<select class="select" data-change="pref-select" data-path="' + path + '" aria-label="' + ui.esc(path) + '">' +
      options.map(function (option) {
        return '<option value="' + ui.esc(option.value) + '"' +
          (String(option.value) === String(value) ? ' selected' : '') + '>' + ui.esc(option.label) + '</option>';
      }).join('') +
    '</select>';
  }

  function row(name, desc, control, stacked) {
    return '<div class="setting-row' + (stacked ? ' setting-row--stacked' : '') + '">' +
      '<div class="setting-row__label">' +
        '<div class="setting-row__name">' + ui.esc(name) + '</div>' +
        (desc ? '<div class="setting-row__desc">' + ui.esc(desc) + '</div>' : '') +
      '</div>' +
      '<div class="setting-row__control">' + control + '</div>' +
    '</div>';
  }

  function section(title, desc, rows) {
    return '<section class="settings-section">' +
      '<div class="settings-section__title">' + ui.esc(title) + '</div>' +
      (desc ? '<div class="settings-section__desc">' + ui.esc(desc) + '</div>' : '') +
      rows +
    '</section>';
  }

  /* ------------------------------------------------------------------ *
   * 外观
   * ------------------------------------------------------------------ */

  function accentSwatches() {
    var p = prefs();
    var auto = '<button type="button" class="swatch swatch--auto' + (p.accentMode === 'cover' ? ' is-active' : '') + '"' +
      ' data-act="accent-pick" data-accent="cover" data-tip="跟随封面" aria-label="跟随封面">' +
      Aura.icon('wand', { size: 13 }) + '</button>';

    var manual = Aura.theme.presets.map(function (preset) {
      var hex = '#' + util.rgbToHex(preset.rgb).slice(1);
      var active = p.accentMode === 'manual' && p.accent.toLowerCase() === hex.toLowerCase();
      return '<button type="button" class="swatch' + (active ? ' is-active' : '') + '"' +
        ' style="background:' + hex + '" data-act="accent-pick" data-accent="' + hex + '"' +
        ' data-tip="' + ui.esc(preset.name) + '" aria-label="' + ui.esc(preset.name) + '"></button>';
    }).join('');

    return '<div class="swatches">' + auto + manual + '</div>';
  }

  function appearanceSection() {
    var p = prefs();
    return section('外观', '所有改动即时生效，并保存在本机。',
      row('主题', '深色适合夜间聆听，浅色偏纸感编辑风。',
        '<div class="segmented">' +
          '<button type="button" class="segmented__item' + (p.theme === 'dark' ? ' is-active' : '') + '"' +
            ' data-act="pref-set" data-path="theme" data-value="dark">' + Aura.icon('moon', { size: 14 }) + '<span>深色</span></button>' +
          '<button type="button" class="segmented__item' + (p.theme === 'light' ? ' is-active' : '') + '"' +
            ' data-act="pref-set" data-path="theme" data-value="light">' + Aura.icon('sun', { size: 14 }) + '<span>浅色</span></button>' +
        '</div>') +
      row('强调色', '跟随封面时，颜色会随每首歌的封面自动变化。', accentSwatches()) +
      row('毛玻璃', '关闭后改用不透明面板，低性能设备更流畅。', switchCtl('glass', p.glass)) +
      row('毛玻璃强度', null, rangeCtl('glassBlur', p.glassBlur, { min: 0, max: 60, step: 1, width: 150 })) +
      row('环境光', '背景辉光由当前封面主色驱动。', switchCtl('glow', p.glow)) +
      row('环境光强度', null, rangeCtl('glowStrength', p.glowStrength, { min: 0, max: 1.5, step: 0.05, width: 150 })) +
      row('胶片颗粒', '轻微噪点，减少大面积渐变的色带。', rangeCtl('grain', p.grain, { min: 0, max: 0.12, step: 0.005, width: 150 })) +
      row('圆角', null, rangeCtl('radiusScale', p.radiusScale, { min: 0.4, max: 1.6, step: 0.05, width: 150 })) +
      row('字号', null, rangeCtl('fontScale', p.fontScale, { min: 0.85, max: 1.2, step: 0.01, width: 150 })) +
      row('列表密度', '影响曲目行高与卡片间距。',
        selectCtl('density', p.density, [
          { value: 'compact', label: '紧凑' },
          { value: 'cozy', label: '舒适' },
          { value: 'spacious', label: '宽松' },
        ]))
      );
  }

  /* ------------------------------------------------------------------ *
   * 正在播放
   * ------------------------------------------------------------------ */

  function layoutThumb(id) {
    var cols, rows, cells;
    if (id === 'split') { cols = '1fr 1fr'; rows = '1fr'; cells = 2; }
    else if (id === 'list') { cols = '34px 1fr'; rows = '1fr 1fr'; cells = 3; }
    else if (id === 'canvas') { cols = '1fr'; rows = '1fr'; cells = 1; }
    else { cols = '1fr'; rows = '1fr'; cells = 1; }
    var blocks = '';
    for (var i = 0; i < cells; i++) {
      blocks += '<div class="lt-block"' + (id === 'list' && i === 0 ? ' style="grid-row:span 2"' : '') + '></div>';
    }
    return '<div class="layout-option__thumb" style="grid-template-columns:' + cols +
      ';grid-template-rows:' + rows + '">' + blocks + '</div>';
  }

  function layoutPicker() {
    var active = prefs().npLayout;
    return '<div class="layout-picker">' + LAYOUTS.map(function (layout) {
      return '<button type="button" class="layout-option' + (layout.id === active ? ' is-active' : '') + '"' +
        ' data-act="layout-pick" data-layout="' + layout.id + '" aria-pressed="' + (layout.id === active) + '">' +
        layoutThumb(layout.id) +
        '<div><div class="layout-option__name">' + layout.name + '</div>' +
        '<div class="layout-option__desc">' + layout.desc + '</div></div>' +
      '</button>';
    }).join('') + '</div>';
  }

  function playbackSection() {
    var p = prefs();
    return section('正在播放', '决定「正在播放」页的排布与歌词呈现方式。',
      row('布局', '同一份内容，四种排布。', layoutPicker(), true) +
      row('显示翻译歌词', '当歌词含翻译轨时，在原文下方显示译文。', switchCtl('showTranslation', p.showTranslation)) +
      row('歌词字号', null, rangeCtl('lyricFontScale', p.lyricFontScale, { min: 0.85, max: 1.5, step: 0.05, width: 150 }))
    );
  }

  /* ------------------------------------------------------------------ *
   * 播放内核
   * ------------------------------------------------------------------ */

  function eqPresets() {
    var current = prefs().audio.eqPreset;
    return '<div class="eq__presets">' + EQ_PRESETS.map(function (preset) {
      return '<button type="button" class="chip' + (preset.id === current ? ' is-active' : '') + '"' +
        ' data-act="eq-preset" data-preset="' + preset.id + '">' + preset.name + '</button>';
    }).join('') + '</div>';
  }

  function eqBoard() {
    var bands = prefs().audio.eq || [0, 0, 0, 0, 0];
    return '<div class="eq">' + bands.map(function (gain, index) {
      return '<div class="eq__band">' +
        '<div class="eq__value" data-value-for="eq.' + index + '">' +
          (gain > 0 ? '+' : '') + Number(gain).toFixed(1) + '</div>' +
        '<div class="eq__slider-wrap">' +
          '<input type="range" class="slider eq__slider" min="-12" max="12" step="0.5" value="' + gain + '"' +
            ' data-input="eq-band" data-index="' + index + '" aria-label="' + EQ_FREQS[index] + ' 增益">' +
        '</div>' +
        '<div class="eq__freq">' + EQ_FREQS[index] + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function audioSection() {
    var a = prefs().audio;
    return section('播放内核', '这些参数直接作用于 Web Audio 处理链，播放中调整也能立刻听到。',
      row('播放速度', null, rangeCtl('audio.speed', a.speed, { min: 0.5, max: 2, step: 0.05, width: 150 })) +
      row('输出增益', '在系统音量之外再放大或衰减。', rangeCtl('audio.gain', a.gain, { min: 0.5, max: 2, step: 0.05, width: 150 })) +
      row('淡入时长', null, rangeCtl('audio.fadeIn', a.fadeIn, { min: 0, max: 2000, step: 50, width: 150 })) +
      row('淡出时长', null, rangeCtl('audio.fadeOut', a.fadeOut, { min: 0, max: 2000, step: 50, width: 150 })) +
      row('交叉淡化', '切歌时前后两首的重叠时长，0 表示关闭。', rangeCtl('audio.crossfade', a.crossfade, { min: 0, max: 2000, step: 50, width: 150 })) +
      row('空间感', '混响湿度，让声音更「有房间」。', rangeCtl('audio.reverb', a.reverb, { min: 0, max: 1, step: 0.05, width: 150 })) +
      row('立体声宽度', '0 = 单声道，2 = 极度展开。', rangeCtl('audio.stereoWidth', a.stereoWidth, { min: 0, max: 2, step: 0.05, width: 150 })) +
      row('均衡器', '五段参数均衡，±12 dB。', eqPresets() + eqBoard(), true)
    );
  }

  /* ------------------------------------------------------------------ *
   * 可视化
   * ------------------------------------------------------------------ */

  function stylePreview(id) {
    if (id === 'wave') {
      return '<svg class="viz-style__preview" viewBox="0 0 42 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
        '<path d="M1 13c4-9 7 9 11 0s7-9 11 0 7 9 11 0 5-5 7-3"/></svg>';
    }
    if (id === 'radial') {
      return '<svg class="viz-style__preview" viewBox="0 0 42 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' +
        '<circle cx="21" cy="13" r="4"/>' +
        '<path d="M21 2v4M21 20v4M10 13h4M28 13h4M13 5l3 3M29 5l-3 3M13 21l3-3M29 21l-3-3"/></svg>';
    }
    if (id === 'particles') {
      return '<svg class="viz-style__preview" viewBox="0 0 42 26" fill="currentColor">' +
        '<circle cx="7" cy="17" r="1.8"/><circle cx="15" cy="10" r="1.4"/><circle cx="21" cy="18" r="2.1"/>' +
        '<circle cx="28" cy="8" r="1.5"/><circle cx="35" cy="15" r="1.9"/><circle cx="12" cy="22" r="1.1"/>' +
        '<circle cx="31" cy="21" r="1.3"/></svg>';
    }
    return '<svg class="viz-style__preview" viewBox="0 0 42 26" fill="currentColor">' +
      '<rect x="2" y="14" width="4" height="10" rx="2"/><rect x="9" y="8" width="4" height="16" rx="2"/>' +
      '<rect x="16" y="4" width="4" height="20" rx="2"/><rect x="23" y="11" width="4" height="13" rx="2"/>' +
      '<rect x="30" y="6" width="4" height="18" rx="2"/><rect x="37" y="15" width="4" height="9" rx="2"/></svg>';
  }

  function vizPicker() {
    var active = prefs().vizStyle;
    return '<div class="viz-styles">' + VIZ_STYLES.map(function (style) {
      return '<button type="button" class="viz-style' + (style.id === active ? ' is-active' : '') + '"' +
        ' data-act="viz-style-pick" data-style="' + style.id + '" aria-pressed="' + (style.id === active) + '">' +
        stylePreview(style.id) + '<span>' + style.name + '</span>' +
      '</button>';
    }).join('') + '</div>';
  }

  function visualSection() {
    var p = prefs();
    return section('可视化', '频谱优先读取真实音频数据；无法读取时自动切换为合成动画，画面始终是活的。',
      row('启用可视化', '关闭可显著降低后台 CPU 占用。', switchCtl('vizEnabled', p.vizEnabled)) +
      row('频谱样式', null, vizPicker(), true) +
      row('灵敏度', null, rangeCtl('vizSensitivity', p.vizSensitivity, { min: 0.5, max: 2, step: 0.05, width: 150 }))
    );
  }

  /* ------------------------------------------------------------------ *
   * 数据源
   * ------------------------------------------------------------------ */

  function statusLine() {
    var source = Aura.api.getSource();
    return '<div class="source-status" data-source-status>' +
      '<span class="source-status__dot' + (source === 'mock' ? ' source-status__dot--on' : '') + '"></span>' +
      '<span>' + ui.esc(Aura.api.getSourceLabel()) +
      (source === 'qq' ? '（未测试）' : ' · 完全离线可用') + '</span>' +
    '</div>';
  }

  function sourceSection() {
    var source = Aura.api.getSource();
    var qq = Aura.api.getQqConfig();

    return section('数据源', '界面与数据源完全解耦：换一个适配器即可切换曲库，界面代码零改动。',
      row('当前数据源', null,
        '<div class="segmented">' +
          '<button type="button" class="segmented__item' + (source === 'mock' ? ' is-active' : '') + '"' +
            ' data-act="source-set" data-source="mock">' + Aura.icon('database', { size: 14 }) + '<span>演示数据</span></button>' +
          '<button type="button" class="segmented__item' + (source === 'qq' ? ' is-active' : '') + '"' +
            ' data-act="source-set" data-source="qq">' + Aura.icon('cloud', { size: 14 }) + '<span>QQ 音乐</span></button>' +
        '</div>') +
      row('连接状态', null, statusLine(), true) +
      (source === 'qq'
        ? row('接口地址', '第三方 QQ 音乐 API 服务，例如 http://localhost:3300',
            '<input type="text" class="input input--mono" style="width:260px" placeholder="http://localhost:3300"' +
              ' value="' + ui.esc(qq.apiBase) + '" data-input="qq-field" data-field="apiBase" aria-label="接口地址">') +
          row('登录 Cookie', '包含 uin 与 qqmusic_key。仅保存在本机，不会上传到任何第三方。',
            '<textarea class="input input--mono" rows="3" style="width:360px" placeholder="uin=…; qqmusic_key=…"' +
              ' data-input="qq-field" data-field="cookie" aria-label="登录 Cookie">' + ui.esc(qq.cookie) + '</textarea>', true) +
          row('音质', '取决于账号权限与音源是否提供。',
            selectCtl('qq.quality', qq.quality, [
              { value: '128', label: '128 kbps' },
              { value: '320', label: '320 kbps' },
              { value: 'flac', label: 'FLAC 无损' },
            ])) +
          row('连通性', '向接口地址发起一次健康检查。',
            '<button type="button" class="btn btn--secondary" data-act="test-connection">' +
              Aura.icon('plug', { size: 15 }) + '<span>测试连接</span></button>')
        : '') +
      (source === 'qq'
        ? '<div style="margin-top:var(--sp-4)">' + ui.notice('shield',
            '本项目不自带任何音乐版权内容。接入 QQ 音乐需自行部署第三方 API 服务并遵守其服务条款，' +
            '仅在个人学习与本地播放场景使用。', 'warning') + '</div>'
        : '')
    );
  }

  /* ------------------------------------------------------------------ *
   * 关于
   * ------------------------------------------------------------------ */

  function aboutSection() {
    var info = Aura.app && Aura.app.info ? Aura.app.info : { version: '0.1.0', runtime: '浏览器' };
    return section('关于', null,
      row('版本', null, '<span class="setting-value">' + ui.esc(info.version) + '</span>') +
      row('运行环境', null, '<span class="setting-value">' + ui.esc(info.runtime) + '</span>') +
      row('恢复默认设置', '将外观、内核、可视化全部偏好重置为出厂值，收藏不受影响。',
        '<button type="button" class="btn btn--danger" data-act="reset-prefs">' +
          Aura.icon('refresh', { size: 15 }) + '<span>恢复默认</span></button>')
    );
  }

  var RENDERERS = {
    appearance: appearanceSection,
    playback: playbackSection,
    audio: audioSection,
    visual: visualSection,
    source: sourceSection,
    about: aboutSection,
  };

  /* ------------------------------------------------------------------ *
   * 渲染
   * ------------------------------------------------------------------ */

  function paintNav() {
    var active = store.state.settingsSection;
    return SECTIONS.map(function (item) {
      return '<button type="button" class="settings__nav-item' + (item.id === active ? ' is-active' : '') + '"' +
        ' data-act="settings-section" data-section="' + item.id + '">' +
        Aura.icon(item.icon, { size: 16 }) + '<span>' + item.name + '</span>' +
      '</button>';
    }).join('');
  }

  function paintPanel() {
    if (!panelRef) return;
    var render = RENDERERS[store.state.settingsSection] || appearanceSection;
    panelRef.innerHTML = render();
    ui.syncAllSliders(panelRef);
  }

  function paintNavOnly() {
    var nav = util.qs('[data-settings-nav]');
    if (nav) nav.innerHTML = paintNav();
  }

  Aura.views = Aura.views || {};

  Aura.views.settings = {
    heading: '设置',
    eyebrow: '偏好',

    render: function (host) {
      host.innerHTML = '<div class="view"><div class="settings">' +
        '<nav class="settings__nav" data-settings-nav>' + paintNav() + '</nav>' +
        '<div class="settings__panel" data-settings-panel></div>' +
      '</div></div>';
      panelRef = util.qs('[data-settings-panel]', host);
      paintPanel();
    },

    onState: function (changed) {
      // 拖拽滑块时不能重建面板，否则指针下方的 DOM 会被替换、拖动中断。
      // 因此只要焦点还在面板内的表单控件上，就跳过重绘（控件本身已是最新值）。
      if (changed.indexOf('prefs') !== -1 && !isInteracting()) paintPanel();
    },

    leave: function () {
      panelRef = null;
    },
  };

  /* ------------------------------------------------------------------ *
   * 动作
   * ------------------------------------------------------------------ */

  function isInteracting() {
    var node = document.activeElement;
    if (!node || !panelRef || !panelRef.contains(node)) return false;
    return node.tagName === 'INPUT' || node.tagName === 'SELECT' || node.tagName === 'TEXTAREA';
  }

  Aura.ui.action('settings-section', function (dataset) {
    store.set({ settingsSection: dataset.section });
    paintNavOnly();
    paintPanel();
  });

  Aura.ui.action('accent-pick', function (dataset) {
    if (dataset.accent === 'cover') {
      store.setPrefs({ accentMode: 'cover' });
      Aura.player.refresh();
    } else {
      store.setPrefs({ accentMode: 'manual', accent: dataset.accent });
      Aura.player.refresh();
    }
  });

  Aura.ui.action('eq-preset', function (dataset) {
    var preset = EQ_PRESETS.filter(function (p) { return p.id === dataset.preset; })[0];
    if (!preset) return;
    store.setPrefs({ audio: { eqPreset: preset.id, eq: preset.bands.slice() } });
    Aura.player.refresh();
  });

  Aura.ui.action('eq-band', function (dataset, node) {
    var index = Number(dataset.index);
    var bands = (prefs().audio.eq || [0, 0, 0, 0, 0]).slice();
    bands[index] = Number(node.value);
    store.setPrefs({ audio: { eq: bands, eqPreset: 'custom' } });

    var label = util.qs('[data-value-for="eq.' + index + '"]', panelRef || document);
    if (label) label.textContent = (bands[index] > 0 ? '+' : '') + bands[index].toFixed(1);

    Aura.player.refresh();
  });

  Aura.ui.action('source-set', function (dataset) {
    Aura.api.setSource(dataset.source).then(function (source) {
      // 数据源变化后清空缓存，避免新旧曲库混在一起
      store.set({
        home: null, albums: null, artists: null, playlists: null, tracks: null,
        genres: null, searchResults: null, searchQuery: '', loadError: null,
      });
      ui.toast(source === 'qq' ? '已切换到 QQ 音乐数据源' : '已切换到内置演示数据', 'success');
      paintPanel();
    });
  });

  Aura.ui.action('qq-field', function (dataset, node) {
    var patch = {};
    patch[dataset.field] = node.value;
    clearTimeout(qqSaveTimer);
    qqSaveTimer = setTimeout(function () {
      Aura.api.setQqConfig(patch).then(function () {
        var status = util.qs('[data-source-status]');
        if (status && dataset.field === 'apiBase') {
          status.querySelector('span:last-child').textContent = Aura.api.getSourceLabel() + '（未测试）';
        }
      });
    }, 500);
  });

  Aura.ui.action('test-connection', function () {
    var status = util.qs('[data-source-status]');
    if (status) {
      status.innerHTML = '<span class="source-status__dot source-status__dot--pending"></span><span>正在测试连接…</span>';
    }
    Aura.api.testConnection().then(function (result) {
      if (status) {
        status.innerHTML = '<span class="source-status__dot source-status__dot--on"></span><span>' +
          ui.esc(result && result.message ? result.message : '连接正常') + '</span>';
      }
      ui.toast('连接正常', 'success');
    }).catch(function (err) {
      if (status) {
        status.innerHTML = '<span class="source-status__dot source-status__dot--off"></span><span>' +
          ui.esc(err.message) + '</span>';
      }
      ui.toast(err.message, 'danger');
    });
  });

  Aura.ui.action('reset-prefs', function () {
    ui.confirm({
      title: '恢复默认设置',
      desc: '外观、播放内核与可视化偏好都会回到出厂值。收藏与播放队列不受影响。',
      confirmText: '恢复默认',
      danger: true,
      onConfirm: function () {
        store.resetPrefs();
        Aura.theme.apply(store.state.prefs);
        Aura.player.refresh();
        paintPanel();
        ui.toast('已恢复默认设置', 'success');
      },
    });
  });

  Aura.views.settings.valueText = valueText;
})(window.Aura = window.Aura || {});
