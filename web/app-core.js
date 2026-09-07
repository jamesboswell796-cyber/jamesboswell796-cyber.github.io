export function sourceForEdit(note) {
  return String(note?.body ?? '');
}

export function copyPayload(note) {
  return sourceForEdit(note);
}

export function filterShelfNotes(notes, query) {
  const needle = String(query ?? '').trim().toLocaleLowerCase();
  const list = Array.isArray(notes) ? notes : [];
  if (!needle) return [...list];
  return list.filter(note => `${note?.title ?? ''}\n${note?.body ?? ''}`.toLocaleLowerCase().includes(needle));
}

export function nextViewAfterNewNote() {
  return 'edit';
}

function clampOffset(value, length) {
  return Math.max(0, Math.min(Number(value) || 0, length));
}

export function formatWrappedSource(source, start, end, marker) {
  const value = String(source ?? '');
  const token = String(marker ?? '');
  const left = clampOffset(start, value.length);
  const right = Math.max(left, clampOffset(end, value.length));
  const selected = value.slice(left, right);
  return {
    source: `${value.slice(0, left)}${token}${selected}${token}${value.slice(right)}`,
    selectionStart: left + token.length,
    selectionEnd: left + token.length + selected.length,
  };
}

export function formatPrefixedLines(source, start, end, prefix) {
  const value = String(source ?? '');
  const token = String(prefix ?? '');
  const left = clampOffset(start, value.length);
  const right = Math.max(left, clampOffset(end, value.length));
  const lineStart = value.lastIndexOf('\n', Math.max(0, left - 1)) + 1;
  const nextBreak = value.indexOf('\n', right);
  const lineEnd = nextBreak < 0 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const replacement = lines
    .map((line, index) => token === '1. ' ? `${index + 1}. ${line}` : `${token}${line}`)
    .join('\n');
  return {
    source: `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + replacement.length,
  };
}

export function insertSourceText(source, start, end, text) {
  const value = String(source ?? '');
  const insertion = String(text ?? '');
  const left = clampOffset(start, value.length);
  const right = Math.max(left, clampOffset(end, value.length));
  const caret = left + insertion.length;
  return {
    source: `${value.slice(0, left)}${insertion}${value.slice(right)}`,
    selectionStart: caret,
    selectionEnd: caret,
  };
}
