function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')), { once: true });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('无法读取图片')), { once: true });
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export function isSupportedImageFile(file) {
  return Boolean(file && /^image\/(?:png|jpeg|webp|gif)$/u.test(String(file.type ?? '')));
}

export async function compactImageFile(file, options = {}) {
  if (!isSupportedImageFile(file)) throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 图片');
  const maxBytes = Math.max(1_000_000, Number(options.maxBytes) || 16_000_000);
  if (Number(file.size) > maxBytes) throw new Error('图片过大，请选择小于 16 MB 的图片');
  const maxDimension = Math.max(320, Number(options.maxDimension) || 1600);
  const quality = Math.min(.95, Math.max(.55, Number(options.quality) || .84));
  const original = await readAsDataUrl(file);
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function' || !globalThis.document?.createElement) {
    return { dataUrl: original, name: file.name || 'image', type: file.type, width: 0, height: 0 };
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d', { alpha: true }).drawImage(bitmap, 0, 0, width, height);
    const outputType = file.type === 'image/png' ? 'image/png' : 'image/webp';
    const blob = await canvasToBlob(canvas, outputType, quality);
    if (!blob) return { dataUrl: original, name: file.name || 'image', type: file.type, width: bitmap.width, height: bitmap.height };
    return {
      dataUrl: await readAsDataUrl(blob),
      name: file.name || 'image',
      type: blob.type || outputType,
      width,
      height,
    };
  } catch {
    return { dataUrl: original, name: file.name || 'image', type: file.type, width: bitmap?.width || 0, height: bitmap?.height || 0 };
  } finally {
    bitmap?.close?.();
  }
}
