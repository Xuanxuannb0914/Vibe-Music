/**
 * Aura · 可视化引擎
 *
 * 四种样式：bars（柱状）/ wave（波形）/ radial（环形）/ particles（粒子）。
 * 数据来源有两档：
 *   1. 有 AnalyserNode → 真实频谱
 *   2. 没有（跨域限制或音频未就绪）→ 用播放进度驱动的合成频谱，
 *      保证画面始终「活着」，而不是一条死线
 *
 * 绘制统一使用 CSS 变量里的强调色，因此频谱会随封面主色一起变化。
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;

  function readAccent() {
    var raw = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
    var parts = raw.split(/[\s,]+/).map(Number);
    if (parts.length === 3 && parts.every(function (n) { return isFinite(n); })) return parts;
    return [255, 55, 95];
  }

  /**
   * 创建可视化实例
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options] { style, sensitivity, compact }
   */
  function create(canvas, options) {
    options = options || {};
    var ctx2d = canvas.getContext('2d');
    var freqData = null;
    var timeData = null;
    var rafId = null;
    var style = options.style || 'bars';
    var compact = !!options.compact;
    var sensitivity = options.sensitivity || 1;
    var particles = [];
    var phase = 0;
    var lastFrame = 0;
    var running = false;
    var dpr = 1;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /** 取一帧频谱数据；无分析器时返回合成数据 */
    function spectrum(bars, time) {
      var analyser = Aura.audio.getAnalyser();
      if (analyser) {
        if (!freqData || freqData.length !== analyser.frequencyBinCount) {
          freqData = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(freqData);
        var out = new Float32Array(bars);
        var usable = Math.floor(freqData.length * 0.62);
        for (var i = 0; i < bars; i++) {
          // 低频段权重更高，接近真实听感
          var start = Math.floor(Math.pow(i / bars, 1.45) * usable);
          var end = Math.max(start + 1, Math.floor(Math.pow((i + 1) / bars, 1.45) * usable));
          var sum = 0;
          for (var j = start; j < end; j++) sum += freqData[j];
          var value = sum / (end - start) / 255;
          out[i] = Math.pow(value, 0.85) * sensitivity;
        }
        return out;
      }

      // 合成频谱：多组不同频率的正弦叠加 + 轻微噪声，播放时才有起伏
      var playing = !Aura.audio.paused && !!Aura.audio.track;
      var out2 = new Float32Array(bars);
      for (var k = 0; k < bars; k++) {
        var norm = k / bars;
        var base = playing
          ? (0.34 + 0.3 * Math.sin(time * 1.6 + norm * 7.4) +
             0.22 * Math.sin(time * 2.7 - norm * 12.1) +
             0.14 * Math.sin(time * 0.9 + norm * 3.3))
          : 0.05;
        var envelope = Math.pow(1 - norm, 0.55) * 0.7 + 0.3;
        out2[k] = Math.max(0, base * envelope * sensitivity);
      }
      return out2;
    }

    function waveform(points) {
      var analyser = Aura.audio.getAnalyser();
      if (analyser) {
        if (!timeData || timeData.length !== analyser.fftSize) {
          timeData = new Uint8Array(analyser.fftSize);
        }
        analyser.getByteTimeDomainData(timeData);
        var out = new Float32Array(points);
        var step = Math.floor(timeData.length / points);
        for (var i = 0; i < points; i++) {
          out[i] = (timeData[i * step] - 128) / 128;
        }
        return out;
      }
      var playing = !Aura.audio.paused && !!Aura.audio.track;
      var out2 = new Float32Array(points);
      for (var k = 0; k < points; k++) {
        var t = k / points;
        out2[k] = playing
          ? 0.42 * Math.sin(t * Math.PI * 6 + phase * 2.4) * Math.sin(t * Math.PI * 1.3)
          : 0.02 * Math.sin(t * Math.PI * 4);
      }
      return out2;
    }

    /* ---------- 各样式绘制 ---------- */

    function drawBars(width, height, time) {
      var accent = readAccent();
      var bars = Math.max(12, Math.floor(width / (compact ? 4 : 7)));
      var values = spectrum(bars, time);
      var gap = compact ? 1.5 : 3;
      var barWidth = (width - gap * (bars - 1)) / bars;
      var radius = Math.min(barWidth / 2, compact ? 2 : 4);

      var gradient = ctx2d.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, 'rgba(' + accent.join(',') + ',0.35)');
      gradient.addColorStop(0.55, 'rgba(' + accent.join(',') + ',0.85)');
      gradient.addColorStop(1, 'rgb(' + accent.join(',') + ')');
      ctx2d.fillStyle = gradient;

      for (var i = 0; i < bars; i++) {
        var value = util.clamp(values[i], 0, 1);
        var barHeight = Math.max(radius * 2, value * height * 0.94);
        var x = i * (barWidth + gap);
        var y = height - barHeight;
        roundRect(x, y, barWidth, barHeight, radius);
        ctx2d.fill();
      }
    }

    function drawWave(width, height, time) {
      var accent = readAccent();
      var points = Math.max(48, Math.floor(width / 3));
      var values = waveform(points);
      var mid = height / 2;

      ctx2d.beginPath();
      for (var i = 0; i < points; i++) {
        var x = (i / (points - 1)) * width;
        var y = mid + values[i] * mid * 0.88;
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
      }
      ctx2d.strokeStyle = 'rgb(' + accent.join(',') + ')';
      ctx2d.lineWidth = compact ? 1.4 : 2.2;
      ctx2d.lineJoin = 'round';
      ctx2d.lineCap = 'round';
      ctx2d.shadowColor = 'rgba(' + accent.join(',') + ',0.55)';
      ctx2d.shadowBlur = compact ? 4 : 14;
      ctx2d.stroke();
      ctx2d.shadowBlur = 0;

      // 镜像淡影，增加厚度
      ctx2d.globalAlpha = 0.22;
      ctx2d.beginPath();
      for (var j = 0; j < points; j++) {
        var x2 = (j / (points - 1)) * width;
        var y2 = mid - values[j] * mid * 0.88;
        if (j === 0) ctx2d.moveTo(x2, y2);
        else ctx2d.lineTo(x2, y2);
      }
      ctx2d.stroke();
      ctx2d.globalAlpha = 1;
    }

    function drawRadial(width, height, time) {
      var accent = readAccent();
      var bars = compact ? 24 : 72;
      var values = spectrum(bars, time);
      var cx = width / 2;
      var cy = height / 2;
      var baseRadius = Math.min(width, height) * (compact ? 0.28 : 0.26);
      var maxLength = Math.min(width, height) * (compact ? 0.2 : 0.22);

      ctx2d.lineCap = 'round';
      for (var i = 0; i < bars; i++) {
        var angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
        var value = util.clamp(values[i], 0, 1);
        var length = maxLength * (0.12 + value * 0.88);
        var alpha = 0.28 + value * 0.72;

        ctx2d.beginPath();
        ctx2d.strokeStyle = 'rgba(' + accent.join(',') + ',' + alpha.toFixed(3) + ')';
        ctx2d.lineWidth = compact ? 1.5 : 2.6;
        ctx2d.moveTo(cx + Math.cos(angle) * baseRadius, cy + Math.sin(angle) * baseRadius);
        ctx2d.lineTo(cx + Math.cos(angle) * (baseRadius + length), cy + Math.sin(angle) * (baseRadius + length));
        ctx2d.stroke();
      }
    }

    function drawParticles(width, height, time) {
      var accent = readAccent();
      var values = spectrum(18, time);
      var energy = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
      var playing = !Aura.audio.paused && !!Aura.audio.track;

      // 按能量补充粒子
      var spawn = playing ? Math.round(energy * (compact ? 2 : 5)) : 0;
      for (var i = 0; i < spawn; i++) {
        particles.push({
          x: Math.random() * width,
          y: height + 6,
          vx: (Math.random() - 0.5) * 0.5,
          vy: -(0.5 + Math.random() * 1.5) * (0.6 + energy),
          life: 1,
          size: 0.8 + Math.random() * (compact ? 1.2 : 2.4),
        });
      }

      for (var j = particles.length - 1; j >= 0; j--) {
        var p = particles[j];
        p.x += p.vx;
        p.y += p.vy;
        p.vy *= 0.995;
        p.life -= 0.006;
        if (p.life <= 0 || p.y < -10) {
          particles.splice(j, 1);
          continue;
        }
        ctx2d.beginPath();
        ctx2d.fillStyle = 'rgba(' + accent.join(',') + ',' + (p.life * 0.75).toFixed(3) + ')';
        ctx2d.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx2d.fill();
      }

      if (!compact) {
        ctx2d.globalAlpha = 0.5;
        drawBars(width, height * 0.42, time);
        ctx2d.globalAlpha = 1;
      }
    }

    function roundRect(x, y, w, h, r) {
      var radius = Math.min(r, w / 2, h / 2);
      ctx2d.beginPath();
      ctx2d.moveTo(x + radius, y);
      ctx2d.arcTo(x + w, y, x + w, y + h, radius);
      ctx2d.arcTo(x + w, y + h, x, y + h, radius);
      ctx2d.arcTo(x, y + h, x, y, radius);
      ctx2d.arcTo(x, y, x + w, y, radius);
      ctx2d.closePath();
    }

    function frame(timestamp) {
      if (!running) return;
      rafId = requestAnimationFrame(frame);

      var width = canvas.clientWidth;
      var height = canvas.clientHeight;
      if (!width || !height) return;

      // 限制到约 45fps，降低后台 CPU 占用
      if (timestamp - lastFrame < 22) return;
      lastFrame = timestamp;
      phase += 0.016;

      ctx2d.clearRect(0, 0, width, height);

      if (style === 'wave') drawWave(width, height, phase);
      else if (style === 'radial') drawRadial(width, height, phase);
      else if (style === 'particles') drawParticles(width, height, phase);
      else drawBars(width, height, phase);
    }

    var observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(function () { resize(); });
      observer.observe(canvas);
    }

    return {
      start: function () {
        if (running) return;
        resize();
        running = true;
        rafId = requestAnimationFrame(frame);
      },
      stop: function () {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
      },
      setStyle: function (next) {
        style = next || 'bars';
        particles = [];
      },
      setSensitivity: function (value) {
        sensitivity = util.clamp(Number(value) || 1, 0.3, 3);
      },
      resize: resize,
      destroy: function () {
        this.stop();
        if (observer) observer.disconnect();
      },
    };
  }

  Aura.visualizer = { create: create };
})(window.Aura = window.Aura || {});
