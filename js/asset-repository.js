const ASSET_PATTERN = /\[\[image:([A-Za-z0-9_-]+)\]\]/gu;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeRecord(input, idFactory = () => crypto.randomUUID()) {
  const dataUrl = String(input?.dataUrl ?? '');
  if (!/^data:image\/(?:png|jpeg|webp|gif);base64,/u.test(dataUrl)) throw new Error('图片数据无效');
  const id = String(input?.id ?? idFactory()).trim();
  if (!id || !/^[A-Za-z0-9_-]+$/u.test(id)) throw new Error('图片 ID 无效');
  return {
    id,
    name: String(input?.name ?? 'image').slice(0, 120),
    type: String(input?.type ?? (dataUrl.slice(5, dataUrl.indexOf(';')) || 'image/png')),
    dataUrl,
    width: Math.max(0, Number(input?.width) || 0),
    height: Math.max(0, Number(input?.height) || 0),
    createdAt: String(input?.createdAt ?? new Date().toISOString()),
  };
}

export function collectReferencedAssetIds(notes = []) {
  const ids = new Set();
  for (const note of notes ?? []) {
    for (const match of String(note?.body ?? '').matchAll(ASSET_PATTERN)) ids.add(match[1]);
  }
  return ids;
}

export function createAssetRepository(options = {}) {
  const store = options.store ?? createIndexedDbAssetStore(options);
  const idFactory = options.idFactory ?? (() => `asset_${crypto.randomUUID().replaceAll('-', '')}`);
  return {
    async put(input) {
      const record = normalizeRecord(input, idFactory);
      await store.put(record);
      return clone(record);
    },
    async get(id) {
      return clone(await store.get(String(id ?? '')));
    },
    async delete(id) {
      await store.delete(String(id ?? ''));
    },
    async list() {
      return clone(await store.list());
    },
    async exportRecords(referencedIds = null) {
      const records = await store.list();
      const selected = referencedIds instanceof Set
        ? records.filter(record => referencedIds.has(record.id))
        : records;
      return selected.map(record => normalizeRecord(record, idFactory));
    },
    async importRecords(records = []) {
      const imported = [];
      for (const input of records ?? []) {
        const record = normalizeRecord(input, idFactory);
        await store.put(record);
        imported.push(record);
      }
      return clone(imported);
    },
    async removeUnreferenced(notes = []) {
      const referenced = collectReferencedAssetIds(notes);
      for (const record of await store.list()) if (!referenced.has(record.id)) await store.delete(record.id);
    },
  };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('图片数据库请求失败')), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('图片数据库事务中止')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('图片数据库事务失败')), { once: true });
  });
}

export function createIndexedDbAssetStore(options = {}) {
  const indexedDB = options.indexedDB ?? globalThis.indexedDB;
  if (!indexedDB) throw new Error('当前浏览器不支持图片附件');
  const dbName = options.assetDbName ?? 'quickNotesAssets';
  const storeName = options.assetStoreName ?? 'assets';
  let databasePromise;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.addEventListener('upgradeneeded', () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'id' });
      }, { once: true });
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error ?? new Error('无法打开图片数据库')), { once: true });
    });
    return databasePromise;
  }

  return {
    async get(id) {
      const db = await openDatabase();
      return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).get(id));
    },
    async put(record) {
      const db = await openDatabase();
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(record);
      await transactionDone(tx);
    },
    async delete(id) {
      const db = await openDatabase();
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      await transactionDone(tx);
    },
    async list() {
      const db = await openDatabase();
      return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
    },
  };
}
