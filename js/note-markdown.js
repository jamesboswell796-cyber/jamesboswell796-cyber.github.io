export function noteToMarkdown(note) {
  const title = String(note?.title ?? '新笔记').replace(/[\r\n]+/gu, ' ').trim() || '新笔记';
  const body = String(note?.body ?? '').replace(/^\n+|\n+$/gu, '');
  return body ? `# ${title}\n\n${body}\n` : `# ${title}\n`;
}
