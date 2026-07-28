const INLINE_PATTERN = /(\*\*([^*\n]+)\*\*|`([^`\n]+)`|(?<!\*)\*([^*\n]+)\*(?!\*))/gu;

export function parseInlineMarkdown(source) {
  const value = String(source ?? '');
  const tokens = [];
  let cursor = 0;
  for (const match of value.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ type: 'text', text: value.slice(cursor, index) });
    if (match[2] !== undefined) tokens.push({ type: 'strong', text: match[2] });
    else if (match[3] !== undefined) tokens.push({ type: 'code', text: match[3] });
    else tokens.push({ type: 'em', text: match[4] });
    cursor = index + match[0].length;
  }
  if (cursor < value.length) tokens.push({ type: 'text', text: value.slice(cursor) });
  return tokens.length ? tokens : [{ type: 'text', text: '' }];
}

export function inlineTokensToMarkdown(tokens) {
  return (tokens ?? []).map(token => {
    if (token.type === 'strong') return `**${token.text}**`;
    if (token.type === 'em') return `*${token.text}*`;
    if (token.type === 'code') return `\`${token.text}\``;
    return token.text ?? '';
  }).join('');
}

export function inlineMarkdownToText(source) {
  return parseInlineMarkdown(source).map(token => token.text).join('');
}

export function detectBlockShortcut(text) {
  const value = String(text ?? '');
  const rules = [
    ['h3', '### '],
    ['h2', '## '],
    ['h1', '# '],
    ['blockquote', '> '],
  ];
  for (const [type, marker] of rules) {
    if (value.startsWith(marker)) return { type, marker, content: value.slice(marker.length) };
  }
  const bullet = value.match(/^([-*+]\s)(.*)$/u);
  if (bullet) return { type: 'ul', marker: bullet[1], content: bullet[2] };
  const ordered = value.match(/^(\d+\.\s)(.*)$/u);
  if (ordered) return { type: 'ol', marker: ordered[1], content: ordered[2] };
  return null;
}

export function parseMarkdownDocument(source) {
  const lines = String(source ?? '').split(/\r?\n/u);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    if (!line.trim()) {
      blocks.push({ type: 'blank' });
      continue;
    }
    if (line.trim() === '---') {
      blocks.push({ type: 'hr' });
      continue;
    }
    let match = line.match(/^###\s+(.+)$/u);
    if (match) {
      blocks.push({ type: 'h3', inline: parseInlineMarkdown(match[1].trim()) });
      continue;
    }
    match = line.match(/^##\s+(.+)$/u);
    if (match) {
      blocks.push({ type: 'h2', inline: parseInlineMarkdown(match[1].trim()) });
      continue;
    }
    match = line.match(/^#\s+(.+)$/u);
    if (match) {
      blocks.push({ type: 'h1', inline: parseInlineMarkdown(match[1].trim()) });
      continue;
    }
    match = line.match(/^>\s+(.+)$/u);
    if (match) {
      blocks.push({ type: 'blockquote', inline: parseInlineMarkdown(match[1].trim()) });
      continue;
    }
    match = line.match(/^[-*+]\s+(.+)$/u);
    if (match) {
      const items = [parseInlineMarkdown(match[1].trim())];
      while (index + 1 < lines.length) {
        const next = lines[index + 1].trimEnd().match(/^[-*+]\s+(.+)$/u);
        if (!next) break;
        items.push(parseInlineMarkdown(next[1].trim()));
        index += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }
    match = line.match(/^(\d+)\.\s+(.+)$/u);
    if (match) {
      const start = Number(match[1]);
      const items = [parseInlineMarkdown(match[2].trim())];
      while (index + 1 < lines.length) {
        const next = lines[index + 1].trimEnd().match(/^\d+\.\s+(.+)$/u);
        if (!next) break;
        items.push(parseInlineMarkdown(next[1].trim()));
        index += 1;
      }
      blocks.push({ type: 'ol', start, items });
      continue;
    }
    blocks.push({ type: 'p', inline: parseInlineMarkdown(line) });
  }
  if (blocks.length === 1 && blocks[0].type === 'blank' && String(source ?? '') === '') return [];
  return blocks;
}

export function markdownDocumentToMarkdown(blocks) {
  const lines = [];
  for (const block of blocks ?? []) {
    if (block.type === 'blank') lines.push('');
    else if (block.type === 'hr') lines.push('---');
    else if (block.type === 'h1') lines.push(`# ${inlineTokensToMarkdown(block.inline)}`);
    else if (block.type === 'h2') lines.push(`## ${inlineTokensToMarkdown(block.inline)}`);
    else if (block.type === 'h3') lines.push(`### ${inlineTokensToMarkdown(block.inline)}`);
    else if (block.type === 'blockquote') lines.push(`> ${inlineTokensToMarkdown(block.inline)}`);
    else if (block.type === 'ul') {
      for (const item of block.items) lines.push(`- ${inlineTokensToMarkdown(item)}`);
    } else if (block.type === 'ol') {
      block.items.forEach((item, offset) => lines.push(`${(block.start ?? 1) + offset}. ${inlineTokensToMarkdown(item)}`));
    } else lines.push(inlineTokensToMarkdown(block.inline));
  }
  return lines.join('\n');
}

export function markdownBlocks(source) {
  const blocks = [];
  for (const block of parseMarkdownDocument(source)) {
    if (block.type === 'blank') continue;
    if (block.type === 'ul' || block.type === 'ol') {
      for (const item of block.items) blocks.push({ type: 'li', text: item.map(token => token.text).join('') });
      continue;
    }
    if (block.type === 'hr') {
      blocks.push({ type: 'hr', text: '' });
      continue;
    }
    blocks.push({ type: block.type, text: (block.inline ?? []).map(token => token.text).join('') });
  }
  return blocks;
}

export function renderMarkdown(container, source) {
  const doc = container.ownerDocument ?? globalThis.document;
  const nodes = [];
  for (const block of parseMarkdownDocument(source)) {
    if (block.type === 'blank') {
      nodes.push(doc.createElement('br'));
      continue;
    }
    if (block.type === 'hr') {
      nodes.push(doc.createElement('hr'));
      continue;
    }
    if (block.type === 'ul' || block.type === 'ol') {
      const list = doc.createElement(block.type);
      if (block.type === 'ol' && block.start !== 1) list.start = block.start;
      for (const inline of block.items) {
        const item = doc.createElement('li');
        appendInlineNodes(item, inline);
        list.appendChild(item);
      }
      nodes.push(list);
      continue;
    }
    const element = doc.createElement(block.type === 'blockquote' ? 'blockquote' : block.type);
    appendInlineNodes(element, block.inline);
    nodes.push(element);
  }
  if (!nodes.length) {
    const empty = doc.createElement('p');
    empty.className = 'preview-empty';
    empty.textContent = '这里还没有内容';
    nodes.push(empty);
  }
  container.replaceChildren(...nodes);
}

export function appendInlineNodes(container, tokens) {
  const doc = container.ownerDocument ?? globalThis.document;
  for (const token of tokens ?? []) {
    const node = token.type === 'strong'
      ? doc.createElement('strong')
      : token.type === 'em'
        ? doc.createElement('em')
        : token.type === 'code'
          ? doc.createElement('code')
          : doc.createTextNode(token.text ?? '');
    if (node.nodeType === 1) node.textContent = token.text ?? '';
    container.appendChild(node);
  }
}
