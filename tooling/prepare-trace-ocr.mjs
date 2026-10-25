// Copy the locked npm engine into Vite's same-origin public directory. No CDN at runtime.
import { mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const worker = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
const target = new URL('../apps/trace/public/ocr/v7/runtime/', import.meta.url);
await mkdir(target, { recursive: true });
await copyFile(join(worker, 'dist/worker.min.js'), new URL('worker.min.js', target));
for (const variant of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) {
  const name = `tesseract-core-${variant}.wasm.js`;
  await copyFile(join(core, name), new URL(name, target));
}
await copyFile(join(worker, 'LICENSE.md'), new URL('tesseract-js-LICENSE.md', target));
await copyFile(join(core, 'LICENSE'), new URL('tesseract-core-LICENSE', target));
