import assert from 'node:assert/strict';
import {
  sourceForEdit,
  copyPayload,
  filterShelfNotes,
  nextViewAfterNewNote,
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
console.log('menubarx-v0.4 core: PASS');
