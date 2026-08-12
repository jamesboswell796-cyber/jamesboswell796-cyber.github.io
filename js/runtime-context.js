function safeLocalStorage() {
  try { return globalThis.localStorage ?? null; }
  catch { return null; }
}

function chromeRuntime() {
  const chromeApi = globalThis.chrome;
  if (!chromeApi?.storage?.local || !chromeApi?.runtime?.getManifest) return null;
  const manifest = chromeApi.runtime.getManifest();
  return {
    kind: 'chrome',
    storageArea: chromeApi.storage.local,
    draftStorage: safeLocalStorage(),
    draftKey: 'quickNotesEmergencyDraft',
    appVersion: String(manifest.version || '0.0.0'),
    versionLabel: `v${manifest.version || '0.0.0'}`,
    openShortcutSettings: () => chromeApi.tabs?.create?.({ url: 'chrome://extensions/shortcuts' }),
    initialDrawerExpanded: false,
    onReady: null,
  };
}

export function resolveQuickNotesRuntime() {
  const override = globalThis.__QUICK_NOTES_RUNTIME__;
  if (override) {
    if (!override.storageArea) throw new Error('随手记本地存储不可用');
    return {
      kind: String(override.kind || 'web'),
      storageArea: override.storageArea,
      draftStorage: override.draftStorage ?? safeLocalStorage(),
      draftKey: String(override.draftKey || 'quickNotesWebEmergencyDraft'),
      appVersion: String(override.appVersion || '0.0.0'),
      versionLabel: String(override.versionLabel || `Web ${override.appVersion || '0.0.0'}`),
      openShortcutSettings: typeof override.openShortcutSettings === 'function'
        ? override.openShortcutSettings
        : null,
      initialDrawerExpanded: Boolean(override.initialDrawerExpanded),
      onReady: typeof override.onReady === 'function' ? override.onReady : null,
    };
  }
  const runtime = chromeRuntime();
  if (!runtime) throw new Error('随手记运行环境不可用');
  return runtime;
}
