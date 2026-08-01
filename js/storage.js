import { createInitialState, normalizeState, normalizeNoteTitle } from './model.js';

export const STATE_KEY = 'quickNotesState';
const LOCK_NAME = 'quickNotesStateWrite';
let fallbackQueue = Promise.resolve();

function clone(value) {
  return structuredClone(value);
}

function sameState(left, right) {
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch { return false; }
}

function sameNoteContent(left, right) {
  return left?.title === right?.title && left?.body === right?.body;
}

async function withLock(task) {
  const locks = globalThis.navigator?.locks;
  if (locks?.request) return locks.request(LOCK_NAME, task);
  const run = fallbackQueue.then(task, task);
  fallbackQueue = run.catch(() => {});
  return run;
}

function conflictTitle(title) {
  const base = normalizeNoteTitle(title);
  return base.endsWith('（冲突副本）') ? base : `${base}（冲突副本）`.slice(0, 80);
}

export function createStorageRepository(storageArea = globalThis.chrome?.storage?.local) {
  if (!storageArea) throw new Error('本地存储不可用');
  const ownRevisions = new Set();

  async function readCanonical() {
    const result = await storageArea.get(STATE_KEY);
    const source = result?.[STATE_KEY];
    const state = source ? normalizeState(source) : createInitialState();
    if (!source || !sameState(source, state)) await storageArea.set({ [STATE_KEY]: state });
    return state;
  }

  async function writeCanonical(state) {
    const normalized = normalizeState(state);
    normalized.stateRevision = Math.max(0, Number(normalized.stateRevision) || 0) + 1;
    ownRevisions.add(normalized.stateRevision);
    try {
      await storageArea.set({ [STATE_KEY]: normalized });
    } finally {
      setTimeout(() => ownRevisions.delete(normalized.stateRevision), 1000);
    }
    return normalized;
  }

  return {
    async getState() {
      return clone(await readCanonical());
    },

    async saveState(state) {
      return withLock(async () => clone(await writeCanonical(state)));
    },

    async saveStateTransform(transform) {
      if (typeof transform !== 'function') throw new Error('状态更新函数无效');
      return withLock(async () => {
        const current = await readCanonical();
        const next = transform(clone(current));
        return clone(await writeCanonical(next));
      });
    },

    async saveNotePatch(note, options = {}) {
      const expectedRevision = Math.max(0, Number(options.expectedRevision) || 0);
      const idFactory = options.idFactory ?? (() => crypto.randomUUID());
      return withLock(async () => {
        const current = await readCanonical();
        const index = current.notes.findIndex(item => item.id === note?.id);
        if (index < 0) throw new Error('笔记已在其他窗口删除');
        const canonical = current.notes[index];
        if (sameNoteContent(canonical, note)) {
          return { state: clone(current), savedNoteId: canonical.id, conflict: false };
        }
        if (canonical.revision !== expectedRevision) {
          let conflictId = String(idFactory());
          while (current.notes.some(item => item.id === conflictId)) conflictId = String(idFactory());
          const now = new Date().toISOString();
          const conflict = {
            ...canonical,
            id: conflictId,
            title: conflictTitle(note.title),
            body: String(note.body ?? ''),
            createdAt: now,
            updatedAt: now,
            revision: 1,
          };
          current.notes.splice(index + 1, 0, conflict);
          current.activeNoteId = conflict.id;
          const saved = await writeCanonical(current);
          return { state: clone(saved), savedNoteId: conflict.id, conflict: true };
        }
        current.notes[index] = {
          ...canonical,
          title: normalizeNoteTitle(note.title),
          body: String(note.body ?? ''),
          updatedAt: String(note.updatedAt ?? new Date().toISOString()),
          revision: canonical.revision + 1,
        };
        const saved = await writeCanonical(current);
        return { state: clone(saved), savedNoteId: canonical.id, conflict: false };
      });
    },

    subscribe(listener) {
      if (typeof storageArea.subscribe !== 'function') return () => {};
      return storageArea.subscribe(patch => {
        const source = patch?.[STATE_KEY];
        if (!source) return;
        const normalized = normalizeState(source);
        if (ownRevisions.has(normalized.stateRevision)) return;
        listener(clone(normalized));
      });
    },
  };
}
