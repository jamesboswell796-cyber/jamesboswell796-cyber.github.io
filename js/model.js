import { normalizeAppearance, DEFAULT_APPEARANCE } from './appearance.js';
import { inlineMarkdownToText } from './markdown.js';

export const SCHEMA_VERSION = 6;
export const TRASH_LIMIT = 20;
export const POPUP_SIZE_PRESETS = Object.freeze({
  compact: Object.freeze({ width: 340, height: 460 }),
  standard: Object.freeze({ width: 400, height: 560 }),
  large: Object.freeze({ width: 540, height: 600 }),
  wide: Object.freeze({ width: 740, height: 600 }),
});
export const POPUP_SIZES = Object.freeze(Object.keys(POPUP_SIZE_PRESETS));

function copyNote(note) {
  return { ...note };
}

function copyTrashItem(item) {
  return { ...item, note: copyNote(item.note) };
}

function copyState(state) {
  return {
    schemaVersion: SCHEMA_VERSION,
    activeNoteId: state.activeNoteId,
    notes: state.notes.map(copyNote),
    trash: (state.trash ?? []).map(copyTrashItem),
    preferences: {
      popupSize: state.preferences.popupSize,
      appearance: { ...state.preferences.appearance },
      noteOrder: state.preferences.noteOrder,
    },
  };
}

function ensureInternalState(state) {
  return state?.schemaVersion === SCHEMA_VERSION
    && Array.isArray(state.notes)
    && Array.isArray(state.trash)
    && (state.preferences?.noteOrder === 'recent' || state.preferences?.noteOrder === 'manual')
    ? state
    : normalizeState(state);
}

function normalizeNoteOrder(value) {
  return value === 'manual' ? 'manual' : 'recent';
}

function stripMarkdownPrefix(line) {
  return String(line ?? '').trim()
    .replace(/^#{1,6}\s+/u, '')
    .replace(/^[-*+]\s+/u, '')
    .replace(/^\d+\.\s+/u, '')
    .replace(/^>\s+/u, '')
    .trim();
}

export function normalizeNoteTitle(value, fallback = '新笔记') {
  const firstLine = String(value ?? '').split(/\r?\n/u)[0] ?? '';
  const clean = inlineMarkdownToText(stripMarkdownPrefix(firstLine)).replace(/\s+/gu, ' ').trim().slice(0, 80);
  return clean || fallback;
}

export function deriveNoteTitle(body) {
  const line = String(body ?? '').split(/\r?\n/u).find(value => value.trim());
  return line ? normalizeNoteTitle(line) : '新笔记';
}

function normalizeNote(raw, now, { legacy = false } = {}) {
  if (!legacy) {
    return {
      id: String(raw?.id ?? '').trim(),
      title: normalizeNoteTitle(raw?.title),
      body: String(raw?.body ?? ''),
      createdAt: String(raw?.createdAt ?? now),
      updatedAt: String(raw?.updatedAt ?? raw?.createdAt ?? now),
    };
  }

  const lines = String(raw?.body ?? '').split(/\r?\n/u);
  const firstMeaningfulIndex = lines.findIndex(line => line.trim());
  const derived = deriveNoteTitle(lines.join('\n'));
  const title = normalizeNoteTitle(raw?.title, derived);
  if (firstMeaningfulIndex >= 0 && normalizeNoteTitle(lines[firstMeaningfulIndex]) === title) {
    lines.splice(firstMeaningfulIndex, 1);
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines.at(-1).trim()) lines.pop();
  }
  return {
    id: String(raw?.id ?? '').trim(),
    title,
    body: lines.join('\n'),
    createdAt: String(raw?.createdAt ?? now),
    updatedAt: String(raw?.updatedAt ?? raw?.createdAt ?? now),
  };
}

