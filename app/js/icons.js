/**
 * Aura · 图标系统
 *
 * 全站唯一图标来源，统一 24×24 网格、统一线宽与圆角端点，颜色跟随 currentColor。
 * 采用内联 SVG 而非 CDN，保证「零外部依赖、可离线打开」这一交付硬要求。
 * 严禁使用 emoji 充当图标。
 *
 * 用法：Aura.icon('play', { size: 20, cls: 'foo' })
 */
(function (Aura) {
  'use strict';

  /** 线性图标（描边绘制） */
  var STROKE_ICONS = {
    /* —— 导航与视图 —— */
    home: '<path d="M3 10.6 12 3.2l9 7.4"/><path d="M5.6 9.4V20a1 1 0 0 0 1 1H10v-5.6h4V21h3.4a1 1 0 0 0 1-1V9.4"/>',
    library: '<path d="M4 3h3v18H4z"/><path d="M9.6 3h3v18h-3z"/><path d="m15.3 4.3 2.9-.8 4.4 17.2-2.9.8z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20.2 20.2-3.9-3.9"/>',
    music: '<circle cx="8" cy="18" r="4"/><path d="M12 18V2l7 4"/>',
    disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.4"/>',
    headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
    mic: '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.4 2"/>',
    history: '<path d="M3.2 12a9 9 0 1 0 2.9-6.6L3 8.2"/><path d="M3 3.4v4.8h4.8"/><path d="M12 7.2V12l3.4 2"/>',
    heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    pin: '<path d="M12 17.5V22"/><path d="M9 10.8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4.8l1.7 2a1 1 0 0 1-.8 1.6H8.1a1 1 0 0 1-.8-1.6Z"/>',
    star: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9Z"/>',

    /* —— 播放控制 —— */
    shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/>',
    repeat: '<path d="m17 2.5 3.5 3.5L17 9.5"/><path d="M3.5 11.5V11a4 4 0 0 1 4-4h13"/><path d="m7 21.5-3.5-3.5L7 14.5"/><path d="M20.5 12.5V13a4 4 0 0 1-4 4h-13"/>',
    'repeat-one': '<path d="m17 2.5 3.5 3.5L17 9.5"/><path d="M3.5 11.5V11a4 4 0 0 1 4-4h13"/><path d="m7 21.5-3.5-3.5L7 14.5"/><path d="M20.5 12.5V13a4 4 0 0 1-4 4h-13"/><path d="M11.4 10.2h1.2v4"/>',
    'volume-high': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2"/>',
    'volume-low': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
    'volume-mute': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
    'list-music': '<path d="M21 15V6"/><circle cx="18.5" cy="15.5" r="2.5"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/>',
    queue: '<path d="M3 6h13"/><path d="M3 12h9"/><path d="M3 18h9"/><path d="M17 13.5V6l4 1.5"/><circle cx="15.5" cy="17" r="2.5"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2.4"/>',
    cast: '<path d="M2 16.5a5 5 0 0 1 5 5"/><path d="M2 12.5a9 9 0 0 1 9 9"/><path d="M2 8.5a13 13 0 0 1 13 13"/><path d="M6.5 20H19a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v2"/>',

    /* —— 界面操作 —— */
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6.5 9.2 17.3 4 12.1"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8.4 12.4 2.5 2.5 4.7-5.2"/>',
    'alert-triangle': '<path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9.2v4"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16.2v-4.4"/><path d="M12 8h.01"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-up': '<path d="m18 15-6-6-6 6"/>',
    'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    'arrow-up-right': '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
    'external-link': '<path d="M15 3h6v6"/><path d="M10.5 13.5 21 3"/><path d="M18 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5.5"/>',
    trash: '<path d="M3.5 6h17"/><path d="M18.5 6v14a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6"/><path d="M8.5 6V4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    pencil: '<path d="M17 3.5a2.6 2.6 0 1 1 3.7 3.7L7.4 20.5 2 22l1.5-5.4Z"/><path d="m15.2 5.3 3.5 3.5"/>',
    'folder-open': '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.3 10H20a2 2 0 0 1 1.9 2.5l-1.5 6a2 2 0 0 1-2 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2"/>',
    refresh: '<path d="M3.2 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3.4v4.8h-4.8"/><path d="M20.8 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 20.6v-4.8h4.8"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7.2 10.4 4.8 4.8 4.8-4.8"/><path d="M12 15.2V3.2"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" x2="15.4" y1="10.5" y2="6.5"/><line x1="8.6" x2="15.4" y1="13.5" y2="17.5"/>',
    copy: '<rect width="13" height="13" x="9" y="9" rx="2.4"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    filter: '<path d="M21.5 3.5h-19l7.5 9v6.5l4 2.5v-9Z"/>',
    sort: '<path d="m3.5 16.5 4 4 4-4"/><path d="M7.5 20.5V3.5"/><path d="m20.5 7.5-4-4-4 4"/><path d="M16.5 3.5v17"/>',
    maximize: '<path d="M8.5 3.5H5.5a2 2 0 0 0-2 2v3"/><path d="M20.5 8.5v-3a2 2 0 0 0-2-2h-3"/><path d="M3.5 15.5v3a2 2 0 0 0 2 2h3"/><path d="M15.5 20.5h3a2 2 0 0 0 2-2v-3"/>',
    minimize: '<path d="M8.5 3.5v3a2 2 0 0 1-2 2h-3"/><path d="M20.5 8.5h-3a2 2 0 0 1-2-2v-3"/><path d="M3.5 15.5h3a2 2 0 0 1 2 2v3"/><path d="M15.5 20.5v-3a2 2 0 0 1 2-2h3"/>',
    'panel-left': '<rect width="18" height="18" x="3" y="3" rx="2.4"/><path d="M9.5 3v18"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c6.4 0 10 7 10 7a18.5 18.5 0 0 1-2.4 3.5"/><path d="M6.6 6.6A18.4 18.4 0 0 0 2 11s3.6 7 10 7a10.8 10.8 0 0 0 5.4-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><line x1="2" x2="22" y1="2" y2="22"/>',
    'grip-vertical': '<circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
    'loader': '<path d="M12 2.5v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h3.5"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v3.5"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2.5 12H6"/><path d="m4.9 4.9 2.9 2.9"/>',
    'circle-dot': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/>',

    /* —— 设置与调音 —— */
    sliders: '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
    equalizer: '<path d="M5 21v-8"/><path d="M5 9V3"/><path d="M12 21v-5"/><path d="M12 12V3"/><path d="M19 21v-9"/><path d="M19 8V3"/><circle cx="5" cy="11" r="2"/><circle cx="12" cy="14" r="2"/><circle cx="19" cy="10" r="2"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1.4"/><circle cx="17.5" cy="10.5" r="1.4"/><circle cx="8.5" cy="7.5" r="1.4"/><circle cx="6.5" cy="12.5" r="1.4"/><path d="M12 2.5a9.5 9.5 0 1 0 0 19 2 2 0 0 0 1.6-3.2 2 2 0 0 1 1.6-3.2h2.3a4 4 0 0 0 4-4 9.5 9.5 0 0 0-9.5-8.6Z"/>',
    sparkles: '<path d="m12 3 1.9 4.8L18.7 9.7l-4.8 1.9L12 16.4l-1.9-4.8L5.3 9.7l4.8-1.9Z"/><path d="m19 15 .8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z"/>',
    'layout-grid': '<rect width="7" height="7" x="3" y="3" rx="1.6"/><rect width="7" height="7" x="14" y="3" rx="1.6"/><rect width="7" height="7" x="14" y="14" rx="1.6"/><rect width="7" height="7" x="3" y="14" rx="1.6"/>',
    list: '<line x1="8.5" x2="21" y1="6" y2="6"/><line x1="8.5" x2="21" y1="12" y2="12"/><line x1="8.5" x2="21" y1="18" y2="18"/><line x1="3.2" x2="3.3" y1="6" y2="6"/><line x1="3.2" x2="3.3" y1="12" y2="12"/><line x1="3.2" x2="3.3" y1="18" y2="18"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2.4"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.4"/><path d="M12 19.6V22"/><path d="m4.9 4.9 1.7 1.7"/><path d="m17.4 17.4 1.7 1.7"/><path d="M2 12h2.4"/><path d="M19.6 12H22"/><path d="m6.6 17.4-1.7 1.7"/><path d="m19.1 4.9-1.7 1.7"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
    wand: '<path d="m21.6 3.6-1.3-1.3a1.2 1.2 0 0 0-1.7 0L2.4 18.6a1.2 1.2 0 0 0 0 1.7l1.3 1.3a1.2 1.2 0 0 0 1.7 0L21.6 5.4a1.2 1.2 0 0 0 0-1.8Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
    zap: '<path d="M13 2 3 14h8l-1 8 10-12h-8Z"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    'audio-lines': '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
    waves: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1"/><path d="M2 12c.6.5 1.2 1 2.5 1C7 13 7 11 9.5 11c2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1"/><path d="M2 18c.6.5 1.2 1 2.5 1C7 19 7 17 9.5 17c2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1"/>',
    'bar-chart': '<line x1="6" x2="6" y1="20" y2="15"/><line x1="12" x2="12" y1="20" y2="8"/><line x1="18" x2="18" y1="20" y2="4"/>',
    'trending': '<path d="m22 7-8.5 8.5-4-4L2 19"/><path d="M16 7h6v6"/>',

    /* —— 数据源 —— */
    plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.6l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.6l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/>',
    cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .4-9 6 6 0 0 0-11.6-1.6A4 4 0 0 0 6.5 19Z"/>',
    'cloud-off': '<path d="M22 17.5A4.5 4.5 0 0 0 18 10h-1.3A6 6 0 0 0 7 6.3"/><path d="M5.8 8.6A4 4 0 0 0 6.5 19h10"/><line x1="2" x2="22" y1="2" y2="22"/>',
    server: '<rect width="20" height="8" x="2" y="2" rx="2.4"/><rect width="20" height="8" x="2" y="14" rx="2.4"/><line x1="6" x2="6.1" y1="6" y2="6"/><line x1="6" x2="6.1" y1="18" y2="18"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
    terminal: '<path d="m4.5 17 5.5-5-5.5-5"/><path d="M12 19h7.5"/>',
    key: '<circle cx="7.5" cy="15.5" r="4"/><path d="m10.5 12.5 9-9"/><path d="m16 7 2.5 2.5"/><path d="m19 4 2 2"/>',
    shield: '<path d="M12 22s8-3.6 8-10V5.5l-8-3-8 3V12c0 6.4 8 10 8 10Z"/>',
  };

  /** 实心图标（填充绘制，用于播放键等需要「实感」的位置） */
  var FILL_ICONS = {
    play: '<path d="M8 5.14v13.72a1 1 0 0 0 1.52.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z"/>',
    pause: '<rect x="6.2" y="4.2" width="3.9" height="15.6" rx="1.3"/><rect x="13.9" y="4.2" width="3.9" height="15.6" rx="1.3"/>',
    'skip-back': '<path d="M19.4 4.9v14.2a1 1 0 0 1-1.55.83L8.2 13.1a1 1 0 0 1 0-1.66l9.65-6.37a1 1 0 0 1 1.55.83Z"/><rect x="4.2" y="4.6" width="2.6" height="14.8" rx="1.2"/>',
    'skip-forward': '<path d="M4.6 4.9v14.2a1 1 0 0 0 1.55.83l9.65-6.37a1 1 0 0 0 0-1.66L6.15 4.07A1 1 0 0 0 4.6 4.9Z"/><rect x="17.2" y="4.6" width="2.6" height="14.8" rx="1.2"/>',
    'heart-filled': '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
    'more-horizontal': '<circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>',
    'more-vertical': '<circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="18.5" r="1.7"/>',
    'volume-filled': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>',
  };

  var FILLED = Object.keys(FILL_ICONS).reduce(function (acc, k) { acc[k] = true; return acc; }, {});

  /**
   * 生成图标 SVG 字符串
   * @param {string} name  图标名
   * @param {object} [opts] { size, stroke, cls, style }
   * @returns {string}
   */
  function icon(name, opts) {
    opts = opts || {};
    var inner = STROKE_ICONS[name] || FILL_ICONS[name];
    if (!inner) {
      // 未知图标名不应静默产出空白，用一个明确的占位方框暴露问题
      console.warn('[Aura.icons] 未知图标:', name);
      inner = '<rect x="4" y="4" width="16" height="16" rx="3"/>';
    }
    var isFilled = !!FILLED[name];
    var size = opts.size || 20;
    var stroke = opts.stroke != null ? opts.stroke : 1.75;
    var cls = opts.cls ? ' class="' + opts.cls + '"' : '';
    var style = opts.style ? ' style="' + opts.style + '"' : '';

    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"' + cls + style +
      ' fill="' + (isFilled ? 'currentColor' : 'none') + '"' +
      ' stroke="' + (isFilled ? 'none' : 'currentColor') + '"' +
      ' stroke-width="' + (isFilled ? 0 : stroke) + '"' +
      ' stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }

  function has(name) {
    return !!(STROKE_ICONS[name] || FILL_ICONS[name]);
  }

  /** 把已插入 DOM 的 [data-icon] 占位元素替换为真实 SVG（用于静态标记） */
  function hydrate(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-icon]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute('data-icon-ready') === '1') continue;
      el.innerHTML = icon(el.getAttribute('data-icon'), {
        size: Number(el.getAttribute('data-icon-size')) || 20,
        stroke: Number(el.getAttribute('data-icon-stroke')) || 1.75,
      });
      el.setAttribute('data-icon-ready', '1');
    }
  }

  Aura.icon = icon;
  Aura.icons = {
    stroke: Object.keys(STROKE_ICONS),
    filled: Object.keys(FILL_ICONS),
    has: has,
    hydrate: hydrate,
  };
})(window.Aura = window.Aura || {});
