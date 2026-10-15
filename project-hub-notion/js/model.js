import { comparePromptsByMode } from './legacy/library-model.js';

export const BACKUP_SCHEMA = 1;
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const safeText = value => String(value ?? '').trim();
const linkAllowed = value => {
  if (!value) return '';
  try { const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol)) throw Error(); return u.href; }
  catch { throw new Error('项目链接必须为有效的 https:// 或 http:// 地址'); }
};

export function normalizeItem(input, existing = null) {
  if (!isObject(input)) throw new Error('记录必须为对象');
  const kind = input.kind ?? existing?.kind ?? 'prompt';
  if (!['project', 'prompt'].includes(kind)) throw new Error('记录类型必须为 project 或 prompt');
  const status = input.status ?? existing?.status ?? 'published';
  if (!['draft','published'].includes(status)) throw new Error('无效记录状态');
  if (status === 'draft' && kind !== 'prompt') throw new Error('草稿仅支持普通提示词');
  const title = safeText(input.title ?? existing?.title) || (status === 'draft' ? '未命名草稿' : '');
  if (!title || title.length > 160) throw new Error('标题需为 1–160 字');
  const body = String(input.body ?? existing?.body ?? '').trim();
  if (kind === 'prompt' && status === 'published' && !body) throw new Error('普通提示词的正文不能为空');
  if (body.length > 100000) throw new Error('正文过长（最多 100,000 字符）');
  const summary = safeText(input.summary ?? existing?.summary).slice(0, 400);
  const entry_url = linkAllowed(safeText(input.entry_url ?? existing?.entry_url));
  const current_url = linkAllowed(safeText(input.current_url ?? existing?.current_url));
  if (kind === 'project' && !entry_url) throw new Error('项目卡必须提供入口链接');
  return { kind, title, body, summary, entry_url, current_url, status };
}

export function sortedItems(items, query = '', onlyStarred = false) {
  const terms = safeText(query).normalize('NFKC').toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return items.filter(item => (!onlyStarred || item.starred) && terms.every(t => (
    [item.title, item.summary, item.body].some(v => String(v ?? '').normalize('NFKC').toLocaleLowerCase().includes(t))
  ))).sort((a,b) => Number(b.pinned)-Number(a.pinned) || Number(b.starred)-Number(a.starred)
    || comparePromptsByMode({ ...a, updatedAt: a.updated_at, tags: [] }, { ...b, updatedAt: b.updated_at, tags: [] }, 'updated'));
}

export function projectPrompt(item, mode = 'temporary') {
  if (item.kind !== 'project') return item.body;
  if (mode === 'handoff') {
    return [
      `请正式接手项目「${item.title}」，这是同一个 Worker 的对话交接，不新建平行状态。`,
      `项目入口：${item.entry_url}`,
      item.current_url ? `本项目 Current：${item.current_url}` : '请通过项目入口找到其权威 Current。',
      '只读取入口、Current、必要的 PM 共同规则，以及当前任务所需资料，不遍读历史。',
      '确认旧 Worker 停止写入后，简述真实进度、待办和边界；继承已有成果。仅继续 Current 中已获授权的下一步，不擅自扩大权限或重做已完成事项。',
      item.body ? `调用补充说明：${item.body}` : ''
    ].filter(Boolean).join('\n');
  }
  return [
    `请临时参考项目「${item.title}」处理我接下来提出的一次任务。`,
    `项目入口：${item.entry_url}`,
    '只按需读取入口和本次任务必要的规范。默认不正式接手原 Worker，不推进其持续队列，不修改项目 Current 或控制状态。',
    '如任务需要保存成果，先核对原项目规则、当前状态及我已给出的授权。请先等待我说明具体任务。',
    item.body ? `调用补充说明：${item.body}` : ''
  ].filter(Boolean).join('\n');
}

export function parseBackup(raw) {
  let data; try { data = JSON.parse(raw); } catch { throw new Error('备份不是有效 JSON'); }
  if (isObject(data) && data.schema_version === BACKUP_SCHEMA && Array.isArray(data.items)) {
    if (data.items.length > 2000) throw new Error('单次备份最多 2000 条');
    const ids = new Set();
    return data.items.map((v,i) => {
      const id = safeText(v?.id);
      if (!id || ids.has(id)) throw new Error(`第 ${i+1} 条 ID 缺失或重复`);
      ids.add(id);
      return { ...normalizeItem(v), id, pinned:Boolean(v.pinned), starred:Boolean(v.starred) };
    });
  }
  // Legacy Chrome extension schemaVersion 1/2, without automatically importing defaults.
  if (isObject(data) && [1,2].includes(Number(data.schemaVersion)) && Array.isArray(data.prompts)) {
    if (data.prompts.length > 2000) throw new Error('旧备份最多 2000 条');
    const ids = new Set();
    return data.prompts.map((p,i) => {
      const id = safeText(p?.id);
      if (!id || ids.has(id)) throw new Error(`第 ${i+1} 条旧备份缺少或重复 ID`);
      ids.add(id);
      return { ...normalizeItem({kind:'prompt',title:p.title,body:p.body}), id, starred:false, pinned:Boolean(p.pinned) };
    });
  }
  throw new Error('不支持的备份版本；支持 Project Hub schema_version: 1 和旧插件 schemaVersion: 1/2');
}

// Backup format remains schema_version:1; optional metadata is safe to ignore in older backups.
export function createBackup(items, {sourceApp, aiGuidance} = {}) {
  const fields = ['id','title','kind','summary','body','entry_url','current_url','starred','pinned','status'];
  const backup = {schema_version:BACKUP_SCHEMA, exported_at:new Date().toISOString()};
  if (sourceApp) backup.source_app=sourceApp;
  if (typeof aiGuidance==='string' && aiGuidance.trim()) backup.preferences={ai_guidance:aiGuidance.trim()};
  backup.items=items.map(v => Object.fromEntries(fields.map(k=>[k,v[k] ?? (k==='starred'||k==='pinned' ? false : k==='status'?'published' : '')])));
  return JSON.stringify(backup,null,2)+'\n';
}

// Preference restoration is explicitly optional: old backups never reset local preferences.
export function parseBackupSettings(raw) {
  let data; try {data=JSON.parse(raw);} catch {throw new Error('备份不是有效 JSON');}
  if (!isObject(data)) throw new Error('备份格式不正确');
  const source_app=typeof data.source_app==='string'?data.source_app:null;
  const settings=data.preferences;
  if (settings===undefined) return {source_app,ai_guidance:null};
  if (!isObject(settings)) throw new Error('备份的 AI 编辑偏好格式不正确');
  const value=settings.ai_guidance;
  if (value===undefined) return {source_app,ai_guidance:null};
  if (typeof value!=='string' || !value.trim() || value.trim().length>1500)
    throw new Error('备份的 AI 编辑偏好需为 1–1500 字');
  return {source_app,ai_guidance:value.trim()};
}
