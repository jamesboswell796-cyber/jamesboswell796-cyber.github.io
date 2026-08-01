import { createBackupSnapshot, noteBackupFilename, validateBackupSnapshot } from './backup.js';
import { noteToMarkdown } from './note-markdown.js';
import { collectReferencedAssetIds } from './asset-repository.js';

function datePart(isoString) {
  const value = String(isoString ?? new Date().toISOString());
  return /^\d{4}-\d{2}-\d{2}/u.test(value) ? value.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

export function createJsonExport(state, options = {}) {
  const snapshot = createBackupSnapshot(state, options);
  return {
    filename: `Quick-Notes-Backup-${datePart(snapshot.exportedAt)}.json`,
    mimeType: 'application/json;charset=utf-8',
    contents: `${JSON.stringify(snapshot, null, 2)}\n`,
  };
}

export async function createJsonExportWithAssets(state, assetRepository, options = {}) {
  const snapshot = createBackupSnapshot(state, options);
  const notes = [...snapshot.state.notes, ...(snapshot.state.trash ?? []).map(item => item.note)];
  const assets = assetRepository
    ? await assetRepository.exportRecords(collectReferencedAssetIds(notes))
    : [];
  const bundle = { ...snapshot, assets };
  return {
    filename: `Quick-Notes-Backup-${datePart(snapshot.exportedAt)}.json`,
    mimeType: 'application/json;charset=utf-8',
    contents: `${JSON.stringify(bundle, null, 2)}\n`,
  };
}

export function createMarkdownExport(note) {
  return {
    filename: noteBackupFilename(note),
    mimeType: 'text/markdown;charset=utf-8',
    contents: noteToMarkdown(note),
  };
}

export function parseBackupText(text) {
  return validateBackupSnapshot(JSON.parse(String(text ?? '')));
}

export function parseCompleteBackupText(text) {
  const input = JSON.parse(String(text ?? ''));
  return {
    state: validateBackupSnapshot(input),
    assets: Array.isArray(input.assets) ? input.assets : [],
  };
}

export function downloadTextFile(file, options = {}) {
  const documentObject = options.document ?? globalThis.document;
  const urlApi = options.urlApi ?? globalThis.URL;
  const BlobCtor = options.BlobCtor ?? globalThis.Blob;
  if (!documentObject || !urlApi || !BlobCtor) throw new Error('当前页面无法导出文件');
  const blob = new BlobCtor([file.contents], { type: file.mimeType });
  const url = urlApi.createObjectURL(blob);
  const link = documentObject.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.hidden = true;
  documentObject.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => urlApi.revokeObjectURL(url), 0);
}
