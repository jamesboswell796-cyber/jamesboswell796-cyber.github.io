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
