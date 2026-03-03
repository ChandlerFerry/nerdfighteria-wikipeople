import { createInterface, type Interface } from 'node:readline';

export function createLineReader(input: NodeJS.ReadableStream): Interface {
  return createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
}
