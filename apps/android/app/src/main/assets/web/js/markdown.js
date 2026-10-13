/* Small, dependency-free Markdown renderer for persisted chat messages. */
(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHref(value) {
    const href = String(value || '').trim();
    if (href.startsWith('#')) return href;
    try {
      const parsed = new URL(href);
      return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? href : '';
    } catch {
      return '';
    }
  }

  function inline(source) {
    const text = String(source || '');
    const pattern = /(`[^`\n]+`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_)/g;
    let html = '';
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      html += escapeHtml(text.slice(cursor, match.index));
      const token = match[0];
      if (token.startsWith('`')) {
        html += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
      } else if (match[2] !== undefined) {
        const href = safeHref(match[3]);
        html += href
          ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inline(match[2])}</a>`
          : escapeHtml(match[2]);
      } else if (match[4] !== undefined || match[5] !== undefined) {
        html += `<strong>${inline(match[4] ?? match[5])}</strong>`;
      } else {
        html += `<em>${inline(match[6] ?? match[7])}</em>`;
      }
      cursor = pattern.lastIndex;
    }
    return (html + escapeHtml(text.slice(cursor))).replace(/\n/g, '<br>');
  }

  function cells(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  }

  function isTableDivider(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || '');
  }

  function startsBlock(lines, index) {
    const line = lines[index] || '';
    return /^\s*```/.test(line) || /^\s{0,3}#{1,6}\s+/.test(line) || /^\s*>\s?/.test(line)
      || /^\s*[-+*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)
      || (line.includes('|') && isTableDivider(lines[index + 1]));
  }

  function render(source) {
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      if (!line.trim()) { i += 1; continue; }

      const fence = line.match(/^\s*```\s*([\w-]+)?\s*$/);
      if (fence) {
        const body = [];
        i += 1;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
        if (i < lines.length) i += 1;
        const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : '';
        out.push(`<pre><code${language}>${escapeHtml(body.join('\n'))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }

      if (line.includes('|') && isTableDivider(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push(`<div class="md-table-wrap"><table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push(`<blockquote>${inline(quote.join('\n'))}</blockquote>`);
        continue;
      }

      const listMatch = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
      if (listMatch) {
        const ordered = /^\d/.test(listMatch[1]);
        const tag = ordered ? 'ol' : 'ul';
        const items = [];
        while (i < lines.length) {
          const item = lines[i].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
          if (!item || /^\d/.test(item[1]) !== ordered) break;
          items.push(item[2]);
          i += 1;
        }
        out.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
        continue;
      }

      const paragraph = [line];
      i += 1;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) paragraph.push(lines[i++]);
      out.push(`<p>${inline(paragraph.join('\n'))}</p>`);
    }
    return out.join('');
  }

  function renderInto(element, source) {
    element.innerHTML = render(source);
  }

  global.YachiyoMarkdown = { render, renderInto };
})(window);
