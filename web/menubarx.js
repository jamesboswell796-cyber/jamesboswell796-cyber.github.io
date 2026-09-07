import { createIndexedDbStorageArea } from '../js/web-storage.js';

const VERSION = '0.4.0';
const storageArea = createIndexedDbStorageArea({ dbName: 'quickNotesMenubarX' });

globalThis.__QUICK_NOTES_RUNTIME__ = {
  kind: 'web',
  storageArea,
  draftStorage: globalThis.localStorage,
  draftKey: 'quickNotesMenubarXEmergencyDraft',
  appVersion: `menubarx-${VERSION}`,
  versionLabel: `Web ${VERSION}`,
  onReady() {
    document.documentElement.classList.add('is-ready');
  },
};

await import('./app.js');

if ('serviceWorker' in navigator && globalThis.isSecureContext) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}
