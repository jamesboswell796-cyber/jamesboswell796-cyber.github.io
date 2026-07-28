import { createDebouncedSaver } from './autosave.js';
import { applyAppearance, QUIET_COLOR_TOKENS } from './appearance.js';
import { createBackupService } from './backup-service.js';
import { chooseLatestState, createDraftCache } from './draft-cache.js';
import { createJsonExport, createMarkdownExport, downloadTextFile, parseBackupText } from './export.js';
import {
  createNote,
  emptyTrash,
  moveNoteToTrash,
  permanentlyDeleteTrashItem,
  restoreTrashItem,
  setActiveNote,
  setPreferences,
  undoLatestDeletion,
  updateNoteBody,
  updateNoteTitle,
} from './model.js';
import { createMarkdownToolbar } from './markdown-toolbar.js';
import { createNoteEditSession } from './note-edit-session.js';
import { createNoteExcerpt, filterNotes } from './note-discovery.js';
import { createDocumentPipManager, isDocumentPipSupported, nextPipWidth } from './pip-manager.js';
import { createRichMarkdownEditor } from './rich-editor.js';
import { createSnapshotRepository } from './safety-snapshots.js';
import { createSidebarController } from './sidebar-controller.js';
import { createStorageRepository } from './storage.js';
import { resolveQuickNotesRuntime } from './runtime-context.js';

const COLOR_LABELS = Object.freeze({
  ink: '墨灰', graphite: '石墨灰', dusk: '暮灰紫', plum: '灰紫',
  slate: '蓝灰', denim: '雾靛灰', moss: '苔灰', sage: '鼠尾草灰',
  clay: '陶土灰', taupe: '暖褐灰', smoke: '烟灰', mist: '浅灰',
});

const runtime = resolveQuickNotesRuntime();
const repository = createStorageRepository(runtime.storageArea);
const snapshotRepository = createSnapshotRepository(runtime.storageArea);
const draftCache = createDraftCache(runtime.draftStorage, runtime.draftKey);
const elements = {
  workspace: document.querySelector('#workspace-surface'),
  drawer: document.querySelector('#workspace-drawer'),
  notesPanel: document.querySelector('#drawer-notes'),
  notesButton: document.querySelector('#rail-notes'),
  searchButton: document.querySelector('#rail-search'),
  previous: document.querySelector('#previous-note'),
  next: document.querySelector('#next-note'),
  drawerClose: document.querySelector('#drawer-close'),
  search: document.querySelector('#note-search'),
  list: document.querySelector('#note-list'),
  empty: document.querySelector('#note-empty'),
  count: document.querySelector('#note-count'),
  add: document.querySelector('#new-note'),
  remove: document.querySelector('#delete-note'),
  trashToggle: document.querySelector('#trash-toggle'),
  trashCount: document.querySelector('#trash-count'),
  trashPanel: document.querySelector('#trash-panel'),
  trashList: document.querySelector('#trash-list'),
  emptyTrash: document.querySelector('#empty-trash'),
  undoToast: document.querySelector('#undo-toast'),
  undoDelete: document.querySelector('#undo-delete'),
  pip: document.querySelector('#open-pip'),
  focusPip: document.querySelector('#focus-pip'),
  settingsButton: document.querySelector('#settings-button'),
  openShortcuts: document.querySelector('#open-shortcuts'),
  settingsDialog: document.querySelector('#settings-dialog'),
  popupSize: document.querySelector('#popup-size-select'),
  createSnapshot: document.querySelector('#create-snapshot'),
  snapshotList: document.querySelector('#snapshot-list'),
  backupStatus: document.querySelector('#backup-status'),
  connectBackup: document.querySelector('#connect-backup'),
  backupNow: document.querySelector('#backup-now'),
  restoreBackup: document.querySelector('#restore-backup'),
  disconnectBackup: document.querySelector('#disconnect-backup'),
  exportJson: document.querySelector('#export-json'),
  exportMarkdown: document.querySelector('#export-markdown'),
  importJson: document.querySelector('#import-json'),
  importInput: document.querySelector('#import-json-input'),
  toolbar: document.querySelector('#editor-markdown-toolbar'),
  appearance: [...document.querySelectorAll('[data-appearance]')],
  title: document.querySelector('#active-title'),
  editor: document.querySelector('#note-editor'),
  status: document.querySelector('#save-status'),
  version: document.querySelector('#version'),
};

let state;
let pipManager;
let compactPipWidth = 520;
let sidebarBeforePip = { expanded: true, mode: 'notes' };
let undoTimer = null;
let editSession;
let historyStatus = { canUndo: false, canRedo: false };

