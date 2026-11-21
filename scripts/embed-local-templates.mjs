import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { posterTemplates } from '../js/poster-renderer.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mime = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const lines = [
  '// For file:// use. Regenerate with: node scripts/embed-local-templates.mjs',
  'globalThis.localPosterTemplateImages = {',
];

for (const template of posterTemplates) {
  if (!template.src.startsWith('./')) throw new Error(`Unexpected template path: ${template.src}`);
  const relative = template.src.slice(2);
  const type = mime[extname(relative).toLowerCase()];
  if (!type) throw new Error(`Unknown image type: ${relative}`);
  const bytes = await readFile(join(root, relative));
  lines.push(`  ${JSON.stringify(template.src)}: ${JSON.stringify(`data:${type};base64,${bytes.toString('base64')}`)},`);
}

lines.push('};', '');
const target = join(root, 'assets/local-template-images.js');
await writeFile(target, lines.join('\n'));
console.log(`Wrote ${target} (${posterTemplates.length} templates). This file is gitignored.`);
