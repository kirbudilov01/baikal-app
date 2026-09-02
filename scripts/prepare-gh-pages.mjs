import { readFile, writeFile } from 'node:fs/promises';

const basePath = (process.env.EXPO_PUBLIC_BASE_URL || '/baikal-app').replace(/\/$/, '');
const indexPath = new URL('../dist/index.html', import.meta.url);
let html = await readFile(indexPath, 'utf8');

html = html
  .replaceAll('href="/favicon.ico"', `href="${basePath}/favicon.ico"`)
  .replaceAll('src="/_expo/', `src="${basePath}/_expo/`);

await writeFile(indexPath, html);