export function createInitialState(options = {}) {
  const now = options.now ?? new Date().toISOString();
  const id = String(options.id ?? crypto.randomUUID());
  return {
    schemaVersion: SCHEMA_VERSION,
    activeNoteId: id,
    notes: [{ id, title: '新笔记', body: '', createdAt: now, updatedAt: now }],
    trash: [],
    preferences: { popupSize: 'standard', appearance: { ...DEFAULT_APPEARANCE }, noteOrder: 'recent' },
  };
}

export function normalizeState(input, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const sourceSchema = Number(input?.schemaVersion) || 1;
  const sourceNotes = Array.isArray(input?.notes) ? input.notes : [];
  const seen = new Set();
  const notes = [];

  for (const raw of sourceNotes) {
    const id = String(raw?.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const note = normalizeNote(raw, now, { legacy: sourceSchema < 4 });
    notes.push({ ...note, id });
  }

  if (!notes.length) {
    const initial = createInitialState({ now, id: idFactory() });
    initial.preferences.popupSize = POPUP_SIZES.includes(input?.preferences?.popupSize)
      ? input.preferences.popupSize
      : 'standard';
    initial.preferences.appearance = normalizeAppearance(input?.preferences?.appearance);
    initial.preferences.noteOrder = normalizeNoteOrder(input?.preferences?.noteOrder);
    return initial;
  }

  const trash = [];
  const trashIds = new Set();
  if (sourceSchema >= 5 && Array.isArray(input?.trash)) {
    for (const raw of input.trash) {
      const id = String(raw?.id ?? '').trim();
      const noteId = String(raw?.note?.id ?? '').trim();
      if (!id || !noteId || trashIds.has(id)) continue;
      trashIds.add(id);
      trash.push({
        id,
        note: normalizeNote({ ...raw.note, id: noteId }, now),
        originalIndex: Math.max(0, Number(raw?.originalIndex) || 0),
        previousActiveNoteId: String(raw?.previousActiveNoteId ?? ''),
        deletedAt: String(raw?.deletedAt ?? now),
      });
      if (trash.length >= TRASH_LIMIT) break;
    }
  }

  const requested = String(input?.activeNoteId ?? '');
  const activeNoteId = notes.some(note => note.id === requested) ? requested : notes[0].id;
  const popupSize = POPUP_SIZES.includes(input?.preferences?.popupSize)
    ? input.preferences.popupSize
    : 'standard';
  return {
    schemaVersion: SCHEMA_VERSION,
    activeNoteId,
    notes,
    trash,
    preferences: {
      popupSize,
      appearance: normalizeAppearance(input?.preferences?.appearance),
      noteOrder: normalizeNoteOrder(input?.preferences?.noteOrder),
    },
  };
}

export function orderedNotes(state) {
  const current = ensureInternalState(state);
  if (current.preferences.noteOrder === 'manual') return [...current.notes];
  return [...current.notes].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function reorderNotes(state, movedId, targetId, placement) {
  const next = copyState(ensureInternalState(state));
  if (movedId === targetId || (placement !== 'before' && placement !== 'after')) return next;
  const movedIndex = next.notes.findIndex(note => note.id === movedId);
  const targetIndex = next.notes.findIndex(note => note.id === targetId);
  if (movedIndex < 0 || targetIndex < 0) return next;

  const [moved] = next.notes.splice(movedIndex, 1);
  const adjustedTargetIndex = next.notes.findIndex(note => note.id === targetId);
  next.notes.splice(adjustedTargetIndex + (placement === 'after' ? 1 : 0), 0, moved);
  next.preferences.noteOrder = 'manual';
  return next;
}

export function createNote(state, options = {}) {
  const next = copyState(ensureInternalState(state));
  const now = options.now ?? new Date().toISOString();
  const id = String(options.id ?? crypto.randomUUID());
  if (next.notes.some(note => note.id === id)) throw new Error('笔记 ID 重复');
  const note = { id, title: '新笔记', body: '', createdAt: now, updatedAt: now };
  if (next.preferences.noteOrder === 'manual') next.notes.unshift(note);
  else next.notes.push(note);
  next.activeNoteId = id;
  return next;
}

export function setActiveNote(state, id) {
  const next = copyState(ensureInternalState(state));
  if (next.notes.some(note => note.id === id)) next.activeNoteId = id;
  return next;
}

export function updateNoteTitle(state, id, title, now = new Date().toISOString()) {
  const next = copyState(ensureInternalState(state));
  const note = next.notes.find(item => item.id === id);
  if (!note) throw new Error('未找到笔记');
  note.title = normalizeNoteTitle(title);
  note.updatedAt = now;
  return next;
}

export function updateNoteBody(state, id, body, now = new Date().toISOString()) {
  const next = copyState(ensureInternalState(state));
  const note = next.notes.find(item => item.id === id);
  if (!note) throw new Error('未找到笔记');
  note.body = String(body ?? '');
  note.updatedAt = now;
  return next;
}

export function setPreferences(state, patch = {}) {
  const next = copyState(ensureInternalState(state));
  if (POPUP_SIZES.includes(patch.popupSize)) next.preferences.popupSize = patch.popupSize;
  if (patch.appearance && typeof patch.appearance === 'object') {
    next.preferences.appearance = normalizeAppearance({ ...next.preferences.appearance, ...patch.appearance });
  }
  return next;
}

export function moveNoteToTrash(state, id, options = {}) {
  const next = copyState(ensureInternalState(state));
  const index = next.notes.findIndex(note => note.id === id);
  if (index < 0) return next;
  const [note] = next.notes.splice(index, 1);
  const item = {
    id: String(options.trashId ?? crypto.randomUUID()),
    note,
    originalIndex: index,
    previousActiveNoteId: next.activeNoteId,
    deletedAt: String(options.now ?? new Date().toISOString()),
  };
  next.trash = [item, ...next.trash.filter(record => record.id !== item.id)].slice(0, TRASH_LIMIT);

  if (!next.notes.length) {
    const now = String(options.now ?? new Date().toISOString());
    const replacementId = String(options.id ?? crypto.randomUUID());
    next.notes.push({ id: replacementId, title: '新笔记', body: '', createdAt: now, updatedAt: now });
    next.activeNoteId = replacementId;
  } else if (next.activeNoteId === id) {
    next.activeNoteId = next.notes[Math.min(index, next.notes.length - 1)].id;
  }
  return next;
}

export function restoreTrashItem(state, trashId, options = {}) {
  const next = copyState(ensureInternalState(state));
  const index = next.trash.findIndex(item => item.id === trashId);
  if (index < 0) return next;
  const [item] = next.trash.splice(index, 1);
  const temporary = next.notes.length === 1 ? next.notes[0] : null;
  if (temporary
    && temporary.title === '新笔记'
    && !temporary.body
    && temporary.createdAt === item.deletedAt
    && temporary.updatedAt === item.deletedAt) {
    next.notes = [];
  }
  const note = copyNote(item.note);
  if (next.notes.some(existing => existing.id === note.id)) {
    const idFactory = options.idFactory ?? (() => crypto.randomUUID());
    let replacement = String(idFactory());
    while (next.notes.some(existing => existing.id === replacement)) replacement = String(idFactory());
    note.id = replacement;
  }
  next.notes.splice(Math.min(item.originalIndex, next.notes.length), 0, note);
  next.activeNoteId = note.id;
  return next;
}

export function undoLatestDeletion(state, options = {}) {
  const current = ensureInternalState(state);
  return current.trash.length ? restoreTrashItem(current, current.trash[0].id, options) : copyState(current);
}

export function permanentlyDeleteTrashItem(state, trashId) {
  const next = copyState(ensureInternalState(state));
  next.trash = next.trash.filter(item => item.id !== trashId);
  return next;
}

export function emptyTrash(state) {
  const next = copyState(ensureInternalState(state));
  next.trash = [];
  return next;
}

export function deleteNote(state, id, options = {}) {
  return moveNoteToTrash(state, id, options);
}
