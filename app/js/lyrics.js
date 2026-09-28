/**
 * Aura · 歌词引擎
 *
 * 职责：
 *   1. 解析 LRC（含一行多时间戳、毫秒/厘秒混排、翻译轨合并）
 *   2. 按播放时间定位当前行（二分查找，避免每帧全量扫描）
 *   3. 维护滚动容器的激活态与居中滚动（只改 class，不重建 DOM）
 */
(function (Aura) {
  'use strict';

  var util = Aura.util;
  var TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  var META_TAG = /^\[(ti|ar|al|by|offset):(.*)\]$/i;

  function toSeconds(min, sec, frac) {
    var ms = 0;
    if (frac != null && frac !== '') {
      ms = frac.length === 1 ? Number(frac) * 100 : frac.length === 2 ? Number(frac) * 10 : Number(frac);
    }
    return Number(min) * 60 + Number(sec) + ms / 1000;
  }

  /**
   * 解析 LRC 文本
   * @param {string} text
   * @returns {{meta: object, lines: Array<{time:number, text:string}>}}
   */
  function parseLrc(text) {
    var meta = {};
    var lines = [];
    if (!text) return { meta: meta, lines: lines };

    String(text).split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;

      var metaMatch = line.match(META_TAG);
      if (metaMatch) {
        meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
        return;
      }

      TIME_TAG.lastIndex = 0;
      var stamps = [];
      var match;
      while ((match = TIME_TAG.exec(line)) !== null) {
        stamps.push(toSeconds(match[1], match[2], match[3]));
      }
      if (!stamps.length) return;

      var content = line.replace(TIME_TAG, '').trim();
      // 纯时间戳行（间奏）保留为占位，让滚动节奏与音乐一致
      stamps.forEach(function (time) {
        lines.push({ time: time, text: content });
      });
    });

    lines.sort(function (a, b) { return a.time - b.time; });
    return { meta: meta, lines: lines };
  }

  /**
   * 合并翻译轨：按时间戳（容差 0.35s）配对
   */
  function mergeTranslation(lines, translationText) {
    if (!translationText) return lines;
    var trans = parseLrc(translationText).lines;
    if (!trans.length) return lines;

    var cursor = 0;
    lines.forEach(function (line) {
      while (cursor < trans.length && Math.abs(trans[cursor].time - line.time) > 0.35) {
        if (trans[cursor].time > line.time) break;
        cursor += 1;
      }
      if (cursor < trans.length && Math.abs(trans[cursor].time - line.time) <= 0.35) {
        line.trans = trans[cursor].text;
      }
    });
    return lines;
  }

  /** 二分查找当前时间对应的行号，无匹配返回 -1 */
  function findIndex(lines, time) {
    if (!lines || !lines.length) return -1;
    var lo = 0;
    var hi = lines.length - 1;
    var result = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (lines[mid].time <= time) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }

  /**
   * 组装歌词数据（解析 + 合并翻译）
   * @returns {{lines: Array, meta: object, hasTranslation: boolean}}
   */
  function build(payload) {
    if (!payload || !payload.lrc) return { lines: [], meta: {}, hasTranslation: false };
    var parsed = parseLrc(payload.lrc);
    var lines = parsed.lines;
    if (payload.translation) lines = mergeTranslation(lines, payload.translation);
    return {
      lines: lines,
      meta: parsed.meta,
      hasTranslation: lines.some(function (l) { return !!l.trans; }),
    };
  }

  /**
   * 歌词视图控制器：构建一次，之后只切换激活态
   * @param {HTMLElement} scrollEl 滚动容器（.lyrics__scroll）
   */
  function createView(scrollEl) {
    var inner = util.el('div', { class: 'lyrics__inner' });
    var nodes = [];
    var activeIndex = -1;
    var lines = [];
    var autoScroll = true;

    // 用户手动滚动时暂停自动居中，3 秒后恢复，避免和用户「抢滚动条」
    var resumeTimer = null;
    scrollEl.addEventListener('scroll', function () {
      autoScroll = false;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(function () { autoScroll = true; }, 3000);
    });

    function renderEmpty(message) {
      inner.innerHTML = '';
      nodes = [];
      lines = [];
      activeIndex = -1;
      var empty = util.el('div', { class: 'lyrics__empty' });
      empty.innerHTML = Aura.icon('mic', { size: 26, stroke: 1.5 }) +
        '<span>' + util.escapeHtml(message || '这首歌暂时没有歌词') + '</span>';
      inner.appendChild(empty);
    }

    function setLines(nextLines, opts) {
      opts = opts || {};
      lines = nextLines || [];
      activeIndex = -1;
      inner.innerHTML = '';
      nodes = [];

      if (!lines.length) {
        renderEmpty(opts.emptyMessage);
        if (!inner.parentNode) scrollEl.appendChild(inner);
        return;
      }

      lines.forEach(function (line, index) {
        var node = util.el('div', { class: 'lyric-line', dataset: { index: String(index) } });
        var text = line.text || '·';
        var html = util.escapeHtml(text);
        if (line.trans && opts.showTranslation !== false) {
          html += '<span class="lyric-line__trans">' + util.escapeHtml(line.trans) + '</span>';
        }
        node.innerHTML = html;
        node.style.setProperty('--i', String(Math.min(index, 14)));
        inner.appendChild(node);
        nodes.push(node);
      });

      if (!inner.parentNode) scrollEl.appendChild(inner);
      scrollEl.scrollTop = 0;
    }

    function updateActive(index) {
      if (index === activeIndex) return;
      activeIndex = index;

      nodes.forEach(function (node, i) {
        node.classList.toggle('is-active', i === index);
        node.classList.toggle('is-past', i < index);
      });

      var target = nodes[index];
      if (!target || !autoScroll) return;

      // 让当前行居中：目标位置 = 行中心 - 容器一半
      var top = target.offsetTop - scrollEl.clientHeight / 2 + target.offsetHeight / 2;
      scrollEl.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }

    function getLineTime(index) {
      return lines[index] ? lines[index].time : null;
    }

    function destroy() {
      clearTimeout(resumeTimer);
      inner.remove();
      nodes = [];
      lines = [];
    }

    scrollEl.appendChild(inner);

    return {
      setLines: setLines,
      updateActive: updateActive,
      getLineTime: getLineTime,
      destroy: destroy,
      get lines() { return lines; },
    };
  }

  Aura.lyrics = {
    parseLrc: parseLrc,
    build: build,
    findIndex: findIndex,
    mergeTranslation: mergeTranslation,
    createView: createView,
  };
})(window.Aura = window.Aura || {});
