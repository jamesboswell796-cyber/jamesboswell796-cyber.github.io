import assert from 'node:assert/strict';
import {
  sourceForEdit,
  copyPayload,
  filterShelfNotes,
  nextViewAfterNewNote,
  formatWrappedSource,
  formatPrefixedLines,
  insertSourceText,
} from '../web/app-core.js';

assert.equal(sourceForEdit({ body: '## ' }), '## ', 'incomplete H2 source must remain byte-for-byte');
assert.equal(sourceForEdit({ body: '## 标题\n\n- A\n- B' }), '## 标题\n\n- A\n- B', 'multiline Markdown must remain unchanged');
assert.equal(copyPayload({ body: '# Prompt\n\nDo this' }), '# Prompt\n\nDo this', 'copy must use full Markdown source');
assert.deepEqual(
  filterShelfNotes([
    { id: '1', title: '考试提示词', body: '查找 Edexcel M1' },
    { id: '2', title: '地址', body: '济南' },
  ], 'm1').map(note => note.id),
  ['1'],
  'search must match note body case-insensitively',
);
assert.equal(nextViewAfterNewNote(), 'edit', 'new note must open directly in edit mode');

assert.deepEqual(
  formatWrappedSource('abc', 0, 3, '**'),
  { source: '**abc**', selectionStart: 2, selectionEnd: 5 },
  'bold formatting must wrap source without parsing HTML',
);
assert.equal(
  formatPrefixedLines('标题', 0, 0, '## ').source,
  '## 标题',
  'H2 formatting must write a literal Markdown prefix',
);
assert.equal(
  formatPrefixedLines('A\nB', 0, 3, '- ').source,
  '- A\n- B',
  'list formatting must prefix each selected source line',
);
assert.equal(
  formatPrefixedLines('A\nB', 0, 3, '1. ').source,
  '1. A\n2. B',
  'ordered list formatting must number selected source lines',
);
assert.equal(
  insertSourceText('上\n下', 2, 2, '\n---\n').source,
  '上\n\n---\n下',
  'divider insertion must contain real newline characters, not literal backslash-n text',
);

console.log('menubarx-v0.4 core: PASS');
