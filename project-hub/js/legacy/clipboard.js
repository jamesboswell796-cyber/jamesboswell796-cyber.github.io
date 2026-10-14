export async function copyText(text, environment = {}) {
  const value = String(text ?? '');
  const navigatorObject = environment.navigator ?? globalThis.navigator;
  const documentObject = environment.document ?? globalThis.document;

  if (navigatorObject?.clipboard?.writeText) {
    try {
      await navigatorObject.clipboard.writeText(value);
      return 'clipboard';
    } catch {
      // Fall through to the legacy extension-page fallback.
    }
  }

  if (!documentObject?.body || typeof documentObject.createElement !== 'function') {
    throw new Error('复制失败，请手动选择正文');
  }

  const textarea = documentObject.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute?.('readonly', '');
  Object.assign(textarea.style ?? {}, {
    position: 'fixed',
    inset: '-9999px auto auto -9999px',
    opacity: '0',
  });
  documentObject.body.appendChild(textarea);
  textarea.select?.();

  try {
    const copied = documentObject.execCommand?.('copy');
    if (!copied) throw new Error('copy command failed');
    return 'fallback';
  } catch {
    throw new Error('复制失败，请手动选择正文');
  } finally {
    textarea.remove?.();
  }
}
