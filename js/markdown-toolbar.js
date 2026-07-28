const BLOCK_TYPES = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'blockquote']);
const PICKER_TYPES = new Set(['p', 'h1', 'h2', 'h3']);

function normalizeBlockType(value) {
  return BLOCK_TYPES.has(value) ? value : 'p';
}

export function createMarkdownToolbar({ element, editor }) {
  if (!element) throw new Error('Markdown toolbar element is required');
  if (!editor) throw new Error('Markdown editor is required');

  const blockSelect = element.querySelector('[data-toolbar-block]');
  const undoButton = element.querySelector('[data-action="undo"]');
  const redoButton = element.querySelector('[data-action="redo"]');

  function handlePointerDown(event) {
    if (event.target.closest('button')) event.preventDefault();
  }

  function handleChange(event) {
    if (event.target !== blockSelect) return;
    editor.applyBlock(normalizeBlockType(blockSelect.value));
  }

  function handleClick(event) {
    const button = event.target.closest('button');
    if (!button || !element.contains(button) || button.disabled) return;
    if (button.dataset.inline) editor.applyInline(button.dataset.inline);
    if (button.dataset.block) editor.applyBlock(button.dataset.block);
    if (button.dataset.action === 'divider') editor.insertDivider();
    if (button.dataset.action === 'undo') editor.undo?.();
    if (button.dataset.action === 'redo') editor.redo?.();
  }

  function renderContext({ blockType = null } = {}) {
    const currentType = normalizeBlockType(blockType);
    if (blockSelect) blockSelect.value = PICKER_TYPES.has(currentType) ? currentType : 'p';
    for (const button of element.querySelectorAll('[data-block]')) {
      const active = button.dataset.block === currentType;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function renderHistory({ canUndo = false, canRedo = false } = {}) {
    if (undoButton) undoButton.disabled = !canUndo;
    if (redoButton) redoButton.disabled = !canRedo;
  }

  element.addEventListener('pointerdown', handlePointerDown);
  element.addEventListener('change', handleChange);
  element.addEventListener('click', handleClick);

  return {
    renderContext,
    renderHistory,
    destroy() {
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('change', handleChange);
      element.removeEventListener('click', handleClick);
    },
  };
}
