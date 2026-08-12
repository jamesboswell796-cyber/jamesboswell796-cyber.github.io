import { createInitialState, normalizeState } from './model.js';

export const STATE_KEY = 'quickNotesState';

function clone(value) {
  return structuredClone(value);
}

function sameState(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function createStorageRepository(storageArea = globalThis.chrome?.storage?.local) {
  if (!storageArea) throw new Error('本地存储不可用');
  return {
    async getState() {
      const result = await storageArea.get(STATE_KEY);
      const source = result?.[STATE_KEY];
      const state = source ? normalizeState(source) : createInitialState();
      if (!source || !sameState(source, state)) await storageArea.set({ [STATE_KEY]: state });
      return clone(state);
    },
    async saveState(state) {
      const normalized = normalizeState(state);
      await storageArea.set({ [STATE_KEY]: normalized });
      return clone(normalized);
    },
  };
}
