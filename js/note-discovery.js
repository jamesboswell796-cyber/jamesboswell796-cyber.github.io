import { markdownBlocks } from './markdown.js';

function normalizeSearchText(value) {
  return String(value ?? '').toLocaleLowerCase('zh-CN').replace(/\s+/gu, '');
}

export function createNoteExcerpt(body, limit = 72) {
  const parts = markdownBlocks(body)
    .filter(block => block.type !== 'hr')
    .map(block => String(block.text ?? '').trim())
    .filter(Boolean);
  const text = parts.join(' · ') || '空白笔记';
  const maximum = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 72;
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text;
}

export function filterNotes(notes, query) {
  const needle = normalizeSearchText(query);
  if (!needle) return [...(notes ?? [])];
  return (notes ?? []).filter(note => normalizeSearchText(`${note?.title ?? ''}\n${note?.body ?? ''}`).includes(needle));
}
