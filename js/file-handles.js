const DB_NAME = 'quickNotesFileHandles';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const BACKUP_DIRECTORY_KEY = 'backupDirectory';

function openDatabase(indexedDb = globalThis.indexedDB) {
  if (!indexedDb) return Promise.reject(new Error('浏览器不支持目录句柄存储'));
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开目录句柄存储'));
  });
}

export function createDirectoryHandleStore(indexedDb = globalThis.indexedDB) {
  async function withStore(mode, action) {
    const database = await openDatabase(indexedDb);
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = action(store);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error ?? new Error('目录句柄操作失败'));
      });
    } finally {
      database.close();
    }
  }

  return {
    get: () => withStore('readonly', store => store.get(BACKUP_DIRECTORY_KEY)),
    set: handle => withStore('readwrite', store => store.put(handle, BACKUP_DIRECTORY_KEY)),
    clear: () => withStore('readwrite', store => store.delete(BACKUP_DIRECTORY_KEY)),
  };
}

export async function ensureReadWritePermission(handle, options = {}) {
  if (!handle || handle.kind !== 'directory') return false;
  if (typeof handle.queryPermission !== 'function') return true;
  const descriptor = { mode: 'readwrite' };
  const current = await handle.queryPermission(descriptor);
  if (current === 'granted') return true;
  if (!options.request || typeof handle.requestPermission !== 'function') return false;
  return (await handle.requestPermission(descriptor)) === 'granted';
}

export async function pickBackupDirectory(options = {}) {
  const picker = options.picker ?? globalThis.showDirectoryPicker;
  if (typeof picker !== 'function') throw new Error('当前 Chrome 不支持选择本地备份目录');
  return picker({ id: 'quick-notes-backup', mode: 'readwrite', startIn: 'documents' });
}
