import { createEditHistory } from './edit-history.js';

function snapshotFromNote(note) {
  return { title: String(note?.title ?? ''), body: String(note?.body ?? '') };
}

export function createNoteEditSession(options) {
  const history = options.history ?? createEditHistory();

  function activeNote() {
    return options.getActiveNote();
  }

  function notify() {
    const note = activeNote();
    const next = note ? history.status(note.id) : { canUndo: false, canRedo: false };
    options.onStatusChange?.(next);
    return next;
  }

  function seedCurrent() {
    const note = activeNote();
    if (note) history.seed(note.id, snapshotFromNote(note));
    return notify();
  }

  function commit(kind, timestamp = Date.now()) {
    const note = activeNote();
    if (!note) return notify();
    history.commit(note.id, snapshotFromNote(note), { kind, timestamp });
    return notify();
  }

  async function move(direction) {
    const note = activeNote();
    if (!note) return false;
    const snapshot = direction === 'undo' ? history.undo(note.id) : history.redo(note.id);
    if (!snapshot) {
      notify();
      return false;
    }
    await options.applySnapshot(snapshot, direction);
    notify();
    return true;
  }

  return {
    seedCurrent,
    commit,
    undo: () => move('undo'),
    redo: () => move('redo'),
    status: notify,
    breakMerge: noteId => history.breakMerge(noteId),
    clear: noteId => history.clear(noteId),
  };
}
