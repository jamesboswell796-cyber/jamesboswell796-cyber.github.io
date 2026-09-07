import { createDebouncedSaver } from '../js/autosave.js';
import { createBackupService } from '../js/backup-service.js';
import { chooseLatestState, createDraftCache } from '../js/draft-cache.js';
import { createJsonExport, createMarkdownExport, downloadTextFile, parseBackupText } from '../js/export.js';
import {
  createNote,
  emptyTrash,
  moveNoteToTrash,
  orderedNotes,
  restoreTrashItem,
  setActiveNote,
  updateNoteBody,
  updateNoteTitle,
} from '../js/model.js';
import { createNoteExcerpt } from '../js/note-discovery.js';
import { renderMarkdown } from '../js/markdown.js';
import { createSnapshotRepository } from '../js/safety-snapshots.js';
import { createStorageRepository } from '../js/storage.js';
import {
  copyPayload,
  filterShelfNotes,
  formatPrefixedLines,
  formatWrappedSource,
  insertSourceText,
  nextViewAfterNewNote,
  sourceForEdit,
} from './app-core.js';

const runtime = globalThis.__QUICK_NOTES_RUNTIME__;
if (!runtime?.storageArea) throw new Error('MenubarX runtime is unavailable');

const repository = createStorageRepository(runtime.storageArea);
const snapshotRepository = createSnapshotRepository(runtime.storageArea);
const draftCache = createDraftCache(runtime.draftStorage, runtime.draftKey);

const elements = {
  app: document.querySelector('#menubar-app'),
  shelf: document.querySelector('#shelf-view'),
  read: document.querySelector('#read-view'),
  edit: document.querySelector('#edit-view'),
  count: document.querySelector('#note-count'),
  list: document.querySelector('#note-list'),
  empty: document.querySelector('#note-empty'),
  search: document.querySelector('#note-search'),
  add: document.querySelector('#new-note'),
  settings: document.querySelector('#settings-button'),
  readBack: document.querySelector('#read-back'),
  readCopy: document.querySelector('#read-copy'),
  readEdit: document.querySelector('#read-edit'),
  readDelete: document.querySelector('#read-delete'),
  readTitle: document.querySelector('#read-title'),
  readBody: document.querySelector('#read-body'),
  editBack: document.querySelector('#edit-back'),
  editCopy: document.querySelector('#edit-copy'),
  editTitle: document.querySelector('#edit-title'),
  editBody: document.querySelector('#edit-body'),
  sourceToolbar: document.querySelector('#source-toolbar'),
  saveStatus: document.querySelector('#save-status'),
  copyToast: document.querySelector('#copy-toast'),
  settingsDialog: document.querySelector('#settings-dialog'),
  backupStatus: document.querySelector('#backup-status'),
  connectBackup: document.querySelector('#connect-backup'),
  backupNow: document.querySelector('#backup-now'),
  restoreBackup: document.querySelector('#restore-backup'),
  disconnectBackup: document.querySelector('#disconnect-backup'),
  createSnapshot: document.querySelector('#create-snapshot'),
  snapshotList: document.querySelector('#snapshot-list'),
  trashSummary: document.querySelector('#trash-summary'),
  trashList: document.querySelector('#trash-list'),
  emptyTrash: document.querySelector('#empty-trash'),
  exportJson: document.querySelector('#export-json'),
  exportMarkdown: document.querySelector('#export-markdown'),
  importJson: document.querySelector('#import-json'),
  importInput: document.querySelector('#import-json-input'),
  version: document.querySelector('#version'),
};

let state;
let view = 'shelf';
let copyToastTimer = null;
let editRenderNoteId = null;
let titleDirty = false;

function activeNote() {
  return state?.notes.find(note => note.id === state.activeNoteId) ?? state?.notes[0] ?? null;
}

