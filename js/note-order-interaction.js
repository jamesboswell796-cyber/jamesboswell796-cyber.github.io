export function keyboardReorderIntent(notes, noteId, direction) {
  if (!Array.isArray(notes)) return null;
  const index = notes.findIndex(note => note.id === noteId);
  if (index < 0) return null;
  if (direction === 'up' && index > 0) {
    return { targetId: notes[index - 1].id, placement: 'before' };
  }
  if (direction === 'down' && index < notes.length - 1) {
    return { targetId: notes[index + 1].id, placement: 'after' };
  }
  return null;
}

export async function persistReorderCandidate(currentState, candidateState, saveState) {
  try {
    return { saved: true, state: await saveState(candidateState) };
  } catch {
    return { saved: false, state: currentState };
  }
}

export function createReorderCriticalSection(setLocked) {
  let inFlight = false;
  return {
    isInFlight() {
      return inFlight;
    },
    async run(operation) {
      if (inFlight) return { accepted: false };
      inFlight = true;
      try {
        setLocked(true);
        return { accepted: true, value: await operation() };
      } finally {
        try {
          setLocked(false);
        } finally {
          inFlight = false;
        }
      }
    },
  };
}
