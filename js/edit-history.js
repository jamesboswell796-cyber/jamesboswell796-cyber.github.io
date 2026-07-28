const MERGEABLE_KINDS = new Set(['body-typing', 'title-typing']);

function cloneSnapshot(snapshot) {
  return { title: String(snapshot?.title ?? ''), body: String(snapshot?.body ?? '') };
}

function sameSnapshot(left, right) {
  return left?.title === right?.title && left?.body === right?.body;
}

export function createEditHistory(options = {}) {
  const limit = Math.max(2, Number(options.limit) || 80);
  const mergeWindowMs = Math.max(0, Number(options.mergeWindowMs) || 900);
  const timelines = new Map();

  function timeline(noteId) {
    return timelines.get(String(noteId ?? '')) ?? null;
  }

  function seed(noteId, snapshot) {
    const id = String(noteId ?? '');
    if (!id) return;
    const current = timeline(id);
    const normalized = cloneSnapshot(snapshot);
    if (current && sameSnapshot(current.entries[current.index], normalized)) return;
    timelines.set(id, { entries: [normalized], index: 0, lastKind: null, lastTimestamp: 0 });
  }

  function commit(noteId, snapshot, meta = {}) {
    const id = String(noteId ?? '');
    if (!id) return status(id);
    const normalized = cloneSnapshot(snapshot);
    let current = timeline(id);
    if (!current) {
      seed(id, normalized);
      return status(id);
    }
    if (sameSnapshot(current.entries[current.index], normalized)) return status(id);

    const timestamp = Number(meta.timestamp ?? Date.now());
    const kind = String(meta.kind ?? 'edit');
    const canMerge = current.index === current.entries.length - 1
      && MERGEABLE_KINDS.has(kind)
      && current.lastKind === kind
      && timestamp - current.lastTimestamp <= mergeWindowMs;

    if (canMerge) {
      current.entries[current.index] = normalized;
    } else {
      current.entries = current.entries.slice(0, current.index + 1);
      current.entries.push(normalized);
      if (current.entries.length > limit) current.entries.splice(0, current.entries.length - limit);
      current.index = current.entries.length - 1;
    }
    current.lastKind = kind;
    current.lastTimestamp = timestamp;
    return status(id);
  }

  function move(noteId, delta) {
    const current = timeline(noteId);
    if (!current) return null;
    const nextIndex = current.index + delta;
    if (nextIndex < 0 || nextIndex >= current.entries.length) return null;
    current.index = nextIndex;
    current.lastKind = null;
    current.lastTimestamp = 0;
    return cloneSnapshot(current.entries[current.index]);
  }

  function status(noteId) {
    const current = timeline(noteId);
    return {
      canUndo: Boolean(current && current.index > 0),
      canRedo: Boolean(current && current.index < current.entries.length - 1),
    };
  }

  return {
    seed,
    commit,
    undo: noteId => move(noteId, -1),
    redo: noteId => move(noteId, 1),
    status,
    breakMerge(noteId) {
      const current = timeline(noteId);
      if (!current) return;
      current.lastKind = null;
      current.lastTimestamp = 0;
    },
    clear(noteId) {
      if (noteId === undefined) timelines.clear();
      else timelines.delete(String(noteId));
    },
  };
}
