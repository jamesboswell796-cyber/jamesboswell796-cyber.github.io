export const PROMPT_LIBRARY_EXTENSION_ID = 'mhfajkeejbflmmdakajdookkepfeajjg';

function normalizePrompt(prompt) {
  const id = String(prompt?.id ?? '').trim();
  const title = String(prompt?.title ?? '').trim();
  const body = String(prompt?.body ?? '').trim();
  if (!id || !title || !body) return null;
  return {
    id,
    title,
    body,
    tags: Array.isArray(prompt?.tags) ? prompt.tags.map(value => String(value).trim()).filter(Boolean) : [],
  };
}

export function createPromptBridge(runtime = globalThis.chrome?.runtime, options = {}) {
  const extensionId = options.extensionId ?? PROMPT_LIBRARY_EXTENSION_ID;
  const timeoutMs = Math.max(200, Number(options.timeoutMs) || 1200);

  function request(message) {
    return new Promise(resolve => {
      if (!runtime?.sendMessage) {
        resolve(null);
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, timeoutMs);
      try {
        runtime.sendMessage(extensionId, message, response => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (runtime.lastError || !response?.ok) resolve(null);
          else resolve(response);
        });
      } catch {
        clearTimeout(timer);
        settled = true;
        resolve(null);
      }
    });
  }

  return {
    async available() {
      return Boolean(await request({ type: 'quickNotes:ping' }));
    },
    async list(query = '') {
      const response = await request({ type: 'quickNotes:listPrompts', query: String(query ?? '') });
      return (response?.prompts ?? []).map(normalizePrompt).filter(Boolean);
    },
    async get(id) {
      const response = await request({ type: 'quickNotes:getPrompt', id: String(id ?? '') });
      return normalizePrompt(response?.prompt);
    },
    async save(input) {
      const response = await request({
        type: 'quickNotes:savePrompt',
        prompt: {
          title: String(input?.title ?? '').trim(),
          body: String(input?.body ?? '').trim(),
          tags: Array.isArray(input?.tags) ? input.tags : [],
        },
      });
      return normalizePrompt(response?.prompt);
    },
  };
}
