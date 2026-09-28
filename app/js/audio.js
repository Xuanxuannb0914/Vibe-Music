/**
 * Aura · 音频引擎
 *
 * 一个统一的播放接口，背后两套音源实现：
 *
 *   ElementBackend —— 真实音频直链（QQ 音乐等），走 <audio> 元素
 *   SynthBackend   —— 内置演示数据没有音频文件，用 Web Audio 程序化合成环境音，
 *                     因此播放 / 暂停 / 进度 / 跳转 / 频谱在离线演示时全部真实可用
 *
 * 两者共用同一条 Web Audio 处理链，所有「内核可调」项都作用在这条链上：
 *
 *   source → EQ(5 段) → 干湿分路(空间感) → 立体声宽度 → 淡入淡出增益 → 分析器 → 输出
 *
 * 跨域安全：真实音频若来自未返回 CORS 头的 CDN，一旦接入 Web Audio 会整体静音。
 * 因此先探测 CORS，不可用时改走「元素直出」，同时把频谱切到合成动画，
 * 保证「听得到」永远优先于「看得到」。
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;

  var EQ_FREQS = [60, 230, 910, 3600, 14000];
  var SYNTH_LOOP_SECONDS = 16;

  var ctx = null;
  var graph = null;
  var element = null;
  var mediaSource = null;
  var elementRouted = false;      // <audio> 是否已接入 Web Audio
  var elementDirectOnly = false;  // 探测到跨域限制后，元素直连输出
  var backend = null;
  var currentTrack = null;
  var listeners = {};

  /* ------------------------------------------------------------------ *
   * 事件
   * ------------------------------------------------------------------ */

  function on(event, fn) {
    (listeners[event] = listeners[event] || []).push(fn);
    return function () {
      listeners[event] = (listeners[event] || []).filter(function (f) { return f !== fn; });
    };
  }

  function emit(event, payload) {
    (listeners[event] || []).forEach(function (fn) {
      try { fn(payload); } catch (err) { console.error('[Aura.audio] 事件回调异常:', event, err); }
    });
  }

  /* ------------------------------------------------------------------ *
   * AudioContext 与处理链
   * ------------------------------------------------------------------ */

  function ensureContext() {
    if (ctx) return ctx;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctor();
    buildGraph();
    return ctx;
  }

  /** 生成一段程序化脉冲响应，用于空间感（避免依赖外部 IR 文件） */
  function buildImpulse(seconds, decay) {
    var rate = ctx.sampleRate;
    var length = Math.max(1, Math.floor(rate * seconds));
    var impulse = ctx.createBuffer(2, length, rate);
    for (var channel = 0; channel < 2; channel++) {
      var data = impulse.getChannelData(channel);
      for (var i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  function buildGraph() {
    var input = ctx.createGain();
    input.gain.value = 1;

    /* —— 5 段均衡器 —— */
    var eqNodes = EQ_FREQS.map(function (freq) {
      var filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.1;
      filter.gain.value = 0;
      return filter;
    });

    var chainIn = input;
    eqNodes.forEach(function (node) {
      chainIn.connect(node);
      chainIn = node;
    });
    var eqOut = chainIn;

    /* —— 干湿分路（空间感） —— */
    var dryGain = ctx.createGain();
    dryGain.gain.value = 1;

    var convolver = ctx.createConvolver();
    convolver.buffer = buildImpulse(2.4, 3);
    var wetGain = ctx.createGain();
    wetGain.gain.value = 0;

    eqOut.connect(dryGain);
    eqOut.connect(convolver);
    convolver.connect(wetGain);

    /* —— 立体声宽度（mid/side 矩阵） —— */
    var splitter = ctx.createChannelSplitter(2);
    dryGain.connect(splitter);
    wetGain.connect(splitter);

    var midL = ctx.createGain(); midL.gain.value = 0.5;
    var midR = ctx.createGain(); midR.gain.value = 0.5;
    var sideL = ctx.createGain(); sideL.gain.value = 0.5;
    var sideR = ctx.createGain(); sideR.gain.value = -0.5;

    splitter.connect(midL, 0);
    splitter.connect(midR, 1);
    splitter.connect(sideL, 0);
    splitter.connect(sideR, 1);

    var midBus = ctx.createGain(); midBus.gain.value = 1;
    var sideBus = ctx.createGain(); sideBus.gain.value = 1;
    midL.connect(midBus);
    midR.connect(midBus);
    sideL.connect(sideBus);
    sideR.connect(sideBus);

    var widthGain = ctx.createGain();
    widthGain.gain.value = 1;
    sideBus.connect(widthGain);

    var merger = ctx.createChannelMerger(2);
    var sideInvert = ctx.createGain();
    sideInvert.gain.value = -1;

    midBus.connect(merger, 0, 0);
    widthGain.connect(merger, 0, 0);
    midBus.connect(merger, 0, 1);
    widthGain.connect(sideInvert);
    sideInvert.connect(merger, 0, 1);

    /* —— 淡入淡出与总输出 —— */
    var fadeGain = ctx.createGain();
    fadeGain.gain.value = 1;
    merger.connect(fadeGain);

    var analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    fadeGain.connect(analyser);

    var master = ctx.createGain();
    master.gain.value = 1;
    analyser.connect(master);
    master.connect(ctx.destination);

    graph = {
      input: input,
      eq: eqNodes,
      dryGain: dryGain,
      wetGain: wetGain,
      widthGain: widthGain,
      fadeGain: fadeGain,
      analyser: analyser,
      master: master,
    };
  }

  /** 把当前内核参数（均衡器/空间感/宽度/增益）应用到处理链 */
  function applyChainParams() {
    if (!graph) return;
    var prefs = Aura.store.getPref('audio', {});
    var eq = prefs.eq || [0, 0, 0, 0, 0];
    graph.eq.forEach(function (node, i) {
      node.gain.value = util.clamp(Number(eq[i]) || 0, -12, 12);
    });

    var reverb = util.clamp(Number(prefs.reverb) || 0, 0, 1);
    graph.dryGain.gain.value = 1 - reverb * 0.45;
    graph.wetGain.gain.value = reverb * 0.75;

    graph.widthGain.gain.value = util.clamp(Number(prefs.stereoWidth) || 1, 0, 2);

    var gain = util.clamp(Number(prefs.gain) || 1, 0.2, 2);
    graph.master.gain.value = gain;
  }

  /* ------------------------------------------------------------------ *
   * 淡入淡出
   * ------------------------------------------------------------------ */

  function fadeTo(target, ms) {
    if (!graph || !ctx) return;
    var now = ctx.currentTime;
    var duration = Math.max(0, (ms || 0) / 1000);
    var param = graph.fadeGain.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    if (duration <= 0.01) {
      param.setValueAtTime(target, now);
    } else {
      param.linearRampToValueAtTime(target, now + duration);
    }
  }

  /* ------------------------------------------------------------------ *
   * 音源后端 · 真实音频（<audio> 元素）
   * ------------------------------------------------------------------ */

  function ensureElement() {
    if (element) return element;
    element = new Audio();
    element.preload = 'auto';
    element.crossOrigin = 'anonymous';
    element.addEventListener('timeupdate', function () {
      emit('timeupdate', { currentTime: element.currentTime, duration: element.duration || 0 });
    });
    element.addEventListener('loadedmetadata', function () {
      emit('durationchange', { duration: element.duration || 0 });
    });
    element.addEventListener('ended', function () { emit('ended'); });
    element.addEventListener('error', function () {
      emit('error', new Error('音频加载失败，可能是链接已过期或受版权限制'));
    });
    return element;
  }

  function ElementBackend() {
    var self = {
      kind: 'element',
      duration: 0,

      load: function (track, stream) {
        var audio = ensureElement();
        self.duration = util.toSeconds(track.duration);

        return probeCors(stream.url).then(function (corsOk) {
          audio.src = stream.url;
          audio.playbackRate = util.clamp(Number(Aura.store.getPref('audio.speed', 1)), 0.5, 2);

          if (corsOk && !elementDirectOnly) {
            if (!elementRouted) {
              try {
                mediaSource = ctx.createMediaElementSource(audio);
                mediaSource.connect(graph.input);
                elementRouted = true;
              } catch (err) {
                console.warn('[Aura.audio] 无法接入 Web Audio，改走直出:', err.message);
                elementDirectOnly = true;
              }
            }
          } else {
            elementDirectOnly = true;
          }

          if (elementDirectOnly && !elementRouted) {
            // 直出模式：绕开处理链，元素自己控制音量，频谱改用合成动画
            audio.volume = util.clamp(Number(Aura.store.state.volume), 0, 1);
          }

          return new Promise(function (resolve, reject) {
            var done = false;
            function ok() { if (!done) { done = true; cleanup(); resolve(); } }
            function fail() { if (!done) { done = true; cleanup(); reject(new Error('音频元数据加载失败')); } }
            function cleanup() {
              audio.removeEventListener('loadedmetadata', ok);
              audio.removeEventListener('error', fail);
            }
            audio.addEventListener('loadedmetadata', ok);
            audio.addEventListener('error', fail);
            audio.load();
            setTimeout(function () {
              if (!done) { done = true; cleanup(); resolve(); }
            }, 6000);
          });
        });
      },

      play: function () {
        return ensureElement().play();
      },

      pause: function () {
        if (element) element.pause();
      },

      seek: function (seconds) {
        if (element) element.currentTime = util.clamp(seconds, 0, self.duration || element.duration || 0);
      },

      setRate: function (rate) {
        if (element) element.playbackRate = util.clamp(rate, 0.5, 2);
      },

      setVolume: function (value) {
        if (elementDirectOnly && element) element.volume = util.clamp(value, 0, 1);
      },

      get currentTime() { return element ? element.currentTime : 0; },
      get duration_() { return element && isFinite(element.duration) ? element.duration : self.duration; },
      get paused() { return !element || element.paused; },

      dispose: function () {
        if (element) { element.pause(); element.removeAttribute('src'); element.load(); }
      },
    };
    return self;
  }

  /** 探测音频直链是否允许跨域读取（决定能否接入 Web Audio 做频谱分析） */
  function probeCors(url) {
    if (!url || /^(aura|file|blob|data):/i.test(url)) return Promise.resolve(true);
    if (elementDirectOnly) return Promise.resolve(false);
    return fetch(url, { method: 'GET', mode: 'cors', headers: { Range: 'bytes=0-1' } })
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  /* ------------------------------------------------------------------ *
   * 音源后端 · 程序化合成（内置演示数据）
   *
   * 为每首曲目生成一段循环环境音：以曲目 id 为种子决定调性与音色，
   * 因此不同曲目听起来确实不同，而不是同一段音频反复播放。
   * ------------------------------------------------------------------ */

  function hashSeed(str) {
    var h = 2166136261;
    for (var i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** 用离线上下文渲染一段环境音循环，避免主线程卡顿 */
  function renderLoop(seed) {
    var rand = mulberry32(seed);
    var root = 110 * Math.pow(2, (Math.floor(rand() * 5) - 2) / 12); // 基准音
    var scale = [0, 3, 5, 7, 10];                                    // 小调五声，听感安稳

    var OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var offline = new OfflineCtor(2, ctx.sampleRate * SYNTH_LOOP_SECONDS, ctx.sampleRate);

    var master = offline.createGain();
    master.gain.value = 0.22;

    var lowpass = offline.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 1400 + rand() * 900;
    lowpass.Q.value = 0.7;
    lowpass.connect(master);
    master.connect(offline.destination);

    /* 和声垫：三层正弦，缓慢失谐产生流动感 */
    var voices = 3 + Math.floor(rand() * 3);
    for (var v = 0; v < voices; v++) {
      var degree = scale[Math.floor(rand() * scale.length)];
      var octave = rand() > 0.6 ? 2 : 1;
      var freq = root * Math.pow(2, degree / 12) * octave;

      var osc = offline.createOscillator();
      osc.type = v % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq * (1 + (rand() - 0.5) * 0.008);

      var voiceGain = offline.createGain();
      voiceGain.gain.value = 0;
      // 缓慢起伏的包络，形成呼吸感
      var peak = 0.18 + rand() * 0.22;
      var period = SYNTH_LOOP_SECONDS / (1 + Math.floor(rand() * 3));
      voiceGain.gain.setValueAtTime(0, 0);
      for (var t = 0; t < SYNTH_LOOP_SECONDS; t += period) {
        voiceGain.gain.linearRampToValueAtTime(peak, t + period * 0.4);
        voiceGain.gain.linearRampToValueAtTime(peak * 0.25, t + period * 0.95);
      }

      var lfo = offline.createOscillator();
      lfo.frequency.value = 0.05 + rand() * 0.12;
      var lfoGain = offline.createGain();
      lfoGain.gain.value = 2.5 + rand() * 4;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      osc.connect(voiceGain);
      voiceGain.connect(lowpass);
      osc.start(0);
      lfo.start(0);
    }

    /* 底噪层：极轻的粉噪，填满高频空隙，让声音更「有空间」 */
    var noiseBuffer = offline.createBuffer(1, ctx.sampleRate * SYNTH_LOOP_SECONDS, ctx.sampleRate);
    var noiseData = noiseBuffer.getChannelData(0);
    var last = 0;
    for (var i = 0; i < noiseData.length; i++) {
      var white = rand() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      noiseData[i] = last * 3.2;
    }
    var noise = offline.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    var noiseGain = offline.createGain();
    noiseGain.gain.value = 0.06;
    noise.connect(noiseGain);
    noiseGain.connect(lowpass);
    noise.start(0);

    return offline.startRendering();
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function SynthBackend() {
    var loopBuffer = null;
    var sourceNode = null;
    var basePosition = 0;
    var baseCtxTime = 0;
    var playing = false;
    var endedEmitted = false;

    var self = {
      kind: 'synth',
      duration: 0,

      load: function (track) {
        self.duration = util.toSeconds(track.duration) || 180;
        basePosition = 0;
        endedEmitted = false;
        return renderLoop(hashSeed(track.id || track.title)).then(function (buffer) {
          loopBuffer = buffer;
          return undefined;
        });
      },

      play: function () {
        if (!loopBuffer) return Promise.reject(new Error('音源尚未就绪'));
        stopSource();
        var offset = basePosition % loopBuffer.duration;
        sourceNode = ctx.createBufferSource();
        sourceNode.buffer = loopBuffer;
        sourceNode.loop = true;
        sourceNode.playbackRate.value = util.clamp(Number(Aura.store.getPref('audio.speed', 1)), 0.5, 2);
        sourceNode.connect(graph.input);
        sourceNode.start(0, offset);

        baseCtxTime = ctx.currentTime;
        playing = true;
        endedEmitted = false;
        return Promise.resolve();
      },

      pause: function () {
        if (!playing) return;
        basePosition = self.currentTime;
        playing = false;
        stopSource();
      },

      seek: function (seconds) {
        var wasPlaying = playing;
        basePosition = util.clamp(seconds, 0, self.duration);
        endedEmitted = false;
        if (wasPlaying) self.play();
      },

      setRate: function (rate) {
        var clamped = util.clamp(rate, 0.5, 2);
        if (playing) {
          basePosition = self.currentTime;
          baseCtxTime = ctx.currentTime;
          if (sourceNode) sourceNode.playbackRate.value = clamped;
        }
      },

      setVolume: function () { /* 合成音源音量统一由处理链的 master 控制 */ },

      get currentTime() {
        if (!playing) return basePosition;
        var elapsed = (ctx.currentTime - baseCtxTime) * util.clamp(Number(Aura.store.getPref('audio.speed', 1)), 0.5, 2);
        var position = basePosition + elapsed;
        if (position >= self.duration) {
          if (!endedEmitted) {
            endedEmitted = true;
            basePosition = self.duration;
            setTimeout(function () { emit('ended'); }, 0);
          }
          return self.duration;
        }
        return position;
      },

      get duration_() { return self.duration; },
      get paused() { return !playing; },

      dispose: function () {
        playing = false;
        stopSource();
        loopBuffer = null;
      },
    };

    function stopSource() {
      if (!sourceNode) return;
      try {
        sourceNode.stop();
        sourceNode.disconnect();
      } catch (err) {
        /* 已停止 */
      }
      sourceNode = null;
    }

    return self;
  }

  /* ------------------------------------------------------------------ *
   * 对外播放器接口
   * ------------------------------------------------------------------ */

  var audio = {
    /**
     * 载入并准备一首曲目
     * @param {object} track 统一结构的曲目对象
     * @param {object} stream resolveStreamUrl 的返回结果
     */
    load: function (track, stream) {
      ensureContext();
      if (ctx.state === 'suspended') ctx.resume();

      if (backend && backend.dispose) backend.dispose();

      currentTrack = track;
      applyChainParams();
      emit('loading', { track: track });

      var useSynth = !stream || !stream.url || stream.synthesized;
      backend = useSynth ? SynthBackend() : ElementBackend();

      return backend.load(track, stream || {}).then(function () {
        audio.setVolume(Aura.store.state.volume);
        emit('ready', { track: track, duration: audio.duration, synthesized: useSynth });
      }).catch(function (err) {
        emit('error', err);
        throw err;
      });
    },

    play: function () {
      if (!backend) return Promise.resolve();
      ensureContext();
      if (ctx.state === 'suspended') ctx.resume();
      applyChainParams();
      fadeTo(1, Aura.store.getPref('audio.fadeIn', 400));
      var result = backend.play();
      var promise = result && typeof result.then === 'function' ? result : Promise.resolve();
      return promise.then(function () {
        emit('play', { track: currentTrack });
      }).catch(function (err) {
        emit('error', err);
        throw err;
      });
    },

    pause: function () {
      if (!backend) return;
      fadeTo(0, Aura.store.getPref('audio.fadeOut', 400));
      var delayMs = Math.max(0, Number(Aura.store.getPref('audio.fadeOut', 400)));
      setTimeout(function () {
        if (backend) backend.pause();
        emit('pause', { track: currentTrack });
      }, delayMs);
    },

    stop: function () {
      if (!backend) return;
      backend.pause();
      backend.seek(0);
      emit('pause', { track: currentTrack });
    },

    seek: function (seconds) {
      if (!backend) return;
      backend.seek(seconds);
      emit('timeupdate', { currentTime: seconds, duration: audio.duration });
    },

    seekBy: function (delta) {
      audio.seek(audio.currentTime + delta);
    },

    setRate: function (rate) {
      if (backend && backend.setRate) backend.setRate(rate);
    },

    setVolume: function (value) {
      var clamped = util.clamp(Number(value), 0, 1);
      if (graph) graph.master.gain.value = clamped * util.clamp(Number(Aura.store.getPref('audio.gain', 1)), 0.2, 2);
      if (backend && backend.setVolume) backend.setVolume(clamped);
    },

    /** 内核参数变更后重新套用到处理链 */
    refresh: function () {
      applyChainParams();
      if (backend && backend.setRate) backend.setRate(Aura.store.getPref('audio.speed', 1));
      audio.setVolume(Aura.store.state.volume);
    },

    /** 频谱分析器；未接入 Web Audio 时返回 null，可视化层据此切换为合成动画 */
    getAnalyser: function () {
      if (!graph || elementDirectOnly) return null;
      return graph.analyser;
    },

    get currentTime() {
      return backend ? backend.currentTime : 0;
    },

    get duration() {
      return backend ? backend.duration_ : 0;
    },

    get paused() {
      return backend ? backend.paused : true;
    },

    get track() {
      return currentTrack;
    },

    get kind() {
      return backend ? backend.kind : null;
    },

    on: on,
    emit: emit,
  };

  Aura.audio = audio;
})(window.Aura = window.Aura || {});
