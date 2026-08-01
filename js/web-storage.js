function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function createStorageAreaFromKeyValueStore(store) {
  if (!store?.get || !store?.set || !store?.remove || !store?.entries) {
    throw new Error('Web storage backend is incomplete');
  }

  return {
    async get(keys) {
      if (typeof keys === 'string') return { [keys]: clone(await store.get(keys)) };
      if (Array.isArray(keys)) {
        const result = {};
        for (const key of keys) result[key] = clone(await store.get(key));
        return result;
      }
      return Object.fromEntries((await store.entries()).map(([key, value]) => [key, clone(value)]));
    },
    async set(patch) {
      for (const [key, value] of Object.entries(patch ?? {})) await store.set(key, clone(value));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) await store.remove(key);
    },
  };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed')), { once: true });
  });
}

export function createIndexedDbStorageArea(options = {}) {
  const indexedDB = options.indexedDB ?? globalThis.indexedDB;
  if (!indexedDB) throw new Error('当前浏览器不支持 IndexedDB');
  const dbName = options.dbName ?? 'quickNotesMenubarX';
  const storeName = options.storeName ?? 'keyValue';
  const listeners = new Set();
  const channelName = options.channelName ?? `${dbName}:changes`;
  const Channel = options.BroadcastChannel ?? globalThis.BroadcastChannel;
  const channel = Channel ? new Channel(channelName) : null;
  if (channel) channel.addEventListener('message', event => {
    const patch = event.data?.patch;
    if (patch && typeof patch === 'object') for (const listener of listeners) listener(clone(patch));
  });
  let databasePromise;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.addEventListener('upgradeneeded', () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
      }, { once: true });
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error ?? new Error('无法打开本地数据库')), { once: true });
    });
    return databasePromise;
  }

  const store = {
    async get(key) {
      const database = await openDatabase();
      return requestResult(database.transaction(storeName, 'readonly').objectStore(storeName).get(key));
    },
    async set(key, value) {
      const database = await openDatabase();
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(value, key);
      await transactionDone(transaction);
    },
    async remove(key) {
      const database = await openDatabase();
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(key);
      await transactionDone(transaction);
    },
    async entries() {
      const database = await openDatabase();
      const transaction = database.transaction(storeName, 'readonly');
      const objectStore = transaction.objectStore(storeName);
      const [keys, values] = await Promise.all([
        requestResult(objectStore.getAllKeys()),
        requestResult(objectStore.getAll()),
      ]);
      return keys.map((key, index) => [String(key), values[index]]);
    },
  };

  const area = createStorageAreaFromKeyValueStore(store);
  return {
    ...area,
    async set(patch) {
      await area.set(patch);
      channel?.postMessage({ patch: clone(patch) });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() { channel?.close?.(); },
  };
}
