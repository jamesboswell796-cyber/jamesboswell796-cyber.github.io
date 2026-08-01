export function createChromeStorageArea(chromeApi = globalThis.chrome) {
  const local = chromeApi?.storage?.local;
  if (!local) throw new Error('Chrome 本地存储不可用');
  return {
    get: keys => local.get(keys),
    set: patch => local.set(patch),
    remove: keys => local.remove(keys),
    subscribe(listener) {
      const events = chromeApi.storage?.onChanged;
      if (!events?.addListener) return () => {};
      const handler = (changes, areaName) => {
        if (areaName !== 'local') return;
        const patch = {};
        for (const [key, change] of Object.entries(changes ?? {})) patch[key] = change?.newValue;
        listener(patch);
      };
      events.addListener(handler);
      return () => events.removeListener?.(handler);
    },
  };
}
