import {
  appendInlineNodes,
  detectBlockShortcut,
  inlineTokensToMarkdown,
  markdownDocumentToMarkdown,
  parseInlineMarkdown,
  parseMarkdownDocument,
} from './markdown.js';

const INLINE_PATTERN = /(\*\*([^*\n]+)\*\*|`([^`\n]+)`|(?<!\*)\*([^*\n]+)\*(?!\*))/gu;
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'LI']);
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function documentFor(node) {
  return node?.ownerDocument ?? globalThis.document;
}

function windowFor(node) {
  return documentFor(node)?.defaultView ?? globalThis.window;
}

export function normalizeEditorMarkdown(source) {
  return markdownDocumentToMarkdown(parseMarkdownDocument(source));
}

export function visibleOffsetFromMarkdown(source, rawOffset) {
  const value = String(source ?? '');
  const limit = Math.max(0, Math.min(Number(rawOffset) || 0, value.length));
  let visible = 0;
  let cursor = 0;
  for (const match of value.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (limit <= start) return visible + Math.max(0, limit - cursor);
    visible += start - cursor;
    const content = match[2] ?? match[3] ?? match[4] ?? '';
    const markerLength = match[2] !== undefined ? 2 : 1;
    if (limit < end) {
      return visible + Math.max(0, Math.min(content.length, limit - start - markerLength));
    }
    visible += content.length;
    cursor = end;
  }
  return visible + Math.max(0, limit - cursor);
}

function createInlineFragment(tokens, doc) {
  const fragment = doc.createDocumentFragment();
  appendInlineNodes(fragment, tokens);
  return fragment;
}

function createTextBlock(tagName, inline, doc) {
  const element = doc.createElement(tagName);
  const fragment = createInlineFragment(inline, doc);
  element.appendChild(fragment);
  if (!element.textContent) element.appendChild(doc.createElement('br'));
  return element;
}

function renderMarkdownInto(element, markdown) {
  const doc = documentFor(element);
  const nodes = [];
  for (const block of parseMarkdownDocument(markdown)) {
    if (block.type === 'blank') {
      nodes.push(createTextBlock('p', [], doc));
      continue;
    }
    if (block.type === 'hr') {
      nodes.push(doc.createElement('hr'));
      continue;
    }
    if (block.type === 'ul' || block.type === 'ol') {
      const list = doc.createElement(block.type);
      if (block.type === 'ol' && block.start !== 1) list.start = block.start;
      for (const item of block.items) list.appendChild(createTextBlock('li', item, doc));
      nodes.push(list);
      continue;
    }
    const tagName = block.type === 'blockquote' ? 'blockquote' : block.type;
    nodes.push(createTextBlock(tagName, block.inline, doc));
  }
  if (!nodes.length) nodes.push(createTextBlock('p', [], doc));
  element.replaceChildren(...nodes);
}

function serializeInlineNode(node) {
  if (node.nodeType === TEXT_NODE) return node.nodeValue ?? '';
  if (node.nodeType !== ELEMENT_NODE) return '';
  const tag = node.tagName;
  if (tag === 'BR') return '';
  const content = [...node.childNodes].map(serializeInlineNode).join('');
  if (tag === 'STRONG' || tag === 'B') return `**${content}**`;
  if (tag === 'EM' || tag === 'I') return `*${content}*`;
  if (tag === 'CODE') return `\`${content}\``;
  return content;
}

function serializeInlineElement(element) {
  return [...element.childNodes].map(serializeInlineNode).join('');
}

