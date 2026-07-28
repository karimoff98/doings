type Committer = () => void;

/**
 * Editors keep the text being typed in local state and push it to the store on a
 * debounce. Quitting must not race that debounce, so every open editor registers
 * a way to commit its text right now.
 */
const committers = new Set<Committer>();

/** Registers an editor; the returned function unregisters it. */
export function registerPendingEdit(commit: Committer): () => void {
  committers.add(commit);
  return () => {
    committers.delete(commit);
  };
}

/**
 * Pushes everything half-typed into the store. Runs before the database is
 * written, so the last characters are not lost on quit.
 */
export function commitPendingEdits(): void {
  // Iterating the set directly is safe: unregistering during a commit only
  // affects entries that have not been visited yet.
  for (const commit of committers) {
    try {
      commit();
    } catch (error) {
      // One broken editor must not stop the others, nor block the save.
      console.error('Не удалось зафиксировать правку перед сохранением:', error);
    }
  }
}