function activeNote() {
  return state.notes.find(note => note.id === state.activeNoteId) ?? state.notes[0];
}

function surfaceWindow() {
  return elements.workspace.ownerDocument?.defaultView ?? window;
}

function setStatus(text, saving = false) {
  elements.status.textContent = text;
  elements.status.classList.toggle('is-saving', saving);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function renderBackupStatus(status) {
  const folder = status.folderName ? ` · ${status.folderName}` : '';
  const hasDirectory = status.code !== 'disconnected';
  elements.backupStatus.textContent = `${status.text}${folder}`;
  elements.backupStatus.dataset.code = status.code;
  elements.connectBackup.textContent = hasDirectory ? '更换目录' : '选择目录';
  elements.backupNow.disabled = !hasDirectory;
  elements.restoreBackup.disabled = !hasDirectory;
  elements.disconnectBackup.disabled = !hasDirectory;
}

const backupService = createBackupService({ onStatus: renderBackupStatus, appVersion: runtime.appVersion });
const saver = createDebouncedSaver(async nextState => {
  try {
    state = await repository.saveState(nextState);
    editSession?.breakMerge(nextState.activeNoteId);
    draftCache.clear();
    backupService.schedule(state);
    setStatus('已保存');
  } catch {
    setStatus('保存失败');
  }
}, { delay: 450 });

let markdownToolbar;

function renderFormatContext(context) {
  markdownToolbar?.renderContext(context);
}

const editor = createRichMarkdownEditor({
  element: elements.editor,
  onSelectionContextChange: renderFormatContext,
  onChange(markdown, meta = {}) {
    if (!state) return;
    state = updateNoteBody(state, state.activeNoteId, markdown);
    editSession?.commit(meta.kind ?? 'body-typing');
    renderList();
    setStatus('保存中…', true);
    saver.schedule(state);
  },
});


function displayExcerpt(note) {
  const excerpt = createNoteExcerpt(note.body, 78);
  if (excerpt === note.title) return '仅有标题';
  const duplicatePrefix = `${note.title} · `;
  return excerpt.startsWith(duplicatePrefix) ? excerpt.slice(duplicatePrefix.length) : excerpt;
}

function renderList() {
  const filtered = filterNotes(state.notes, elements.search.value);
  const rows = filtered.map(note => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `note-row${note.id === state.activeNoteId ? ' is-active' : ''}`;
    button.dataset.noteId = note.id;
    button.title = note.title;

    const title = document.createElement('span');
    title.className = 'note-row-title';
    title.textContent = note.title;
    const excerpt = document.createElement('span');
    excerpt.className = 'note-row-excerpt';
    excerpt.textContent = displayExcerpt(note);
    button.append(title, excerpt);
    return button;
  });
  elements.list.replaceChildren(...rows);
  elements.empty.hidden = rows.length !== 0;
  elements.count.textContent = elements.search.value.trim()
    ? `${rows.length}/${state.notes.length}`
    : `${state.notes.length}`;
  renderNavigation();
}

function renderNavigation() {
  if (!state) return;
  const index = state.notes.findIndex(note => note.id === state.activeNoteId);
  elements.previous.disabled = index <= 0;
  elements.next.disabled = index < 0 || index >= state.notes.length - 1;
}

function renderHistory(nextStatus) {
  historyStatus = nextStatus;
  markdownToolbar?.renderHistory(historyStatus);
}

function renderTrash() {
  elements.trashCount.textContent = String(state.trash.length);
  elements.emptyTrash.disabled = state.trash.length === 0;
  if (!state.trash.length) {
    const empty = document.createElement('div');
    empty.className = 'trash-empty';
    empty.textContent = '回收站为空';
    elements.trashList.replaceChildren(empty);
    elements.trashPanel.hidden = true;
    elements.trashToggle.setAttribute('aria-expanded', 'false');
    return;
  }

  const rows = state.trash.map(item => {
    const row = document.createElement('article');
    row.className = 'trash-row';
    row.dataset.trashId = item.id;

    const title = document.createElement('div');
    title.className = 'trash-row-title';
    title.textContent = item.note.title;
    const meta = document.createElement('div');
    meta.className = 'trash-row-meta';
    meta.textContent = formatTime(item.deletedAt);
    const actions = document.createElement('div');
    actions.className = 'trash-row-actions';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.dataset.trashAction = 'restore';
    restore.textContent = '恢复';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.trashAction = 'delete';
    remove.textContent = '永久删除';
    actions.append(restore, remove);
    row.append(title, meta, actions);
    return row;
  });
  elements.trashList.replaceChildren(...rows);
}

