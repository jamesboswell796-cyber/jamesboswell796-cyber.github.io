const MODES = new Set(['notes', 'prompts']);

function normalizeMode(mode) {
  return MODES.has(mode) ? mode : 'notes';
}

export function createSidebarController(options = {}) {
  let state = {
    expanded: options.initialExpanded !== false,
    mode: normalizeMode(options.initialMode),
  };

  function publish(next) {
    if (next.expanded === state.expanded && next.mode === state.mode) return;
    state = next;
    options.onChange?.({ ...state });
  }

  function open(mode = state.mode) {
    publish({ expanded: true, mode: normalizeMode(mode) });
  }

  function close() {
    publish({ expanded: false, mode: state.mode });
  }

  function toggle(mode = state.mode) {
    const normalized = normalizeMode(mode);
    if (state.expanded && state.mode === normalized) close();
    else open(normalized);
  }

  function focusSearch() {
    open('notes');
    options.onSearchRequest?.();
  }

  function focusPromptSearch() {
    open('prompts');
    options.onPromptSearchRequest?.();
  }

  return {
    open,
    close,
    toggle,
    focusSearch,
    focusPromptSearch,
    getState: () => ({ ...state }),
  };
}
