export function createProgressCounter(
  interval: number,
  onTick: (count: number) => void
): () => number {
  let count = 0;
  return () => {
    count++;
    if (count % interval === 0) onTick(count);
    return count;
  };
}
