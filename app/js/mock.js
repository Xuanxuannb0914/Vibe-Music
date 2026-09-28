/**
 * Aura · 内置演示数据（唯一数据源）
 *
 * 全部为虚构艺人、专辑与曲目，歌词均为本项目原创，不含任何第三方版权内容。
 * 页面只从这里读数据，不得在视图里散落硬编码。
 *
 * 曲目没有音频文件：音频引擎会为每首曲目程序化合成一段环境音
 * （以曲目 id 为种子，因此每首听感不同），播放 / 进度 / 跳转 / 频谱全部真实可用。
 * 接入 QQ 音乐后，同一套界面直接播放真实音源。
 */
(function (Aura) {
  'use strict';

  var COVER = 'assets/covers/';

  /* ================================================================== *
   * 艺人
   * ================================================================== */

  var artists = [
    {
      id: 'ar_01', name: '陈默', genres: ['氛围电子', '电子'], followers: 128400,
      bio: '长期以「高空视角」写作的氛围电子制作人，作品常被形容为「云层之上的独白」。',
    },
    {
      id: 'ar_02', name: 'Nora Vale', genres: ['新古典', '钢琴'], followers: 86300,
      bio: '定居哥本哈根的钢琴家，擅长用极少的音符留下极长的回声。',
    },
    {
      id: 'ar_03', name: '失控体', genres: ['Synthwave', '电子'], followers: 215700,
      bio: '把八十年代的霓虹与故障美学重新拼装的三人组合。',
    },
    {
      id: 'ar_04', name: 'The Quiet Hills', genres: ['独立民谣', '民谣'], followers: 54200,
      bio: '在乡间录音的四重奏，坚持一遍过、不修音。',
    },
    {
      id: 'ar_05', name: '林墨白', genres: ['爵士', 'Lo-fi'], followers: 97600,
      bio: '深夜系爵士钢琴手，作品几乎都录制于凌晨两点之后。',
    },
    {
      id: 'ar_06', name: 'Kaito Mori', genres: ['极简科技舞曲', '电子'], followers: 73400,
      bio: '以光学器材命名作品的结构主义者，认为节拍也是一种构图。',
    },
    {
      id: 'ar_07', name: '苏晚', genres: ['梦幻流行', '流行'], followers: 163900,
      bio: '把潮汐、贝壳与信纸写进歌里的梦幻流行创作者。',
    },
    {
      id: 'ar_08', name: 'Ada Frost', genres: ['另类 R&B', 'R&B'], followers: 141200,
      bio: '在粗野主义建筑里长大，作品充满材质感与生长痛。',
    },
  ];

  /* ================================================================== *
   * 专辑
   * ================================================================== */

  var albums = [
    { id: 'al_01', title: '夜航西飞', artistId: 'ar_01', year: 2025, genre: '氛围电子', cover: COVER + '01-night-flight.jpg' },
    { id: 'al_02', title: 'Glass Hours', artistId: 'ar_02', year: 2024, genre: '新古典', cover: COVER + '02-glass-hours.jpg' },
    { id: 'al_03', title: '霓虹回声', artistId: 'ar_03', year: 2025, genre: 'Synthwave', cover: COVER + '03-neon-echo.jpg' },
    { id: 'al_04', title: 'Field Notes', artistId: 'ar_04', year: 2023, genre: '独立民谣', cover: COVER + '04-field-notes.jpg' },
    { id: 'al_05', title: '午夜巴士', artistId: 'ar_05', year: 2024, genre: '爵士', cover: COVER + '05-midnight-bus.jpg' },
    { id: 'al_06', title: 'Aperture', artistId: 'ar_06', year: 2025, genre: '极简科技舞曲', cover: COVER + '06-aperture.jpg' },
    { id: 'al_07', title: '潮汐信笺', artistId: 'ar_07', year: 2024, genre: '梦幻流行', cover: COVER + '07-tide-letters.jpg' },
    { id: 'al_08', title: 'Concrete Bloom', artistId: 'ar_08', year: 2025, genre: '另类 R&B', cover: COVER + '08-concrete-bloom.jpg' },
  ];

  /* ================================================================== *
   * 歌词（原创）
   * ================================================================== */

  var LYRICS = {
    tr_01: [
      '[00:00.00]夜航西飞',
      '[00:14.20]跑道尽头只剩一排灯',
      '[00:21.60]风把云推成一片海',
      '[00:29.10]我把耳朵交给引擎',
      '[00:36.80]它说别怕 只是离开',
      '[00:47.30]三万英尺的静默',
      '[00:54.70]比任何一句告别都轻',
      '[01:04.20]舷窗外没有方向',
      '[01:11.90]只有星群缓慢地移动',
      '[01:26.50]我把想说的话折起来',
      '[01:34.10]放进座椅背后的口袋',
      '[01:43.60]等落地那一刻再打开',
      '[01:51.20]发现字迹已经被云擦掉',
      '[02:12.00]（间奏）',
      '[02:36.40]夜航西飞',
      '[02:44.00]我不是在逃离',
      '[02:52.80]我只是想看看',
      '[03:00.20]天亮之前的世界有多宽',
      '[03:22.60]天亮之前的世界有多宽',
      '[03:48.00]有多宽',
    ].join('\n'),

    tr_05: [
      '[00:00.00]Glass Hours',
      '[00:11.50]Morning comes through glass',
      '[00:18.90]and splits itself in two',
      '[00:26.40]One half stays on the table',
      '[00:33.80]the other half is you',
      '[00:45.20]Hours made of glass',
      '[00:52.60]I hold them carefully',
      '[01:02.10]Some of them are already cracked',
      '[01:09.70]and some are still clear',
      '[01:24.30]If I drop one, will you hear it',
      '[01:31.90]from where you are',
      '[01:41.40]If I keep it, will it keep me',
      '[01:48.90]here a little longer',
      '[02:10.50]Hours made of glass',
      '[02:18.00]Hours made of glass',
    ].join('\n'),

    tr_09: [
      '[00:00.00]霓虹回声',
      '[00:13.40]雨把整条街泡成一块屏幕',
      '[00:21.00]每个人都在里面走失',
      '[00:28.60]我在第七个路口停下',
      '[00:36.20]听见光在喊我的名字',
      '[00:46.80]那是霓虹的回声',
      '[00:54.40]比真实晚半秒',
      '[01:03.90]它重复我说的每一句话',
      '[01:11.50]却不承担任何后果',
      '[01:26.10]我们隔着一层水',
      '[01:33.70]互相挥手 互相变形',
      '[01:43.20]天亮之前谁都不是自己',
      '[01:50.80]天亮之后谁都不记得',
      '[02:11.40]那是霓虹的回声',
      '[02:19.00]比真实晚半秒',
      '[02:38.60]比真实晚半秒',
    ].join('\n'),

    tr_13: [
      '[00:00.00]Field Notes',
      '[00:12.80]记下风向 记下麦子的高度',
      '[00:20.40]记下电线杆上停了几只鸟',
      '[00:28.00]记下今天说过的话',
      '[00:35.60]有几句是真的',
      '[00:46.20]我不是在写歌',
      '[00:53.80]我是在给日子编号',
      '[01:03.30]怕它们走得太快',
      '[01:10.90]怕自己什么都不记得',
      '[01:25.50]旧木桥上刻着年份',
      '[01:33.10]最浅的那一行是我',
      '[01:42.60]风一吹就淡了',
      '[01:50.20]风一吹又清晰起来',
      '[02:12.80]风一吹又清晰起来',
    ].join('\n'),

    tr_14: [
      '[00:00.00]麦田与电线杆',
      '[00:13.60]夏天的最后一班车',
      '[00:21.20]把影子拉得很长',
      '[00:28.80]麦田在窗外翻页',
      '[00:36.40]每一页都写着留下',
      '[00:47.00]电线杆一根一根往后退',
      '[00:54.60]像在数我离开的年份',
      '[01:04.10]我数到第十二根就放弃了',
      '[01:11.70]因为天已经黑了',
      '[01:31.30]因为天已经黑了',
    ].join('\n'),

    tr_17: [
      '[00:00.00]午夜巴士',
      '[00:14.60]末班车只坐了四个人',
      '[00:22.20]司机把广播调得很小',
      '[00:29.80]雨点开始敲打车窗',
      '[00:37.40]像有人在轻轻数拍子',
      '[00:48.00]城市在玻璃上融化',
      '[00:55.60]变成一些看不懂的颜色',
      '[01:05.10]我靠在最后一排',
      '[01:12.70]假装自己有个目的地',
      '[01:27.30]假装自己有个目的地',
      '[01:47.90]下一站是终点',
      '[01:55.50]也是我今晚最远的地方',
    ].join('\n'),

    tr_25: [
      '[00:00.00]潮汐信笺',
      '[00:12.40]我把信写在退潮的沙上',
      '[00:20.00]浪会替我寄出去',
      '[00:27.60]地址是「所有听见的人」',
      '[00:35.20]邮票是一片贝壳',
      '[00:45.80]如果你在别的海边',
      '[00:53.40]捡到一句没写完的话',
      '[01:02.90]那就是我',
      '[01:10.50]那就是我',
      '[01:30.10]潮水涨起来的时候',
      '[01:37.70]所有信都会被收回',
      '[01:47.20]但没关系',
      '[01:54.80]我已经写过了',
    ].join('\n'),

    tr_29: [
      '[00:00.00]Concrete Bloom',
      '[00:13.20]They poured me a floor',
      '[00:20.80]and called it a foundation',
      '[00:28.40]Nobody asked the crack',
      '[00:36.00]what it was planning',
      '[00:46.60]I grew up through the seam',
      '[00:54.20]slow and out of line',
      '[01:03.70]Concrete bloom',
      '[01:11.30]you can pave over me',
      '[01:20.80]but I keep the shape of the light',
      '[01:28.40]somewhere underneath',
      '[01:48.00]Concrete bloom',
      '[01:55.60]somewhere underneath',
    ].join('\n'),

    /* 英文曲目的中文翻译轨，用于演示「歌词翻译」开关 */
    tr_05_TRANS: [
      '[00:11.50]清晨穿过玻璃而来',
      '[00:18.90]把自己分成两半',
      '[00:26.40]一半留在桌上',
      '[00:33.80]另一半是你',
      '[00:45.20]由玻璃做成的钟点',
      '[00:52.60]我小心地捧着',
      '[01:02.10]有些已经裂了',
      '[01:09.70]有些还清澈',
      '[01:24.30]如果我掉了一个，你听得到吗',
      '[01:31.90]从你所在的地方',
      '[01:41.40]如果我留着它，它会不会也留着我',
      '[01:48.90]再久一点',
      '[02:10.50]由玻璃做成的钟点',
      '[02:18.00]由玻璃做成的钟点',
    ].join('\n'),
  };

  /* ================================================================== *
   * 曲目
   * ================================================================== */

  function track(id, title, albumId, artistId, trackNo, duration, plays, quality) {
    return {
      id: id,
      title: title,
      albumId: albumId,
      artistId: artistId,
      trackNo: trackNo,
      duration: duration,
      plays: plays,
      quality: quality,
      liked: false,
      lyrics: LYRICS[id] || null,
      lyricsTrans: null,
    };
  }

  var tracks = [
    track('tr_01', '夜航西飞', 'al_01', 'ar_01', 1, 274, 2840000, 'flac'),
    track('tr_02', '云层之上', 'al_01', 'ar_01', 2, 312, 1520000, 'flac'),
    track('tr_03', '三万英尺的静默', 'al_01', 'ar_01', 3, 358, 968000, '320'),
    track('tr_04', '落地前的十分钟', 'al_01', 'ar_01', 4, 246, 743000, '320'),

    track('tr_05', 'Glass Hours', 'al_02', 'ar_02', 1, 228, 1970000, 'flac'),
    track('tr_06', 'Prism Light', 'al_02', 'ar_02', 2, 195, 864000, '320'),
    track('tr_07', 'Afternoon, Slowly', 'al_02', 'ar_02', 3, 267, 512000, '320'),
    track('tr_08', 'Etude in Amber', 'al_02', 'ar_02', 4, 210, 398000, 'flac'),

    track('tr_09', '霓虹回声', 'al_03', 'ar_03', 1, 245, 4120000, 'flac'),
    track('tr_10', '雨夜回路', 'al_03', 'ar_03', 2, 288, 2360000, 'flac'),
    track('tr_11', '铬色地平线', 'al_03', 'ar_03', 3, 264, 1740000, '320'),
    track('tr_12', '失真的夏夜', 'al_03', 'ar_03', 4, 231, 1100000, '320'),

    track('tr_13', 'Field Notes', 'al_04', 'ar_04', 1, 213, 674000, '320'),
    track('tr_14', '麦田与电线杆', 'al_04', 'ar_04', 2, 246, 431000, '320'),
    track('tr_15', '旧木桥', 'al_04', 'ar_04', 3, 189, 287000, '128'),
    track('tr_16', '归途', 'al_04', 'ar_04', 4, 258, 356000, '320'),

    track('tr_17', '午夜巴士', 'al_05', 'ar_05', 1, 276, 3180000, 'flac'),
    track('tr_18', '车窗上的雨', 'al_05', 'ar_05', 2, 302, 1890000, 'flac'),
    track('tr_19', '最后一班', 'al_05', 'ar_05', 3, 224, 1240000, '320'),
    track('tr_20', '空座位', 'al_05', 'ar_05', 4, 268, 826000, '320'),

    track('tr_21', 'Aperture', 'al_06', 'ar_06', 1, 372, 1420000, 'flac'),
    track('tr_22', 'f/1.4', 'al_06', 'ar_06', 2, 348, 903000, '320'),
    track('tr_23', 'Shutter', 'al_06', 'ar_06', 3, 395, 641000, '320'),
    track('tr_24', 'Grain', 'al_06', 'ar_06', 4, 286, 472000, '128'),

    track('tr_25', '潮汐信笺', 'al_07', 'ar_07', 1, 259, 5240000, 'flac'),
    track('tr_26', '贝壳收音机', 'al_07', 'ar_07', 2, 237, 2870000, 'flac'),
    track('tr_27', '退潮以后', 'al_07', 'ar_07', 3, 281, 1630000, '320'),
    track('tr_28', '写给海的信', 'al_07', 'ar_07', 4, 305, 1190000, '320'),

    track('tr_29', 'Concrete Bloom', 'al_08', 'ar_08', 1, 231, 3460000, 'flac'),
    track('tr_30', '裂缝里的花', 'al_08', 'ar_08', 2, 254, 2180000, 'flac'),
    track('tr_31', '水泥与蜜', 'al_08', 'ar_08', 3, 219, 1370000, '320'),
    track('tr_32', '生长痛', 'al_08', 'ar_08', 4, 267, 954000, '320'),
  ];

  // 给 Glass Hours 挂上翻译轨
  tracks.forEach(function (t) {
    if (t.id === 'tr_05') t.lyricsTrans = LYRICS.tr_05_TRANS;
  });

  /* ================================================================== *
   * 歌单
   * ================================================================== */

  var playlists = [
    {
      id: 'pl_01', title: '深夜驾驶', desc: '适合在没有路灯的高速上，把音量调到刚好盖过风声。',
      curator: 'Aura 编辑部', cover: COVER + '01-night-flight.jpg', system: true,
      trackIds: ['tr_01', 'tr_10', 'tr_17', 'tr_09', 'tr_02', 'tr_18', 'tr_03', 'tr_11'],
    },
    {
      id: 'pl_02', title: '专注时刻', desc: '没有人声，没有鼓点，只有足够长的呼吸。',
      curator: 'Aura 编辑部', cover: COVER + '06-aperture.jpg', system: true,
      trackIds: ['tr_21', 'tr_06', 'tr_22', 'tr_08', 'tr_23', 'tr_07', 'tr_24'],
    },
    {
      id: 'pl_03', title: '黄昏散步', desc: '太阳落下去之后，城市会变得稍微温柔一点。',
      curator: 'Aura 编辑部', cover: COVER + '04-field-notes.jpg', system: true,
      trackIds: ['tr_13', 'tr_16', 'tr_14', 'tr_15', 'tr_26', 'tr_27'],
    },
    {
      id: 'pl_04', title: '城市夜行', desc: '霓虹、雨、车窗、失焦的光斑。',
      curator: 'Aura 编辑部', cover: COVER + '03-neon-echo.jpg', system: true,
      trackIds: ['tr_09', 'tr_12', 'tr_11', 'tr_10', 'tr_29', 'tr_31'],
    },
    {
      id: 'pl_05', title: '周末清晨', desc: '不急着起床的那两个小时。',
      curator: 'Aura 编辑部', cover: COVER + '02-glass-hours.jpg', system: true,
      trackIds: ['tr_05', 'tr_06', 'tr_07', 'tr_25', 'tr_28', 'tr_08'],
    },
    {
      id: 'pl_06', title: '雨天窗边', desc: '把雨声当作乐器来听。',
      curator: 'Aura 编辑部', cover: COVER + '05-midnight-bus.jpg', system: true,
      trackIds: ['tr_18', 'tr_20', 'tr_17', 'tr_19', 'tr_30', 'tr_32', 'tr_15'],
    },
  ];

  /* ================================================================== *
   * 分类（搜索页用）
   * ================================================================== */

  var genres = [
    { id: 'g_01', name: '氛围电子', colors: ['#1b2a5e', '#0b1230'], icon: 'waves' },
    { id: 'g_02', name: '新古典', colors: ['#6b5a3e', '#e8dcc4'], icon: 'gauge' },
    { id: 'g_03', name: 'Synthwave', colors: ['#7a1f5c', '#00b3c4'], icon: 'zap' },
    { id: 'g_04', name: '独立民谣', colors: ['#2f5d50', '#8fae7a'], icon: 'radio' },
    { id: 'g_05', name: '爵士', colors: ['#4b3621', '#c9a227'], icon: 'disc' },
    { id: 'g_06', name: '极简科技舞曲', colors: ['#111418', '#5a616b'], icon: 'audio-lines' },
    { id: 'g_07', name: '梦幻流行', colors: ['#b25c72', '#f2d5d8'], icon: 'sparkles' },
    { id: 'g_08', name: '另类 R&B', colors: ['#8a4b2a', '#8e8e93'], icon: 'heart' },
  ];

  /* ================================================================== *
   * 首页编排
   * ================================================================== */

  var home = {
    heroAlbumId: 'al_01',
    heroEyebrow: '编辑精选',
    heroDesc: '陈默用四首曲子记录了一次横跨夜色的飞行：引擎的持续低鸣、云层被风推开的形状，以及落地前那十分钟的失重感。建议戴上耳机，从第一首完整听完。',
    stats: [
      { label: '曲库曲目', value: '32', unit: '首' },
      { label: '收录专辑', value: '8', unit: '张' },
      { label: '总时长', value: '2.3', unit: '小时' },
      { label: '无损曲目', value: '14', unit: '首' },
    ],
    shelves: [
      { id: 'sh_01', title: '为你精选', sub: '根据最近的收听偏好生成', type: 'album', ids: ['al_01', 'al_03', 'al_07', 'al_05', 'al_08', 'al_02'] },
      { id: 'sh_02', title: '编辑部歌单', sub: 'Aura 编辑部手工编排', type: 'playlist', ids: ['pl_01', 'pl_04', 'pl_06', 'pl_02', 'pl_03', 'pl_05'] },
      { id: 'sh_03', title: '夜间聆听', sub: '低刺激、长混响', type: 'album', ids: ['al_05', 'al_01', 'al_02', 'al_06'] },
      { id: 'sh_04', title: '最近播放', sub: '继续上次没听完的', type: 'track', ids: ['tr_25', 'tr_17', 'tr_09', 'tr_29', 'tr_13', 'tr_21'] },
      { id: 'sh_05', title: '新发行', sub: '2025 年新专辑', type: 'album', ids: ['al_06', 'al_08', 'al_03', 'al_01'] },
    ],
    recentTrackIds: ['tr_25', 'tr_09', 'tr_17', 'tr_01', 'tr_29', 'tr_13', 'tr_21', 'tr_05'],
  };

  Aura.mock = {
    artists: artists,
    albums: albums,
    tracks: tracks,
    playlists: playlists,
    genres: genres,
    home: home,
  };
})(window.Aura = window.Aura || {});
