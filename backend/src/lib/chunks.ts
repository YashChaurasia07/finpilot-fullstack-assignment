/** Split a list into slices of at most `size` (keeps bulk inserts under Postgres' 65,535-parameter limit). */
export function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
