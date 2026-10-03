/**
 * `items.map(fn)` with at most `limit` calls in flight. Results keep the
 * input order whatever order the calls finish in. A rejection rejects the
 * whole map once the calls already in flight settle.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  // Workers share one iterator, so each item is taken exactly once.
  const queue = items.entries();
  async function worker(): Promise<void> {
    for (const [index, item] of queue) {
      results[index] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
