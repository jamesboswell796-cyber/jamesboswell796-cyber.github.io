import { normalizeState } from './model.js';
import { noteToMarkdown } from './note-markdown.js';

export const BACKUP_FOLDER_NAME = 'Quick Notes Backup';
export const BACKUP_FORMAT = 'quick-notes-backup';
export const BACKUP_SCHEMA = 1;
const BACKUP_JSON = 'quick-notes-backup.json';
const BACKUP_MANIFEST = 'backup-manifest.json';


function normalizedTimestamp(value) {
  return String(value ?? new Date().toISOString());
}

export function createBackupSnapshot(state, options = {}) {
  return {
    format: BACKUP_FORMAT,
    backupSchema: BACKUP_SCHEMA,
    appVersion: String(options.appVersion ?? '0.0.0'),
    exportedAt: normalizedTimestamp(options.exportedAt),
    state: normalizeState(state),
  };
}

export function validateBackupSnapshot(input) {
  if (input?.format !== BACKUP_FORMAT || input?.backupSchema !== BACKUP_SCHEMA || !input?.state) {
    throw new Error('无法识别这个随手记备份文件');
  }
  return normalizeState(input.state);
}

function safeSlug(value) {
  const slug = String(value ?? '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, '-')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^[.\-]+|[.\-]+$/gu, '')
    .slice(0, 48);
  return slug || 'note';
}

export function noteBackupFilename(note) {
  const idPart = safeSlug(String(note?.id ?? '').slice(0, 8) || 'unknown');
  return `${safeSlug(note?.title)}--${idPart}.md`;
}

export function buildBackupFiles(state, options = {}) {
  const snapshot = createBackupSnapshot(state, options);
  const files = new Map();
  const noteFiles = snapshot.state.notes.map(note => noteBackupFilename(note));
  files.set(BACKUP_JSON, `${JSON.stringify(snapshot, null, 2)}\n`);
  files.set(BACKUP_MANIFEST, `${JSON.stringify({
    format: BACKUP_FORMAT,
    backupSchema: BACKUP_SCHEMA,
    generatedAt: snapshot.exportedAt,
    noteFiles,
  }, null, 2)}\n`);
  snapshot.state.notes.forEach((note, index) => {
    files.set(`notes/${noteFiles[index]}`, noteToMarkdown(note));
  });
  return files;
}

async function writeTextFile(directory, name, contents) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
}

async function readTextFile(directory, name) {
  const handle = await directory.getFileHandle(name);
  const file = await handle.getFile();
  return file.text();
}

async function readOptionalTextFile(directory, name) {
  try {
    return await readTextFile(directory, name);
  } catch (error) {
    if (error?.name === 'NotFoundError') return null;
    throw error;
  }
}

function backupStateFingerprint(text) {
  try {
    const snapshot = JSON.parse(text);
    return JSON.stringify(validateBackupSnapshot(snapshot));
  } catch {
    return null;
  }
}

async function rotateBackupHistory(root, currentText) {
  const history = await root.getDirectoryHandle('history', { create: true });
  const first = await readOptionalTextFile(history, 'backup-1.json');
  const second = await readOptionalTextFile(history, 'backup-2.json');
  if (second !== null) await writeTextFile(history, 'backup-3.json', second);
  if (first !== null) await writeTextFile(history, 'backup-2.json', first);
  await writeTextFile(history, 'backup-1.json', currentText);
}

async function readManifest(directory) {
  try {
    return JSON.parse(await readTextFile(directory, BACKUP_MANIFEST));
  } catch (error) {
    if (error?.name === 'NotFoundError' || error instanceof SyntaxError) return { noteFiles: [] };
    throw error;
  }
}

export async function writeBackupToDirectory(directoryHandle, state, options = {}) {
  if (!directoryHandle || directoryHandle.kind !== 'directory') throw new Error('备份目录不可用');
  const root = await directoryHandle.getDirectoryHandle(BACKUP_FOLDER_NAME, { create: true });
  const notesDirectory = await root.getDirectoryHandle('notes', { create: true });
  const previousManifest = await readManifest(root);
  const files = buildBackupFiles(state, options);
  const previousBackup = await readOptionalTextFile(root, BACKUP_JSON);
  const nextBackup = files.get(BACKUP_JSON);
  if (previousBackup !== null && backupStateFingerprint(previousBackup) !== backupStateFingerprint(nextBackup)) {
    await rotateBackupHistory(root, previousBackup);
  }
  const currentNoteFiles = [...files.keys()]
    .filter(path => path.startsWith('notes/'))
    .map(path => path.slice('notes/'.length));
  const currentSet = new Set(currentNoteFiles);
  for (const stale of Array.isArray(previousManifest?.noteFiles) ? previousManifest.noteFiles : []) {
    if (!currentSet.has(stale)) {
      try {
        await notesDirectory.removeEntry(stale);
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
    }
  }
  for (const [path, contents] of files) {
    if (path.startsWith('notes/')) {
      await writeTextFile(notesDirectory, path.slice('notes/'.length), contents);
    } else if (path !== BACKUP_MANIFEST) {
      await writeTextFile(root, path, contents);
    }
  }
  await writeTextFile(root, BACKUP_MANIFEST, files.get(BACKUP_MANIFEST));
  return { folderName: BACKUP_FOLDER_NAME, noteCount: currentNoteFiles.length };
}

export async function readBackupFromDirectory(directoryHandle) {
  if (!directoryHandle || directoryHandle.kind !== 'directory') throw new Error('备份目录不可用');
  const root = await directoryHandle.getDirectoryHandle(BACKUP_FOLDER_NAME);
  const snapshot = JSON.parse(await readTextFile(root, BACKUP_JSON));
  return validateBackupSnapshot(snapshot);
}

export function createBackupScheduler(writer, options = {}) {
  const delay = Number.isFinite(options.delay) ? options.delay : 2500;
  const timers = options.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: id => clearTimeout(id),
  };
  let timerId = null;
  let pendingState = null;
  let pendingFingerprint = null;
  let lastWrittenFingerprint = null;

  async function run() {
    const state = pendingState;
    const fingerprint = pendingFingerprint;
    pendingState = null;
    pendingFingerprint = null;
    if (timerId !== null) timers.clear(timerId);
    timerId = null;
    if (!state || fingerprint === lastWrittenFingerprint) return;
    await writer(state);
    lastWrittenFingerprint = fingerprint;
  }

  function schedule(state) {
    const normalized = normalizeState(state);
    const fingerprint = JSON.stringify(normalized);
    if (fingerprint === lastWrittenFingerprint || fingerprint === pendingFingerprint) return;
    pendingState = normalized;
    pendingFingerprint = fingerprint;
    if (timerId !== null) timers.clear(timerId);
    timerId = timers.set(run, delay);
  }

  async function flush() {
    if (timerId === null && !pendingState) return;
    await run();
  }

  function resetFingerprint() {
    lastWrittenFingerprint = null;
  }

  return { schedule, flush, resetFingerprint };
}
