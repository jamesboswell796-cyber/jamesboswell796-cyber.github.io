export function noteContentEqual(left, right) {
  return left?.id === right?.id && left?.title === right?.title && left?.body === right?.body;
}

export function revisionMap(state) {
  return new Map((state?.notes ?? []).map(note => [note.id, Math.max(0, Number(note.revision) || 0)]));
}

export function keepLocalActive(canonical, local, { preserveDirty = false } = {}) {
  const preferredId = local?.activeNoteId;
  const next = structuredClone(canonical);
  if (!preferredId || !next.notes.some(note => note.id === preferredId)) return next;
  next.activeNoteId = preferredId;
  if (preserveDirty) {
    const localNote = local.notes.find(note => note.id === preferredId);
    const index = next.notes.findIndex(note => note.id === preferredId);
    if (localNote && index >= 0) next.notes[index] = structuredClone(localNote);
  }
  return next;
}