function populateAppearanceControls() {
  for (const select of elements.appearance) {
    select.replaceChildren(...Object.keys(QUIET_COLOR_TOKENS).map(token => {
      const option = document.createElement('option');
      option.value = token;
      option.textContent = COLOR_LABELS[token];
      return option;
    }));
  }
}

function renderAppearance() {
  applyAppearance(elements.workspace, state.preferences.appearance);
  for (const select of elements.appearance) {
    const token = state.preferences.appearance[select.dataset.appearance];
    select.value = token;
    const swatch = select.closest('label')?.querySelector('.appearance-swatch');
    if (swatch) swatch.style.backgroundColor = QUIET_COLOR_TOKENS[token];
  }
}

async function renderSnapshots() {
  const records = await snapshotRepository.list();
  if (!records.length) {
    const empty = document.createElement('div');
    empty.className = 'snapshot-empty';
    empty.textContent = '尚无安全快照';
    elements.snapshotList.replaceChildren(empty);
    return;
  }
  elements.snapshotList.replaceChildren(...records.map(record => {
    const row = document.createElement('div');
    row.className = 'snapshot-row';
    const copy = document.createElement('div');
    copy.className = 'snapshot-copy';
    const reason = document.createElement('strong');
    reason.textContent = record.reason;
    const time = document.createElement('span');
    time.textContent = formatTime(record.createdAt);
    copy.append(reason, time);
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.dataset.snapshotId = record.id;
    restore.textContent = '恢复';
    row.append(copy, restore);
    return row;
  }));
}

function render({ focus = 'none' } = {}) {
  const note = activeNote();
  renderList();
  renderTrash();
  renderAppearance();
  elements.popupSize.value = state.preferences.popupSize;
  elements.title.value = note.title;
  editor.load(note.body, { focus: focus === 'body' });
  if (focus === 'title') {
    elements.title.focus({ preventScroll: true });
    elements.title.select();
  }
}

async function persistImmediate(message) {
  await saver.flush();
  state = await repository.saveState(state);
  draftCache.clear();
  backupService.schedule(state);
  if (message) setStatus(message);
}

async function applyHistorySnapshot(snapshot, direction) {
  const id = state.activeNoteId;
  state = updateNoteTitle(state, id, snapshot.title);
  state = updateNoteBody(state, id, snapshot.body);
  elements.title.value = snapshot.title;
  editor.load(snapshot.body, { focus: surfaceWindow().document.activeElement !== elements.title });
  setStatus(direction === 'undo' ? '已撤销' : '已重做');
  saver.schedule(state);
  renderList();
}

editSession = createNoteEditSession({
  getActiveNote: activeNote,
  applySnapshot: applyHistorySnapshot,
  onStatusChange: renderHistory,
});

markdownToolbar = createMarkdownToolbar({
  element: elements.toolbar,
  editor: {
    applyBlock: type => editor.applyBlock(type),
    applyInline: type => editor.applyInline(type),
    insertDivider: () => editor.insertDivider(),
    undo: () => editSession.undo(),
    redo: () => editSession.redo(),
  },
});
markdownToolbar.renderContext({ blockType: editor.getCurrentBlockType() });
markdownToolbar.renderHistory(historyStatus);

async function replaceState(nextState, message) {
  state = await repository.saveState(nextState);
  draftCache.clear();
  backupService.schedule(state);
  editSession.clear();
  render({ focus: 'body' });
  editSession.seedCurrent();
  setStatus(message);
}

async function switchNote(noteId) {
  if (!noteId || noteId === state.activeNoteId) return;
  await saver.flush();
  state = setActiveNote(state, noteId);
  await persistImmediate();
  editSession.seedCurrent();
  render({ focus: 'body' });
}

async function stepNote(delta) {
  const index = state.notes.findIndex(note => note.id === state.activeNoteId);
  const next = state.notes[index + Math.sign(Number(delta) || 0)];
  if (next) await switchNote(next.id);
}

async function addNote() {
  await saver.flush();
  state = createNote(state);
  elements.search.value = '';
  sidebar.open('notes');
  await persistImmediate('已新建');
  editSession.seedCurrent();
  render({ focus: 'title' });
}

function showUndoToast() {
  if (undoTimer) clearTimeout(undoTimer);
  elements.undoToast.hidden = false;
  undoTimer = setTimeout(() => {
    elements.undoToast.hidden = true;
    undoTimer = null;
  }, 6000);
}

function hideUndoToast() {
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = null;
  elements.undoToast.hidden = true;
}


