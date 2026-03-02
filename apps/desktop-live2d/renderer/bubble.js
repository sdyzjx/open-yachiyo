(function bubbleWindowMain() {
  const bridge = window.desktopLive2dBridge;
  const bubbleElement = document.getElementById('bubble');
  let measureRaf = 0;
  let delayedMeasureTimer = null;

  // Default truncate config (will be overridden by actual config)
  const defaultTruncateConfig = {
    enabled: true,
    maxLength: 120,
    mode: 'smart',
    suffix: '...',
    showHintForComplex: true
  };

  function detectComplexContent(text) {
    // Detect mermaid code blocks, LaTeX display formulas, or markdown tables
    return /```[\s\S]*?```|\$\$[\s\S]+?\$\$|\n\|.*\|.*\n/.test(text);
  }

  function smartTruncate(text, maxLength, suffix) {
    // Use Array.from to handle emoji and multi-byte characters correctly
    const chars = Array.from(text);
    if (chars.length <= maxLength) {
      return text;
    }

    // Check for unclosed markdown syntax
    const boldCount = (text.match(/\*\*/g) || []).length;
    const italicCount = (text.match(/(?<!\*)\*(?!\*)/g) || []).length;
    const dollarCount = (text.match(/\$/g) || []).length;

    // If we have unclosed syntax, try to find a safe truncation point
    let truncateAt = maxLength;

    // Try to preserve word boundaries
    const textUpToMax = chars.slice(0, maxLength).join('');
    const lastSpace = textUpToMax.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.8) {
      truncateAt = lastSpace;
    }

    // Check if we're truncating inside a formula
    const textUpToTruncate = chars.slice(0, truncateAt).join('');
    const dollarsBeforeTruncate = (textUpToTruncate.match(/\$/g) || []).length;
    if (dollarsBeforeTruncate % 2 !== 0) {
      // We're inside a formula, try to find the closing $
      const nextDollar = text.indexOf('$', truncateAt);
      if (nextDollar > 0 && nextDollar < maxLength * 1.2) {
        truncateAt = nextDollar + 1;
      }
    }

    return chars.slice(0, truncateAt).join('').trimEnd() + suffix;
  }

  function truncateMessage(text, config) {
    if (!config || !config.enabled || config.mode === 'disabled') {
      return text;
    }

    // Check for complex content
    const hasComplexSyntax = detectComplexContent(text);
    if (hasComplexSyntax && config.showHintForComplex) {
      return '📊 内容包含图表或公式，请查看聊天面板';
    }

    // Simple truncation
    if (config.mode === 'simple') {
      const chars = Array.from(text);
      return chars.length > config.maxLength
        ? chars.slice(0, config.maxLength).join('') + config.suffix
        : text;
    }

    // Smart truncation
    if (config.mode === 'smart') {
      return smartTruncate(text, config.maxLength, config.suffix);
    }

    return text;
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

    if (!bubbleElement) {
      return;
    }
    if (!visible) {
      bubbleElement.classList.remove('visible', 'streaming');
      bubbleElement.textContent = '';
      return;
    }

    let text = String(payload?.text || '');

    // Apply truncation based on config
    const truncateConfig = payload?.truncateConfig || defaultTruncateConfig;
    text = truncateMessage(text, truncateConfig);

    // Render LaTeX and markdown for bubble (inline only, no complex structures)
    if (typeof marked !== 'undefined' && text) {
      try {
        // First render LaTeX formulas
        let processedText = text;
        if (typeof katex !== 'undefined') {
          // Inline math only for bubble
          processedText = text.replace(/\$([^\$\n]+?)\$/g, (match, formula) => {
            try {
              return katex.renderToString(formula.trim(), {
                displayMode: false,
                throwOnError: false
              });
            } catch (err) {
              console.error('KaTeX inline math error:', err);
              return match;
            }
          });
        }

        const html = marked.parseInline(processedText);
        bubbleElement.innerHTML = html;
      } catch (err) {
        console.error('Bubble markdown parse error:', err);
        bubbleElement.textContent = text;
      }
    } else {
      bubbleElement.textContent = text;
    }

    bubbleElement.classList.add('visible');

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
    });
  }

  bridge?.onBubbleStateSync?.((payload) => {
    applyBubbleState(payload);
  });
})();
