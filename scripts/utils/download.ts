import { createWriteStream, unlinkSync } from 'node:fs';
import { Readable } from 'node:stream';

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

export async function downloadFile(
  url: string,
  destination: string
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body)
    throw new Error(`HTTP ${response.status} fetching ${url}`);

  const totalBytes = response.headers.get('content-length')
    ? Number.parseInt(response.headers.get('content-length')!, 10)
    : undefined;

  const out = createWriteStream(destination);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ReadableStream<Uint8Array> is correct at runtime
  const nodeStream = Readable.fromWeb(response.body as any);
  let downloaded = 0;
  let lastLogged = 0;
  const LOG_INTERVAL = 256 * 1024 * 1024;

  nodeStream.on('data', (chunk: Buffer) => {
    downloaded += chunk.length;
    if (downloaded - lastLogged >= LOG_INTERVAL) {
      const gb = (downloaded / 1024 / 1024 / 1024).toFixed(2);
      const total =
        totalBytes === undefined
          ? ''
          : ` / ${(totalBytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
      console.log(`  ${gb} GB${total}`);
      lastLogged = downloaded;
    }
  });

  nodeStream.pipe(out);
  try {
    await new Promise<void>((resolve, reject) => {
      out.on('finish', resolve);
      out.on('error', reject);
      nodeStream.on('error', reject);
    });
  } catch (downloadError) {
    try {
      unlinkSync(destination);
    } catch {
      /* ignore */
    }
    throw downloadError;
  }

  console.log(`  Done: ${(downloaded / 1024 / 1024 / 1024).toFixed(2)} GB`);
}
