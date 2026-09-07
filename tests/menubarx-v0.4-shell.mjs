import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, runtime, worker, app] = await Promise.all([
  readFile(new URL('../web/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../web/menubarx.js', import.meta.url), 'utf8'),
  readFile(new URL('../web/service-worker.js', import.meta.url), 'utf8'),
  readFile(new URL('../web/app.js', import.meta.url), 'utf8'),
]);

assert.match(html, /data-view="shelf"/, 'V0.4 must open in the single-column shelf view');
assert.match(html, /<textarea[^>]+id="edit-body"/u, 'Markdown editing must use a source textarea');
assert.doesNotMatch(html, /contenteditable/iu, 'MenubarX shell must not restore the old contenteditable editor');
assert.match(html, /Web 0\.4\.0/u, 'visible version label must be V0.4.0');
assert.match(runtime, /const VERSION = '0\.4\.0'/u, 'runtime version must be V0.4.0');
assert.match(runtime, /await import\('\.\/app\.js'\)/u, 'MenubarX runtime must load the dedicated V0.4 controller');
assert.doesNotMatch(runtime, /\.\.\/js\/editor\.js/u, 'MenubarX runtime must not load the shared legacy editor');
assert.match(worker, /quick-notes-menubarx-v0\.4\.0/u, 'service worker cache must be versioned V0.4.0');
assert.match(worker, /'\.\/app\.js'/u, 'offline shell must cache the V0.4 controller');
assert.match(worker, /'\.\/app-core\.js'/u, 'offline shell must cache V0.4 source helpers');
assert.doesNotMatch(worker, /rich-editor\.js/u, 'offline shell must not cache the old rich editor');

assert.doesNotMatch(
  app,
  /editTitle\.addEventListener\('input',\s*updateTitleFromEditor\)/u,
  'title input must not normalize and rewrite itself on every keystroke',
);
assert.match(
  app,
  /editTitle\.addEventListener\('blur',\s*commitTitleDraft\)/u,
  'title must normalize and save when the field is committed',
);
assert.match(
  app,
  /if \(view === 'edit' && nextView !== 'edit'\) commitTitleDraft\(\)/u,
  'leaving edit mode must commit a pending title before rendering another view',
);

console.log('menubarx-v0.4 shell: PASS');
