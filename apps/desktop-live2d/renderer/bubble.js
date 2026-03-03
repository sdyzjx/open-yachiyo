(function bubbleWindowMain() {
  const bridge = window.desktopLive2dBridge;
  const bubbleElement = document.getElementById('bubble');
  const bubbleLinesElement = document.getElementById('bubble-lines');
  let measureRaf = 0;
  let delayedMeasureTimer = null;
  let clearHiddenTimer = null;
  const lineNodes = new Map();
  const LINE_TRANSITION_MS = 110;

  function stripMarkdown(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/```([\s\S]*?)```/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/^>\s?/gm, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\$\$([\s\S]+?)\$\$/g, '$1')
      .replace(/\$([^$\n]+?)\$/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function normalizeBubbleLines(payload) {
    const rawLines = Array.isArray(payload?.lines) ? payload.lines : null;
    if (rawLines && rawLines.length > 0) {
      return rawLines
        .map((item, index) => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const id = String(item.id || `line-${index}`);
            const text = stripMarkdown(item.text || '');
            return { id, text };
          }
          const id = `line-${index}`;
          const text = stripMarkdown(item || '');
          return { id, text };
        })
        .filter((item) => item.text);
    }

    const plainText = stripMarkdown(payload?.text || '');
    if (!plainText) {
      return [];
    }
    return plainText
      .split('\n')
      .map((text, index) => ({
        id: `fallback-${index}`,
        text: stripMarkdown(text || '')
      }))
      .filter((item) => item.text);
  }

  function clearBubbleLines() {
    if (!bubbleLinesElement) {
      return;
    }
    for (const node of lineNodes.values()) {
      try {
        node.remove();
      } catch {}
    }
    lineNodes.clear();
    bubbleLinesElement.textContent = '';
  }

  function renderBubbleLines(lines) {
    if (!bubbleLinesElement) {
      return;
    }
    const nextIds = new Set(lines.map((line) => String(line.id)));
    const orderedNodes = [];

    for (const line of lines) {
      const id = String(line.id);
      let node = lineNodes.get(id);
      if (!node) {
        node = document.createElement('div');
        node.className = 'bubble-line line-enter';
        node.textContent = line.text;
        lineNodes.set(id, node);
        requestAnimationFrame(() => {
          node.classList.remove('line-enter');
        });
      } else {
        node.textContent = line.text;
        node.dataset.exiting = '0';
        node.classList.remove('line-exit');
      }
      orderedNodes.push(node);
    }

    // Keep DOM order stable with minimal moves to avoid text jitter.
    let cursor = bubbleLinesElement.firstChild;
    for (const node of orderedNodes) {
      if (node === cursor) {
        cursor = cursor.nextSibling;
        continue;
      }
      bubbleLinesElement.insertBefore(node, cursor || null);
    }

    for (const [id, node] of lineNodes.entries()) {
      if (nextIds.has(id)) {
        continue;
      }
      if (node.dataset.exiting === '1') {
        continue;
      }
      node.dataset.exiting = '1';
      node.classList.add('line-exit');
      setTimeout(() => {
        if (node.dataset.exiting !== '1') {
          return;
        }
        lineNodes.delete(id);
        try {
          node.remove();
        } catch {}
      }, LINE_TRANSITION_MS);
    }
  }

  function scheduleBubbleMetricsSync() {
    if (!bubbleElement || typeof bridge?.sendBubbleMetrics !== 'function') {
      return;
    }
    if (!bubbleElement.classList.contains('visible')) {
      return;
    }
    if (measureRaf) {
      cancelAnimationFrame(measureRaf);
    }
    measureRaf = requestAnimationFrame(() => {
      measureRaf = 0;
      const rect = bubbleElement.getBoundingClientRect();
      const width = Math.max(80, Math.ceil(rect.width));
      const height = Math.max(36, Math.ceil(rect.height));
      bridge.sendBubbleMetrics({ width, height });
    });
  }

  function scheduleDelayedBubbleMetricsSync() {
    if (delayedMeasureTimer) {
      clearTimeout(delayedMeasureTimer);
    }
    delayedMeasureTimer = setTimeout(() => {
      delayedMeasureTimer = null;
      scheduleBubbleMetricsSync();
    }, 60);
  }

  function applyBubbleState(payload) {
    const visible = Boolean(payload?.visible);
    const streaming = Boolean(payload?.streaming);

    if (!bubbleElement || !bubbleLinesElement) {
      return;
    }

    if (!visible) {
      bubbleElement.classList.remove('visible', 'streaming', 'pop-in');
      if (clearHiddenTimer) {
        clearTimeout(clearHiddenTimer);
      }
      clearHiddenTimer = setTimeout(() => {
        clearHiddenTimer = null;
        clearBubbleLines();
      }, 180);
      return;
    }

    if (clearHiddenTimer) {
      clearTimeout(clearHiddenTimer);
      clearHiddenTimer = null;
    }

    const wasVisible = bubbleElement.classList.contains('visible');
    const lines = normalizeBubbleLines(payload);
    renderBubbleLines(lines);

    bubbleElement.classList.add('visible');
    if (!wasVisible) {
      bubbleElement.classList.remove('pop-in');
      // Force reflow so repeated show still replays animation.
      void bubbleElement.offsetHeight;
      bubbleElement.classList.add('pop-in');
      setTimeout(() => {
        bubbleElement.classList.remove('pop-in');
      }, 140);
    }

    if (streaming) {
      bubbleElement.classList.add('streaming');
    } else {
      bubbleElement.classList.remove('streaming');
    }

    scheduleBubbleMetricsSync();
    scheduleDelayedBubbleMetricsSync();
  }

  if (bubbleElement && typeof ResizeObserver === 'function') {
    const resizeObserver = new ResizeObserver(() => {
      scheduleBubbleMetricsSync();
    });
    resizeObserver.observe(bubbleElement);
    window.addEventListener('beforeunload', () => {
      resizeObserver.disconnect();
      if (delayedMeasureTimer) {
        clearTimeout(delayedMeasureTimer);
        delayedMeasureTimer = null;
      }
      if (clearHiddenTimer) {
        clearTimeout(clearHiddenTimer);
        clearHiddenTimer = null;
      }
      clearBubbleLines();
    });
  }

  bridge?.onBubbleStateSync?.((payload) => {
    applyBubbleState(payload);
  });
})();
