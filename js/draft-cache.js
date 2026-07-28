import { normalizeState } from './model.js';

export const DRAFT_KEY = 'quickNotesEmergencyDraft';

function resolveLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function latestTimestamp(state) {
  return Math.max(0, ...normalizeState(state).notes.map(note => Date.parse(note.updatedAt) || 0));
}

export function chooseLatestState(first, second) {
  const left = normalizeState(first);
  const right = normalizeState(second);
  return latestTimestamp(right) > latestTimestamp(left) ? right : left;
}

export function createDraftCache(storage = resolveLocalStorage(), key = DRAFT_KEY) {
  return {
    load() {
      if (!storage) return null;
      try {
        const raw = storage.getItem(key);
        return raw ? normalizeState(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    save(state) {
      if (!storage) return;
      try {
        storage.setItem(key, JSON.stringify(normalizeState(state)));
      } catch {
        // Emergency cache must never block normal editing.
      }
    },
    clear() {
      if (!storage) return;
      try {
        storage.removeItem(key);
      } catch {
        // Canonical chrome.storage remains authoritative.
      }
    },
  };
}
