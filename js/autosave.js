export function createDebouncedSaver(save, options = {}) {
  const delay = Number.isFinite(options.delay) ? options.delay : 450;
  const timers = options.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: id => clearTimeout(id),
  };
  let timer = null;
  let pending = undefined;
  let saving = Promise.resolve();

  async function commit() {
    if (pending === undefined) return saving;
    const value = pending;
    pending = undefined;
    if (timer !== null) timers.clear(timer);
    timer = null;
    saving = saving.then(() => save(value));
    return saving;
  }

  return {
    schedule(value) {
      pending = value;
      if (timer !== null) timers.clear(timer);
      timer = timers.set(() => commit(), delay);
    },
    flush: commit,
    hasPending() { return pending !== undefined; },
  };
}
