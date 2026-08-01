async function loadPayload() {
  const response = await fetch(new URL('./rich-editor.payload.gz', import.meta.url));
  if (!response.ok || !response.body) throw new Error('无法载入编辑器核心');
  const source = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text();
  const moduleBase = new URL('./', import.meta.url).href;
  const rewritten = source.replaceAll("from './", `from '${moduleBase}`);
  const url = URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }));
  try { return await import(url); }
  finally { URL.revokeObjectURL(url); }
}

const module = await loadPayload();
export const normalizeEditorMarkdown = module.normalizeEditorMarkdown;
export const visibleOffsetFromMarkdown = module.visibleOffsetFromMarkdown;
export const blockTypeFromElement = module.blockTypeFromElement;
export const createRichMarkdownEditor = module.createRichMarkdownEditor;
