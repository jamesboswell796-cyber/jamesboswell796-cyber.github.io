import { normalizeState } from './model.js';

export const SNAPSHOT_KEY = 'quickNotesSafetySnapshots';
export const SNAPSHOT_LIMIT = 8;

function clone(value) {
  return structuredClone(value);
}

function normalizeRecord(input) {
  if (!input?.id || !input?.state) return null;
  return {
    id: String(input.id),
    reason: String(input.reason || '安全快照'),
    createdAt: String(input.createdAt || new Date().toISOString()),
    state: normalizeState(input.state),
  };
}

export function createSnapshotRecord(state, options = {}) {
  return {
    id: String(options.id ?? crypto.randomUUID()),
    reason: String(options.reason || '安全快照'),
    createdAt: String(options.createdAt ?? new Date().toISOString()),
    state: normalizeState(state),
  };
}

export function pushSnapshot(records, record, max = SNAPSHOT_LIMIT) {
  const normalized = normalizeRecord(record);
  if (!normalized) return (Array.isArray(records) ? records : []).map(normalizeRecord).filter(Boolean).slice(0, max);
  return [
    normalized,
    ...(Array.isArray(records) ? records : [])
      .map(normalizeRecord)
      .filter(item => item && item.id !== normalized.id),
  ].slice(0, Math.max(1, Number(max) || SNAPSHOT_LIMIT));
}

export function createSnapshotRepository(storageArea = globalThis.chrome?.storage?.local, options = {}) {
  if (!storageArea) throw new Error('本地存储不可用');
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date().toISOString());
  const limit = options.limit ?? SNAPSHOT_LIMIT;

  async function list() {
    const result = await storageArea.get(SNAPSHOT_KEY);
    return (Array.isArray(result?.[SNAPSHOT_KEY]) ? result[SNAPSHOT_KEY] : [])
      .map(normalizeRecord)
      .filter(Boolean)
      .slice(0, limit)
      .map(clone);
  }

  async function write(records) {
    const value = records.slice(0, limit).map(clone);
    await storageArea.set({ [SNAPSHOT_KEY]: value });
    return value;
  }

  async function capture(state, reason = '安全快照') {
    const record = createSnapshotRecord(state, {
      id: idFactory(),
      reason,
      createdAt: now(),
    });
    await write(pushSnapshot(await list(), record, limit));
    return clone(record);
  }

  async function restore(snapshotId, currentState) {
    const records = await list();
    const target = records.find(record => record.id === snapshotId);
    if (!target) throw new Error('未找到安全快照');
    await capture(currentState, '恢复前留底');
    return clone(target.state);
  }

  return { list, capture, restore };
}