function resizePipForSidebar(sidebarState) {
  if (!pipManager?.isOpen()) return;
  const pipWindow = pipManager.getWindow();
  const currentWidth = Number(pipWindow?.innerWidth) || compactPipWidth;
  const targetWidth = nextPipWidth({
    expanded: sidebarState.expanded,
    currentWidth,
    compactWidth: compactPipWidth,
  });
  pipManager.resizeTo(targetWidth, Number(pipWindow?.innerHeight) || 680);
}

function renderSidebarState(sidebarState) {
  elements.workspace.classList.toggle('is-drawer-open', sidebarState.expanded);
  elements.workspace.dataset.drawerMode = 'notes';
  elements.drawer.setAttribute('aria-hidden', String(!sidebarState.expanded));
  elements.notesButton.classList.toggle('is-active', sidebarState.expanded);
  elements.notesButton.setAttribute('aria-expanded', String(sidebarState.expanded));
  resizePipForSidebar(sidebarState);
}

const sidebar = createSidebarController({
  initialExpanded: runtime.initialDrawerExpanded,
  initialMode: 'notes',
  onChange: renderSidebarState,
  onSearchRequest() {
    surfaceWindow().requestAnimationFrame(() => elements.search.focus({ preventScroll: true }));
  },
});

pipManager = createDocumentPipManager({
  hostWindow: window,
  surface: elements.workspace,
  title: '随手记 · 置顶小窗',
  onBeforeOpen: () => persistImmediate(),
  onAfterOpen(pipWindow) {
    sidebarBeforePip = sidebar.getState();
    compactPipWidth = Number(pipWindow?.innerWidth) || 520;
    sidebar.close();
    editor.focusEnd();
  },
  onBeforeClose: () => saver.flush(),
  onAfterClose() {
    if (sidebarBeforePip.expanded) sidebar.open(sidebarBeforePip.mode);
    else sidebar.close();
    render();
    editor.focusEnd();
  },
});

async function openSettings() {
  await renderSnapshots();
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
}

elements.editor.addEventListener('blur', () => saver.flush());
elements.title.addEventListener('input', event => {
  if (!state) return;
  state = updateNoteTitle(state, state.activeNoteId, event.target.value);
  editSession.commit('title-typing');
  renderList();
  setStatus('保存中…', true);
  saver.schedule(state);
});
elements.title.addEventListener('blur', () => saver.flush());
elements.title.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  editor.focusEnd();
});
elements.list.addEventListener('click', event => {
  const row = event.target.closest('[data-note-id]');
  if (row) switchNote(row.dataset.noteId);
});
elements.search.addEventListener('input', renderList);
elements.search.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (elements.search.value) {
    elements.search.value = '';
    renderList();
  } else {
    sidebar.close();
    editor.focusEnd();
  }
});
elements.add.addEventListener('click', addNote);
elements.drawerClose.addEventListener('click', () => sidebar.close());
elements.notesButton.addEventListener('click', () => sidebar.toggle('notes'));
elements.searchButton.addEventListener('click', () => sidebar.focusSearch());
elements.previous.addEventListener('click', () => stepNote(-1));
elements.next.addEventListener('click', () => stepNote(1));
elements.settingsButton.addEventListener('click', openSettings);
elements.settingsDialog.addEventListener('click', event => {
  if (event.target === elements.settingsDialog) elements.settingsDialog.close();
});
elements.openShortcuts.addEventListener('click', () => runtime.openShortcutSettings?.());

elements.remove.addEventListener('click', async () => {
  const note = activeNote();
  if ((note.title !== '新笔记' || note.body.trim()) && !surfaceWindow().confirm(`删除“${note.title}”？`)) return;
  await saver.flush();
  await snapshotRepository.capture(state, '删除笔记前');
  state = moveNoteToTrash(state, note.id);
  editSession.clear(note.id);
  await persistImmediate('已移到回收站');
  editSession.seedCurrent();
  render({ focus: 'body' });
  showUndoToast();
  await renderSnapshots();
});

elements.undoDelete.addEventListener('click', async () => {
  state = undoLatestDeletion(state);
  await persistImmediate('已撤销删除');
  editSession.seedCurrent();
  render({ focus: 'body' });
  hideUndoToast();
});

elements.trashToggle.addEventListener('click', () => {
  const open = elements.trashPanel.hidden;
  elements.trashPanel.hidden = !open;
  elements.trashToggle.setAttribute('aria-expanded', String(open));
});

