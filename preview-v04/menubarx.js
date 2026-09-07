import { createIndexedDbStorageArea } from '../js/web-storage.js';

const VERSION = '0.4.0-preview';
const storageArea = createIndexedDbStorageArea({ dbName: 'quickNotesMenubarXV04Preview' });

globalThis.__QUICK_NOTES_RUNTIME__ = {
  kind: 'web',
  storageArea,
  draftStorage: globalThis.localStorage,
  draftKey: 'quickNotesMenubarXV04PreviewEmergencyDraft',
  appVersion: 'menubarx-preview-0.4.0',
  versionLabel: 'Web 0.4.0 Preview',
  onReady() {
    document.documentElement.classList.add('is-ready');
  },
};

await import('./app.js');
