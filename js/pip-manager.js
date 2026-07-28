export const DEFAULT_PIP_SIZE = Object.freeze({ width: 520, height: 680 });
export const EXPANDED_PIP_WIDTH = 790;

export function nextPipWidth({ expanded, currentWidth, compactWidth = DEFAULT_PIP_SIZE.width }) {
  const current = Number.isFinite(currentWidth) ? Math.round(currentWidth) : compactWidth;
  const compact = Number.isFinite(compactWidth) ? Math.round(compactWidth) : DEFAULT_PIP_SIZE.width;
  return expanded ? Math.max(current, EXPANDED_PIP_WIDTH) : compact;
}

export function isDocumentPipSupported(hostWindow = globalThis.window) {
  return typeof hostWindow?.documentPictureInPicture?.requestWindow === 'function';
}

export function copyDocumentStyles(sourceDocument, targetDocument) {
  for (const styleSheet of sourceDocument?.styleSheets ?? []) {
    if (styleSheet.href) {
      const link = targetDocument.createElement('link');
      link.rel = 'stylesheet';
      link.type = styleSheet.type || 'text/css';
      link.media = styleSheet.media?.mediaText || '';
      link.href = styleSheet.href;
      targetDocument.head.append(link);
      continue;
    }
    try {
      const rules = [...styleSheet.cssRules].map(rule => rule.cssText).join('');
      const style = targetDocument.createElement('style');
      style.textContent = rules;
      targetDocument.head.append(style);
    } catch {
      continue;
    }
  }
}

export function createDocumentPipManager(options) {
  const hostWindow = options.hostWindow ?? globalThis.window;
  const surface = options.surface;
  if (!surface) throw new Error('置顶小窗缺少写作界面');

  const homeParent = surface.parentNode;
  const homeNextSibling = surface.nextSibling;
  const size = options.size ?? DEFAULT_PIP_SIZE;
  const title = options.title ?? '随手记';
  let pipWindow = null;
  let active = false;
  let restoring = false;

  function isOpen() {
    return Boolean(active && pipWindow && !pipWindow.closed);
  }

  function restoreSurface() {
    if (!active || restoring) return;
    active = false;
    restoring = true;
    try {
      homeParent.insertBefore(surface, homeNextSibling);
      surface.classList.remove('is-pip');
      hostWindow.document?.documentElement?.classList?.remove('pip-active');
      pipWindow = null;
      options.onAfterClose?.();
    } finally {
      restoring = false;
    }
  }

  function attachWindow(requestedWindow) {
    if (!requestedWindow?.document) throw new Error('置顶小窗未能创建');
    pipWindow = requestedWindow;
    active = true;
    const pipDocument = requestedWindow.document;
    pipDocument.title = title;
    pipDocument.documentElement.lang = 'zh-CN';
    pipDocument.documentElement.className = 'pip-root';
    pipDocument.body.className = 'pip-document';
    copyDocumentStyles(hostWindow.document, pipDocument);
    pipDocument.body.append(surface);
    surface.classList.add('is-pip');
    hostWindow.document?.documentElement?.classList?.add('pip-active');
    requestedWindow.addEventListener('pagehide', restoreSurface, { once: true });
    options.onAfterOpen?.(requestedWindow);
    return requestedWindow;
  }

  async function openOrFocus(preopenedWindow = null) {
    if (isOpen()) {
      pipWindow.focus?.();
      return pipWindow;
    }
    if (!preopenedWindow && !isDocumentPipSupported(hostWindow)) {
      throw new Error('当前 Chrome 不支持置顶小窗');
    }

    await options.onBeforeOpen?.();
    const requestedWindow = preopenedWindow ?? await hostWindow.documentPictureInPicture.requestWindow({
      width: size.width,
      height: size.height,
      disallowReturnToOpener: true,
    });
    return attachWindow(requestedWindow);
  }

  function getWindow() {
    return isOpen() ? pipWindow : null;
  }

  function resizeTo(width, height) {
    if (!isOpen() || typeof pipWindow.resizeTo !== 'function') return false;
    const nextWidth = Math.max(320, Math.round(Number(width) || pipWindow.innerWidth || size.width));
    const nextHeight = Math.max(360, Math.round(Number(height) || pipWindow.innerHeight || size.height));
    try {
      pipWindow.resizeTo(nextWidth, nextHeight);
      return true;
    } catch {
      return false;
    }
  }

  async function close() {
    if (!isOpen()) return;
    await options.onBeforeClose?.();
    pipWindow.close();
    if (pipWindow) restoreSurface();
  }

  return { openOrFocus, close, isOpen, getWindow, resizeTo };
}
