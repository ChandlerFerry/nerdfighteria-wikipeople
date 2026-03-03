export function createProgressCounter(
  interval: number,
  onTick: (count: number) => void
): () => void {
  let count = 0;
  return () => {
    count++;
    if (count % interval === 0) onTick(count);
  };
}
