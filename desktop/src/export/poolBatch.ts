// poolBatch.ts — a small work queue that hands independent jobs to lanes.
//
// A lane is one render host. Jobs are pulled in order, so the first frame
// starts immediately on every lane and the batch finishes as soon as the
// slowest lane does. A failure stops new work but lets running jobs settle.

export async function runPooled<T, R>(
  items: readonly T[],
  workers: number,
  run: (item: T, index: number, lane: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const lanes = Math.max(1, Math.min(Math.max(1, workers), items.length));
  let next = 0;
  let failed: unknown = null;
  const laneLoop = async (lane: number): Promise<void> => {
    for (;;) {
      if (failed) return;
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await run(items[index] as T, index, lane);
      } catch (e) {
        failed = failed ?? e;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, (_, lane) => laneLoop(lane)));
  if (failed) throw failed;
  return results;
}
