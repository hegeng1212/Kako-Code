import { WorkflowStoppedError } from "../control.js";

export async function runParallel<T>(
  thunks: Array<() => Promise<T>>,
  concurrency = 8,
): Promise<Array<T | null>> {
  const results: Array<T | null> = new Array(thunks.length).fill(null);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < thunks.length) {
      const idx = next++;
      try {
        results[idx] = await thunks[idx]!();
      } catch (err) {
        if (err instanceof WorkflowStoppedError) throw err;
        results[idx] = null;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, thunks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function runPipeline<TItem, TResult = unknown>(
  items: TItem[],
  ...stages: Array<(prev: unknown, item: TItem, index: number) => Promise<unknown>>
): Promise<Array<TResult | null>> {
  const chains = items.map(async (item, index) => {
    let prev: unknown = item;
    for (const stage of stages) {
      if (prev === null) break;
      try {
        prev = await stage(prev, item, index);
      } catch (err) {
        if (err instanceof WorkflowStoppedError) throw err;
        prev = null;
        break;
      }
    }
    return prev as TResult | null;
  });
  return Promise.all(chains);
}