elements.trashList.addEventListener('click', async event => {
  const action = event.target.closest('[data-trash-action]');
  const row = event.target.closest('[data-trash-id]');
  if (!action || !row) return;
  if (action.dataset.trashAction === 'restore') {
    state = restoreTrashItem(state, row.dataset.trashId);
    await persistImmediate('已恢复');
    editSession.seedCurrent();
    render({ focus: 'body' });
    return;
  }
  if (!surfaceWindow().confirm('永久删除这条笔记？此操作不能撤销。')) return;
  await snapshotRepository.capture(state, '永久删除前');
  state = permanentlyDeleteTrashItem(state, row.dataset.trashId);
  await persistImmediate('已永久删除');
  render();
  await renderSnapshots();
});

elements.emptyTrash.addEventListener('click', async () => {
  if (!state.trash.length || !surfaceWindow().confirm(`永久删除回收站中的 ${state.trash.length} 条笔记？`)) return;
  await snapshotRepository.capture(state, '清空回收站前');
  state = emptyTrash(state);
  await persistImmediate('回收站已清空');
  render();
  await renderSnapshots();
});

elements.pip.addEventListener('click', async () => {
  try {
    if (pipManager.isOpen()) await pipManager.close();
    else {
      await pipManager.openOrFocus();
      elements.pip.classList.remove('is-requested');
    }
  } catch (error) {
    setStatus(error.message || '无法打开置顶小窗');
  }
});
elements.focusPip.addEventListener('click', () => pipManager.openOrFocus());

elements.appearance.forEach(select => select.addEventListener('change', async event => {
  const key = event.target.dataset.appearance;
  state = setPreferences(state, { appearance: { [key]: event.target.value } });
  renderAppearance();
  await persistImmediate('颜色已保存');
}));

elements.popupSize.addEventListener('change', async event => {
  state = setPreferences(state, { popupSize: event.target.value });
  await persistImmediate('弹窗尺寸已保存');
});

elements.createSnapshot.addEventListener('click', async () => {
  await saver.flush();
  await snapshotRepository.capture(state, '手动留底');
  await renderSnapshots();
  setStatus('已创建安全快照');
});

elements.snapshotList.addEventListener('click', async event => {
  const button = event.target.closest('[data-snapshot-id]');
  if (!button || !surfaceWindow().confirm('恢复这份安全快照？当前内容会先自动留底。')) return;
  const restored = await snapshotRepository.restore(button.dataset.snapshotId, state);
  await replaceState(restored, '已恢复安全快照');
  await renderSnapshots();
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
elements.disconnectBackup.addEventListener('click', () => backupService.disconnect());
elements.restoreBackup.addEventListener('click', async () => {
  try {
    const restored = await backupService.restore();
    if (!surfaceWindow().confirm(`从目录恢复 ${restored.notes.length} 条笔记？当前本地内容将被替换。`)) return;
    await snapshotRepository.capture(state, '目录恢复前');
    await replaceState(restored, '已从备份恢复');
    await renderSnapshots();
  } catch (error) {
    renderBackupStatus({ code: 'failed', text: error.message || '恢复失败' });
  }
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
    if (!surfaceWindow().confirm(`导入 ${imported.notes.length} 条笔记？当前本地内容将被替换。`)) return;
    await snapshotRepository.capture(state, 'JSON 导入前');
    await replaceState(imported, '已导入');
    await renderSnapshots();
  } catch (error) {
    surfaceWindow().alert(error.message || '导入失败');
  }
});

elements.workspace.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey) {
    const key = event.key.toLowerCase();
    const redo = (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey);
    if (key === 'z' || redo) {
      event.preventDefault();
      if (redo) editSession.redo();
      else editSession.undo();
      return;
    }
    if (key === 'k') {
      event.preventDefault();
      sidebar.focusSearch();
    }
  }
});

function preserveOnClose() {
  if (!state) return;
  draftCache.save(state);
  saver.flush();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') preserveOnClose();
});
window.addEventListener('pagehide', preserveOnClose);

async function init() {
  document.documentElement.dataset.runtime = runtime.kind;
  elements.version.textContent = runtime.versionLabel;
  populateAppearanceControls();
  const canonical = await repository.getState();
  const emergencyDraft = draftCache.load();
  state = emergencyDraft ? chooseLatestState(canonical, emergencyDraft) : canonical;
  if (emergencyDraft) {
    state = await repository.saveState(state);
    draftCache.clear();
  }
  await backupService.init();
  renderSidebarState(sidebar.getState());
  editSession.seedCurrent();
  render({ focus: 'body' });
  if (!isDocumentPipSupported(window)) {
    elements.pip.disabled = true;
    elements.pip.title = '当前浏览器不支持置顶小窗';
  }
  runtime.onReady?.();
}

init().catch(error => setStatus(error.message || '加载失败'));
