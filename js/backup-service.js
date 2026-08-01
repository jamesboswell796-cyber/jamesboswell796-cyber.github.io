import { createBackupScheduler, readBackupBundleFromDirectory, writeBackupToDirectory } from './backup.js';
import { collectReferencedAssetIds } from './asset-repository.js';
import { createDirectoryHandleStore, ensureReadWritePermission, pickBackupDirectory } from './file-handles.js';

const STATUS_TEXT = Object.freeze({
  disconnected: '尚未连接备份目录',
  connected: '备份目录已连接',
  'permission-needed': '备份目录需要重新授权',
  'backing-up': '正在备份…',
  'backed-up': '自动备份已完成',
  failed: '自动备份失败',
  unsupported: '当前浏览器不支持持续写入指定文件夹；笔记仍会自动保存在本机，也可导出完整 JSON',
});

export function createBackupService(options = {}) {
  const handleStore = options.handleStore ?? createDirectoryHandleStore();
  const picker = options.picker ?? (() => pickBackupDirectory());
  const supported = options.supported ?? (Boolean(options.picker || options.handleStore) || typeof globalThis.showDirectoryPicker === 'function');
  const ensurePermission = options.ensurePermission ?? ensureReadWritePermission;
  const assetRepository = options.assetRepository ?? null;
  const writer = options.writer ?? (async (handle, state) => {
    const notes = [...state.notes, ...(state.trash ?? []).map(item => item.note)];
    const assets = assetRepository
      ? await assetRepository.exportRecords(collectReferencedAssetIds(notes))
      : [];
    return writeBackupToDirectory(handle, state, {
      appVersion: options.appVersion ?? globalThis.chrome?.runtime?.getManifest?.().version ?? '0.0.0',
      assets,
    });
  });
  const reader = options.reader ?? (async handle => {
    const bundle = await readBackupBundleFromDirectory(handle);
    if (assetRepository) await assetRepository.importRecords(bundle.assets);
    return bundle.state;
  });
  const onStatus = options.onStatus ?? (() => {});
  const schedulerFactory = options.schedulerFactory ?? (write => createBackupScheduler(write, { delay: 2500 }));
  let handle = null;
  let currentStatus = { code: 'disconnected', text: STATUS_TEXT.disconnected };

  function emit(code, extra = {}) {
    currentStatus = { code, text: STATUS_TEXT[code] ?? code, ...extra };
    onStatus(currentStatus);
    return currentStatus;
  }

  async function init() {
    if (!supported) return emit('unsupported');
    try {
      handle = await handleStore.get();
    } catch {
      handle = null;
    }
    if (!handle) return emit('disconnected');
    const allowed = await ensurePermission(handle, { request: false });
    return emit(allowed ? 'connected' : 'permission-needed', { folderName: handle.name });
  }

  async function backupNow(state, optionsForBackup = {}) {
    if (!handle) {
      emit('disconnected');
      return false;
    }
    const allowed = await ensurePermission(handle, { request: Boolean(optionsForBackup.requestPermission) });
    if (!allowed) {
      emit('permission-needed', { folderName: handle.name });
      return false;
    }
    emit('backing-up', { folderName: handle.name });
    try {
      const result = await writer(handle, state);
      return emit('backed-up', { folderName: handle.name, ...result });
    } catch (error) {
      emit('failed', { folderName: handle.name, error });
      if (optionsForBackup.throwOnError) throw error;
      return false;
    }
  }

  const scheduler = schedulerFactory(async state => {
    await backupNow(state, { requestPermission: false });
  });

  async function connect(state) {
    if (!supported) throw new Error(STATUS_TEXT.unsupported);
    handle = await picker();
    await handleStore.set(handle);
    emit('connected', { folderName: handle.name });
    return (await backupNow(state, { requestPermission: true, throwOnError: true })) || currentStatus;
  }

  function schedule(state) {
    if (handle) scheduler.schedule(state);
  }

  async function restore() {
    if (!handle) throw new Error('请先选择备份目录');
    const allowed = await ensurePermission(handle, { request: true });
    if (!allowed) throw new Error('未获得备份目录权限');
    return reader(handle);
  }

  async function disconnect() {
    await scheduler.flush();
    await handleStore.clear();
    handle = null;
    return emit('disconnected');
  }

  return {
    init,
    connect,
    schedule,
    backupNow,
    restore,
    disconnect,
    getStatus: () => ({ ...currentStatus }),
    hasHandle: () => Boolean(handle),
    isSupported: () => supported,
  };
}
