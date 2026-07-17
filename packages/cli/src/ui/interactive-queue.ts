/**
 * Serializes exclusive CLI footer interactions (tool approval, workflow confirm,
 * plan review, choice, etc.) so concurrent callers cannot overwrite a single
 * pending Promise resolve.
 */
export function createExclusiveInteractiveQueue() {
  let tail: Promise<void> = Promise.resolve();

  return {
    runExclusiveInteractive<T>(fn: () => Promise<T>): Promise<T> {
      const run = tail.then(() => fn());
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

export type ExclusiveInteractiveQueue = ReturnType<typeof createExclusiveInteractiveQueue>;
