export function createImagePreviewController(doc = globalThis.document) {
  if (!doc?.body) return { show() {}, close() {} };
  const dialog = doc.createElement('dialog');
  dialog.className = 'image-preview-dialog';
  const panel = doc.createElement('div');
  panel.className = 'image-preview-panel';
  const image = doc.createElement('img');
  image.alt = '';
  const caption = doc.createElement('div');
  caption.className = 'image-preview-caption';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'image-preview-close';
  close.setAttribute('aria-label', '关闭图片预览');
  close.textContent = '×';
  panel.append(image, caption, close);
  dialog.append(panel);
  doc.body.append(dialog);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  return {
    show(record) {
      if (!record?.dataUrl) return;
      image.src = record.dataUrl;
      image.alt = record.name || '图片';
      caption.textContent = record.name || '图片';
      if (!dialog.open) dialog.showModal();
    },
    close() { if (dialog.open) dialog.close(); },
    destroy() { dialog.remove(); },
  };
}