function setSaveStatus(text) {
  elements.saveStatus.textContent = text;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function renderBackupStatus(status) {
  const suffix = status?.folderName ? ` · ${status.folderName}` : '';
  elements.backupStatus.textContent = `${status?.text ?? '尚未连接备份目录'}${suffix}`;
  const connected = status?.code && status.code !== 'disconnected';
  elements.connectBackup.textContent = connected ? '更换目录' : '选择目录';
  elements.backupNow.disabled = !connected;
  elements.restoreBackup.disabled = !connected;
  elements.disconnectBackup.disabled = !connected;
}

const backupService = createBackupService({
  appVersion: runtime.appVersion,
  onStatus: renderBackupStatus,
});

const saver = createDebouncedSaver(async nextState => {
  try {
    state = await repository.saveState(nextState);
    draftCache.clear();
    backupService.schedule(state);
    setSaveStatus(titleDirty ? '标题未保存' : '已保存');
  } catch {
    setSaveStatus('保存失败');
  }
}, { delay: 420 });

async function persistImmediate(message = '') {
  await saver.flush();
  state = await repository.saveState(state);
  draftCache.clear();
  backupService.schedule(state);
  if (message) setSaveStatus(message);
  return state;
}

async function replaceState(nextState, message) {
  state = await repository.saveState(nextState);
  draftCache.clear();
  backupService.schedule(state);
  editRenderNoteId = null;
  titleDirty = false;
  setSaveStatus(message);
  renderCurrentView();
}

function markTitleDirty() {
  titleDirty = true;
  setSaveStatus('标题未保存');
}

function commitTitleDraft() {
  if (!titleDirty) return false;
  const note = activeNote();
  if (!note) return false;
  state = updateNoteTitle(state, note.id, elements.editTitle.value);
  elements.editTitle.value = activeNote().title;
  titleDirty = false;
  setSaveStatus('保存中…');
  saver.schedule(state);
  return true;
}

function setView(nextView, { focus = false } = {}) {
  if (view === 'edit' && nextView !== 'edit') commitTitleDraft();
  view = nextView;
  elements.app.dataset.view = view;
  elements.shelf.hidden = view !== 'shelf';
  elements.read.hidden = view !== 'read';
  elements.edit.hidden = view !== 'edit';
  renderCurrentView();
  if (focus) {
    requestAnimationFrame(() => {
      if (view === 'edit') elements.editBody.focus({ preventScroll: true });
      if (view === 'shelf') elements.search.focus({ preventScroll: true });
    });
  }
}

function renderShelf() {
  const visible = filterShelfNotes(orderedNotes(state), elements.search.value);
  elements.count.textContent = `${visible.length}${visible.length === state.notes.length ? '' : `/${state.notes.length}`}`;
  elements.empty.hidden = visible.length !== 0;
  const rows = visible.map(note => {
    const row = document.createElement('div');
    row.className = 'note-row';
    row.dataset.noteId = note.id;
    row.setAttribute('role', 'listitem');

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'note-open';
    open.dataset.action = 'open';
    open.dataset.noteId = note.id;

    const title = document.createElement('span');
    title.className = 'note-row-title';
    title.textContent = note.title;
    const excerpt = document.createElement('span');
    excerpt.className = 'note-row-excerpt';
    excerpt.textContent = createNoteExcerpt(note.body, 96) || '空笔记';
    open.append(title, excerpt);

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'copy-row-action';
    copy.dataset.action = 'copy';
    copy.dataset.noteId = note.id;
    copy.textContent = '复制';
    copy.setAttribute('aria-label', `复制“${note.title}”`);

    row.append(open, copy);
    return row;
  });
  elements.list.replaceChildren(...rows);
}

function renderRead() {
  const note = activeNote();
  if (!note) return;
  elements.readTitle.textContent = note.title;
  renderMarkdown(elements.readBody, sourceForEdit(note));
}

function renderEdit({ force = false } = {}) {
  const note = activeNote();
  if (!note) return;
  if (!force && editRenderNoteId === note.id) return;
  editRenderNoteId = note.id;
  titleDirty = false;
  elements.editTitle.value = note.title;
  elements.editBody.value = sourceForEdit(note);
}

function renderCurrentView() {
  if (!state) return;
  if (view === 'shelf') renderShelf();
  else if (view === 'read') renderRead();
  else renderEdit();
}

async function selectNote(noteId) {
  if (!noteId) return;
  await saver.flush();
  state = setActiveNote(state, noteId);
  await persistImmediate();
  editRenderNoteId = null;
  setView('read');
}

async function createNewNote() {
  await saver.flush();
  state = createNote(state);
  await persistImmediate('已新建');
  editRenderNoteId = null;
  setView(nextViewAfterNewNote(), { focus: true });
}

async function deleteActiveNote() {
  const note = activeNote();
  if (!note) return;
  if ((note.title !== '新笔记' || note.body.trim()) && !confirm(`删除“${note.title}”？`)) return;
  await saver.flush();
  await snapshotRepository.capture(state, '删除笔记前');
  state = moveNoteToTrash(state, note.id);
  await persistImmediate('已移到回收站');
  editRenderNoteId = null;
  setView('shelf');
}

async function writeClipboard(text) {
  const value = String(text ?? '');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const fallback = document.createElement('textarea');
  fallback.value = value;
  fallback.setAttribute('readonly', '');
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  document.body.appendChild(fallback);
  fallback.select();
  const copied = document.execCommand('copy');
  fallback.remove();
  if (!copied) throw new Error('复制失败');
}

function showCopyToast(message = '已复制') {
  if (copyToastTimer) clearTimeout(copyToastTimer);
  elements.copyToast.textContent = message;
  elements.copyToast.hidden = false;
  copyToastTimer = setTimeout(() => {
    elements.copyToast.hidden = true;
    copyToastTimer = null;
  }, 1200);
}

async function copyNote(note = activeNote()) {
  if (!note) return;
  try {
    await writeClipboard(copyPayload(note));
    showCopyToast('已复制');
  } catch {
    showCopyToast('复制失败');
  }
}

function updateBodyFromEditor() {
  const note = activeNote();
  if (!note) return;
  state = updateNoteBody(state, note.id, elements.editBody.value);
  setSaveStatus('保存中…');
  saver.schedule(state);
}

function commitSourceEdit(result) {
  elements.editBody.value = result.source;
  elements.editBody.setSelectionRange(result.selectionStart, result.selectionEnd);
  updateBodyFromEditor();
  elements.editBody.focus({ preventScroll: true });
}

function applyWrap(marker) {
  commitSourceEdit(formatWrappedSource(
    elements.editBody.value,
    elements.editBody.selectionStart,
    elements.editBody.selectionEnd,
    marker,
  ));
}

function applyPrefix(prefix) {
  commitSourceEdit(formatPrefixedLines(
    elements.editBody.value,
    elements.editBody.selectionStart,
    elements.editBody.selectionEnd,
    prefix,
  ));
}

function insertText(text) {
  commitSourceEdit(insertSourceText(
    elements.editBody.value,
    elements.editBody.selectionStart,
    elements.editBody.selectionEnd,
    text,
  ));
}

async function renderSettingsLists() {
  const snapshots = await snapshotRepository.list();
  elements.snapshotList.replaceChildren(...snapshots.map(record => {
    const row = document.createElement('div');
    row.className = 'compact-row';
    const copy = document.createElement('div');
    copy.className = 'compact-row-copy';
    const title = document.createElement('strong');
    title.textContent = record.reason;
    const time = document.createElement('span');
    time.textContent = formatTime(record.createdAt);
    copy.append(title, time);
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.dataset.snapshotId = record.id;
    restore.textContent = '恢复';
    row.append(copy, restore);
    return row;
  }));

  elements.trashSummary.textContent = `${state.trash.length} 条`;
  elements.emptyTrash.disabled = state.trash.length === 0;
  elements.trashList.replaceChildren(...state.trash.map(item => {
    const row = document.createElement('div');
    row.className = 'compact-row';
    const copy = document.createElement('div');
    copy.className = 'compact-row-copy';
    const title = document.createElement('strong');
    title.textContent = item.note.title;
    const time = document.createElement('span');
    time.textContent = formatTime(item.deletedAt);
    copy.append(title, time);
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.dataset.trashId = item.id;
    restore.textContent = '恢复';
    row.append(copy, restore);
    return row;
  }));
}

async function openSettings() {
  await saver.flush();
  await renderSettingsLists();
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
}

async function preserveOnClose() {
  if (!state) return;
  commitTitleDraft();
  draftCache.save(state);
  await saver.flush();
}

elements.search.addEventListener('input', renderShelf);
elements.search.addEventListener('keydown', event => {
  if (event.key === 'Escape' && elements.search.value) {
    elements.search.value = '';
    renderShelf();
  }
});
elements.add.addEventListener('click', createNewNote);
elements.settings.addEventListener('click', openSettings);
elements.list.addEventListener('click', event => {
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const note = state.notes.find(item => item.id === action.dataset.noteId);
  if (!note) return;
  if (action.dataset.action === 'copy') copyNote(note);
  else selectNote(note.id);
});
elements.readBack.addEventListener('click', () => setView('shelf'));
elements.readCopy.addEventListener('click', () => copyNote());
elements.readEdit.addEventListener('click', () => {
  editRenderNoteId = null;
  setView('edit', { focus: true });
});
elements.readDelete.addEventListener('click', deleteActiveNote);
elements.editBack.addEventListener('click', async () => {
  commitTitleDraft();
  await saver.flush();
  editRenderNoteId = null;
  setView('read');
});
elements.editCopy.addEventListener('click', () => copyNote());
elements.editBody.addEventListener('input', updateBodyFromEditor);
elements.editTitle.addEventListener('input', markTitleDirty);
elements.editTitle.addEventListener('blur', commitTitleDraft);
elements.sourceToolbar.addEventListener('pointerdown', event => {
  if (event.target.closest('button')) event.preventDefault();
});
elements.sourceToolbar.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.wrap !== undefined) applyWrap(button.dataset.wrap);
  else if (button.dataset.prefix !== undefined) applyPrefix(button.dataset.prefix);
  else if (button.dataset.insert === 'divider') insertText('\n---\n');
});

