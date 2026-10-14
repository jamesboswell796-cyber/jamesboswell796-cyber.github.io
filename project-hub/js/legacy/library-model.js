// Minimal comparator retained for compatibility with the Project Hub model.
export function comparePromptsByMode(a, b, mode = 'updated') {
  const field = mode === 'created' ? 'createdAt' : mode === 'used' ? 'lastCopiedAt' : 'updatedAt';
  const time = row => { const t = Date.parse(row?.[field] || ''); return Number.isFinite(t) ? t : 0; };
  if (mode === 'pinned' && Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
  return time(b) - time(a) || String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
    || String(a.id || '').localeCompare(String(b.id || ''));
}