function serializeEditor(element) {
  const lines = [];
  for (const node of element.childNodes) {
    if (node.nodeType === TEXT_NODE) {
      lines.push(node.nodeValue ?? '');
      continue;
    }
    if (node.nodeType !== ELEMENT_NODE) continue;
    const tag = node.tagName;
    if (tag === 'HR') {
      lines.push('---');
      continue;
    }
    if (tag === 'UL' || tag === 'OL') {
      const start = tag === 'OL' ? Number(node.getAttribute('start') || 1) : 1;
      [...node.children].filter(child => child.tagName === 'LI').forEach((item, index) => {
        const prefix = tag === 'UL' ? '- ' : `${start + index}. `;
        lines.push(prefix + serializeInlineElement(item));
      });
      continue;
    }
    const value = serializeInlineElement(node);
    if (tag === 'H1') lines.push(`# ${value}`);
    else if (tag === 'H2') lines.push(`## ${value}`);
    else if (tag === 'H3') lines.push(`### ${value}`);
    else if (tag === 'BLOCKQUOTE') lines.push(`> ${value}`);
    else lines.push(value);
  }
  while (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines.length === 1 && lines[0] === '' ? '' : lines.join('\n');
}

function selectionWithin(element) {
  const selection = windowFor(element).getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return element.contains(range.commonAncestorContainer) ? selection : null;
}

function closestBlock(element, node) {
  let current = node?.nodeType === ELEMENT_NODE ? node : node?.parentElement;
  while (current && current !== element) {
    if (BLOCK_TAGS.has(current.tagName)) return current;
    current = current.parentElement;
  }
  return null;
}

function currentBlock(element) {
  const selection = selectionWithin(element);
  return selection ? closestBlock(element, selection.anchorNode) : null;
}

export function blockTypeFromElement(block) {
  if (!block) return null;
  if (block.tagName === 'LI') {
    if (block.parentElement?.tagName === 'UL') return 'ul';
    if (block.parentElement?.tagName === 'OL') return 'ol';
    return null;
  }
  const types = { P: 'p', DIV: 'p', H1: 'h1', H2: 'h2', H3: 'h3', BLOCKQUOTE: 'blockquote' };
  return types[block.tagName] ?? null;
}

function placeCaretAtEnd(element) {
  const doc = documentFor(element);
  const range = doc.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = windowFor(element).getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtTextOffset(element, targetOffset) {
  const doc = documentFor(element);
  const win = windowFor(element);
  const walker = doc.createTreeWalker(element, win.NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, targetOffset);
  let node = walker.nextNode();
  while (node) {
    const length = node.nodeValue?.length ?? 0;
    if (remaining <= length) {
      const range = doc.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const selection = win.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= length;
    node = walker.nextNode();
  }
  placeCaretAtEnd(element);
}

function markdownOffsetAtSelection(block, selection) {
  if (!selection?.rangeCount) return serializeInlineElement(block).length;
  const targetNode = selection.anchorNode;
  const targetOffset = selection.anchorOffset;
  let offset = 0;
  let found = false;

  function visit(node) {
    if (found) return;
    if (node === targetNode) {
      if (node.nodeType === TEXT_NODE) offset += Math.min(targetOffset, node.nodeValue?.length ?? 0);
      else {
        const children = [...node.childNodes].slice(0, targetOffset);
        offset += children.map(serializeInlineNode).join('').length;
      }
      found = true;
      return;
    }
    if (node.nodeType === TEXT_NODE) {
      offset += node.nodeValue?.length ?? 0;
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const tag = node.tagName;
    const markerLength = tag === 'STRONG' || tag === 'B' ? 2 : tag === 'EM' || tag === 'I' || tag === 'CODE' ? 1 : 0;
    offset += markerLength;
    for (const child of node.childNodes) visit(child);
    if (!found) offset += markerLength;
  }

  for (const child of block.childNodes) visit(child);
  return offset;
}

function containsLiteralInlineShortcut(block) {
  const doc = documentFor(block);
  const walker = doc.createTreeWalker(block, windowFor(block).NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parentTag = node.parentElement?.tagName;
    if (!['STRONG', 'B', 'EM', 'I', 'CODE'].includes(parentTag) && /(\*\*[^*\n]+\*\*|`[^`\n]+`|(?<!\*)\*[^*\n]+\*(?!\*))/u.test(node.nodeValue ?? '')) return true;
    node = walker.nextNode();
  }
  return false;
}

function replaceBlockForShortcut(root, block, shortcut) {
  const doc = documentFor(root);
  const inline = parseInlineMarkdown(shortcut.content);
  if (shortcut.type === 'ul' || shortcut.type === 'ol') {
    const list = doc.createElement(shortcut.type);
    const item = createTextBlock('li', inline, doc);
    list.appendChild(item);
    block.replaceWith(list);
    placeCaretAtEnd(item);
    return true;
  }
  const tag = shortcut.type === 'blockquote' ? 'blockquote' : shortcut.type;
  const replacement = createTextBlock(tag, inline, doc);
  block.replaceWith(replacement);
  placeCaretAtEnd(replacement);
  return true;
}

function appendTail(block, tail) {
  if (tail?.childNodes?.length) block.appendChild(tail);
  if (!block.textContent && !block.querySelector('br')) block.appendChild(documentFor(block).createElement('br'));
}

function insertPlainText(element, text) {
  const doc = documentFor(element);
  let selection = selectionWithin(element);
  if (!selection) {
    element.focus({ preventScroll: true });
    placeCaretAtEnd(element);
    selection = selectionWithin(element);
  }
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  const startBlock = closestBlock(element, range.startContainer);
  const endBlock = closestBlock(element, range.endContainer);
  if (!startBlock || startBlock !== endBlock) return false;

  range.deleteContents();
  const tailRange = doc.createRange();
  tailRange.setStart(range.endContainer, range.endOffset);
  tailRange.selectNodeContents(startBlock);
  tailRange.setStart(range.endContainer, range.endOffset);
  const tail = tailRange.extractContents();
  const lines = String(text ?? '').replace(/\r\n?/gu, '\n').split('\n');
  const firstNode = doc.createTextNode(lines[0] ?? '');
  range.insertNode(firstNode);
  let caretNode = firstNode;
  let caretOffset = firstNode.nodeValue?.length ?? 0;
  let lastBlock = startBlock;

  for (const line of lines.slice(1)) {
    const tagName = startBlock.tagName === 'LI' ? 'li' : 'p';
    const block = doc.createElement(tagName);
    const textNode = doc.createTextNode(line);
    block.appendChild(textNode);
    if (!line) block.appendChild(doc.createElement('br'));
    if (startBlock.tagName === 'LI') lastBlock.after(block);
    else (lastBlock.parentElement === element ? lastBlock : startBlock).after(block);
    lastBlock = block;
    caretNode = textNode;
    caretOffset = textNode.nodeValue?.length ?? 0;
  }

  appendTail(lastBlock, tail);
  const caret = doc.createRange();
  caret.setStart(caretNode, caretOffset);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  return true;
}

export function createRichMarkdownEditor({ element, onChange = () => {}, onSelectionContextChange = () => {} }) {
  if (!element) throw new Error('Rich editor element is required');
  let composing = false;
  let destroyed = false;
  let lastBlockType;
  let lastSelectionRange = null;

  function rememberSelection() {
    const selection = selectionWithin(element);
    if (selection?.rangeCount) lastSelectionRange = selection.getRangeAt(0).cloneRange();
  }

  function restoreSelection() {
    if (!lastSelectionRange?.commonAncestorContainer?.isConnected) return false;
    const selection = windowFor(element).getSelection();
    selection.removeAllRanges();
    selection.addRange(lastSelectionRange.cloneRange());
    return true;
  }

  function getCurrentBlockType() {
    const block = currentBlock(element)
      ?? (lastSelectionRange?.commonAncestorContainer?.isConnected
        ? closestBlock(element, lastSelectionRange.startContainer)
        : null);
    return blockTypeFromElement(block);
  }

  function emitSelectionContext(force = false) {
    if (destroyed) return;
    const blockType = getCurrentBlockType();
    if (!force && blockType === lastBlockType) return;
    lastBlockType = blockType;
    onSelectionContextChange({ blockType, composing });
  }

  function emitChange(kind = 'body-typing') {
    const markdown = serializeEditor(element);
    element.dataset.empty = markdown.trim() ? 'false' : 'true';
    if (!destroyed) onChange(markdown, { kind });
    emitSelectionContext();
  }

  function processInput(kind = 'body-typing') {
    if (composing || destroyed) return;
    const block = currentBlock(element);
    if (block && ['P', 'DIV'].includes(block.tagName)) {
      const shortcut = detectBlockShortcut(block.textContent ?? '');
      if (shortcut) {
        replaceBlockForShortcut(element, block, shortcut);
        emitChange(kind);
        return;
      }
    }
    const inlineBlock = currentBlock(element);
    if (inlineBlock && containsLiteralInlineShortcut(inlineBlock)) {
      const selection = selectionWithin(element);
      const raw = serializeInlineElement(inlineBlock);
      const rawOffset = markdownOffsetAtSelection(inlineBlock, selection);
      const visibleOffset = visibleOffsetFromMarkdown(raw, rawOffset);
      inlineBlock.replaceChildren(createInlineFragment(parseInlineMarkdown(raw), documentFor(inlineBlock)));
      placeCaretAtTextOffset(inlineBlock, visibleOffset);
    }
    emitChange(kind);
  }

  function handleKeydown(event) {
    if (event.key === 'Enter') {
      const block = currentBlock(element);
      if (block && ['P', 'DIV'].includes(block.tagName) && (block.textContent ?? '').trim() === '---') {
        event.preventDefault();
        const doc = documentFor(element);
        const rule = doc.createElement('hr');
        const paragraph = createTextBlock('p', [], doc);
        block.replaceWith(rule, paragraph);
        placeCaretAtEnd(paragraph);
        emitChange('format');
        return;
      }
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'b' || key === 'i') {
        event.preventDefault();
        documentFor(element).execCommand(key === 'b' ? 'bold' : 'italic');
        emitChange('format');
      }
    }
  }

  function handlePaste(event) {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    let text;
    try {
      text = clipboard.getData('text/plain');
    } catch {
      return;
    }
    if (typeof text !== 'string' || (!text && !Array.from(clipboard.types ?? []).includes('text/plain'))) return;
    if (!insertPlainText(element, text)) return;
    event.preventDefault();
    processInput('paste');
  }

  const listeners = [
    ['input', () => processInput('body-typing')],
    ['keydown', handleKeydown],
    ['keyup', () => { rememberSelection(); emitSelectionContext(); }],
    ['click', () => { rememberSelection(); emitSelectionContext(); }],
    ['focus', () => { rememberSelection(); emitSelectionContext(true); }],
    ['paste', handlePaste],
    ['compositionstart', () => { composing = true; emitSelectionContext(true); }],
    ['compositionend', () => { composing = false; processInput('body-typing'); emitSelectionContext(true); }],
  ];
  listeners.forEach(([type, listener]) => element.addEventListener(type, listener));
  const selectionListener = () => {
    if (selectionWithin(element)) {
      rememberSelection();
      emitSelectionContext();
    }
  };
  documentFor(element).addEventListener('selectionchange', selectionListener);

  function load(markdown, { focus = false } = {}) {
    const normalized = normalizeEditorMarkdown(markdown);
    renderMarkdownInto(element, normalized);
    lastSelectionRange = null;
    element.dataset.empty = normalized.trim() ? 'false' : 'true';
    emitSelectionContext(true);
    if (focus) {
      element.focus({ preventScroll: true });
      windowFor(element).requestAnimationFrame(() => placeCaretAtEnd(element));
    }
  }

  function applyBlock(type) {
    if (composing) return false;
    element.focus({ preventScroll: true });
    if (!restoreSelection()) placeCaretAtEnd(element);
    const commands = {
      p: ['formatBlock', 'p'],
      h1: ['formatBlock', 'h1'],
      h2: ['formatBlock', 'h2'],
      h3: ['formatBlock', 'h3'],
      blockquote: ['formatBlock', 'blockquote'],
      ul: ['insertUnorderedList'],
      ol: ['insertOrderedList'],
    };
    const [command, value] = commands[type] ?? [];
    if (!command) return false;
    documentFor(element).execCommand(command, false, value);
    processInput('format');
    emitSelectionContext(true);
    return true;
  }

  function insertDivider() {
    if (composing) return false;
    element.focus({ preventScroll: true });
    if (!restoreSelection()) placeCaretAtEnd(element);
    const block = currentBlock(element);
    if (!block) return false;
    const doc = documentFor(element);
    const anchor = block.closest?.('ul, ol') ?? block;
    const rule = doc.createElement('hr');
    const paragraph = createTextBlock('p', [], doc);
    anchor.after(rule, paragraph);
    placeCaretAtEnd(paragraph);
    processInput('format');
    emitSelectionContext(true);
    return true;
  }

  function applyInline(type) {
    element.focus({ preventScroll: true });
    if (!restoreSelection()) placeCaretAtEnd(element);
    const command = type === 'strong' ? 'bold' : type === 'em' ? 'italic' : null;
    if (command) {
      documentFor(element).execCommand(command);
      processInput('format');
      return;
    }
    if (type !== 'code') return;
    const selection = selectionWithin(element);
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const anchorBlock = closestBlock(element, selection.anchorNode);
    const focusBlock = closestBlock(element, selection.focusNode);
    if (!anchorBlock || anchorBlock !== focusBlock) return;
    const doc = documentFor(element);
    const range = selection.getRangeAt(0);
    const code = doc.createElement('code');
    try {
      range.surroundContents(code);
    } catch {
      code.append(range.extractContents());
      range.insertNode(code);
    }
    const nextRange = doc.createRange();
    nextRange.selectNodeContents(code);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    processInput('format');
  }

  return {
    load,
    getMarkdown: () => serializeEditor(element),
    focusEnd: () => { element.focus(); placeCaretAtEnd(element); },
    applyBlock,
    applyInline,
    insertDivider,
    getCurrentBlockType,
    isComposing: () => composing,
    destroy() {
      destroyed = true;
      listeners.forEach(([type, listener]) => element.removeEventListener(type, listener));
      documentFor(element).removeEventListener('selectionchange', selectionListener);
    },
  };
}