elements.settingsDialog.addEventListener('click', event => {
  if (event.target === elements.settingsDialog) elements.settingsDialog.close();
});
elements.connectBackup.addEventListener('click', async () => {
  try {
    await persistImmediate();
    await backupService.connect(state);
  } catch (error) {
    renderBackupStatus({ code: 'failed', text: error.message || '连接备份目录失败' });
  }
});
elements.backupNow.addEventListener('click', async () => {
  await persistImmediate();
  await backupService.backupNow(state, { requestPermission: true });
});
elements.restoreBackup.addEventListener('click', async () => {
  try {
    const restored = await backupService.restore();
    if (!confirm(`从目录恢复 ${restored.notes.length} 条笔记？当前内容会先自动留底。`)) return;
    await snapshotRepository.capture(state, '目录恢复前');
    await replaceState(restored, '已从备份恢复');
    await renderSettingsLists();
  } catch (error) {
    renderBackupStatus({ code: 'failed', text: error.message || '恢复失败' });
  }
});
elements.disconnectBackup.addEventListener('click', () => backupService.disconnect());
elements.createSnapshot.addEventListener('click', async () => {
  await persistImmediate();
  await snapshotRepository.capture(state, '手动留底');
  await renderSettingsLists();
  setSaveStatus('已创建安全快照');
});
elements.snapshotList.addEventListener('click', async event => {
  const button = event.target.closest('[data-snapshot-id]');
  if (!button || !confirm('恢复这份安全快照？当前内容会先自动留底。')) return;
  const restored = await snapshotRepository.restore(button.dataset.snapshotId, state);
  await replaceState(restored, '已恢复安全快照');
  await renderSettingsLists();
});
elements.trashList.addEventListener('click', async event => {
  const button = event.target.closest('[data-trash-id]');
  if (!button) return;
  state = restoreTrashItem(state, button.dataset.trashId);
  await persistImmediate('已恢复');
  await renderSettingsLists();
  renderShelf();
});
elements.emptyTrash.addEventListener('click', async () => {
  if (!state.trash.length || !confirm(`永久删除回收站中的 ${state.trash.length} 条笔记？`)) return;
  await snapshotRepository.capture(state, '清空回收站前');
  state = emptyTrash(state);
  await persistImmediate('回收站已清空');
  await renderSettingsLists();
});
elements.exportJson.addEventListener('click', async () => {
  await persistImmediate();
  downloadTextFile(createJsonExport(state, { appVersion: runtime.appVersion }));
});
elements.exportMarkdown.addEventListener('click', async () => {
  await persistImmediate();
  downloadTextFile(createMarkdownExport(activeNote()));
});
elements.importJson.addEventListener('click', () => elements.importInput.click());
elements.importInput.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const imported = parseBackupText(await file.text());
    if (!confirm(`导入 ${imported.notes.length} 条笔记？当前内容会先自动留底。`)) return;
    await snapshotRepository.capture(state, 'JSON 导入前');
    await replaceState(imported, '已导入');
    await renderSettingsLists();
  } catch (error) {
    alert(error.message || '导入失败');
  }
});

document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    setView('shelf', { focus: true });
  }
  if (view === 'edit' && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    elements.editBack.click();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') preserveOnClose();
});
window.addEventListener('pagehide', preserveOnClose);

async function init() {
  document.documentElement.dataset.runtime = runtime.kind;
  elements.version.textContent = runtime.versionLabel;
  const canonical = await repository.getState();
  const emergencyDraft = draftCache.load();
  state = emergencyDraft ? chooseLatestState(canonical, emergencyDraft) : canonical;
  if (emergencyDraft) {
    state = await repository.saveState(state);
    draftCache.clear();
  }
  await backupService.init();
  setView('shelf');
  runtime.onReady?.();
}

init().catch(error => {
  console.error(error);
  elements.empty.hidden = false;
  elements.empty.textContent = error.message || '加载失败';
});
