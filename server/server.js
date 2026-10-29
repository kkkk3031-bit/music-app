import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (KEY=value lines) so no extra dependency is needed.
const envFile = path.join(here, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const port = Number(process.env.PORT) || 3030;
const dataDir = path.resolve(here, process.env.DATA_DIR || 'data');
const { server, close } = createApp({ dataDir });

server.listen(port, () => console.log(`Cadence listening on http://localhost:${port} (data: ${dataDir})`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await close();
    process.exit(0);
  });
}
