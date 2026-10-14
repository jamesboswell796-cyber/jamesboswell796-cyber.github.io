import {copyText} from './legacy/clipboard.js';
import {normalizeItem,sortedItems,projectPrompt,parseBackup,createBackup} from './model.js';
import {aiEditRequest,parseAIPatch,AI_DEFAULT_GUIDANCE} from './ai-protocol.js';
import {LocalRepository,SupabaseRepository} from './repository.js';

const $=id=>document.getElementById(id);
const config=window.PROJECT_HUB_CONFIG||{};
const cloud=Boolean(config.supabaseUrl && config.supabaseAnonKey);
const repo=cloud ? new SupabaseRepository(config) : new LocalRepository();
let items=[], editing=null, activeFilter='all', aiPending=null, backupPending=null, saving=false, toastTimer=null;
const themeKey='project-hub-theme';
const aiGuidanceKey='project-hub-ai-guidance-v1';
function getAiGuidance(){ return localStorage.getItem(aiGuidanceKey)||AI_DEFAULT_GUIDANCE; }

function toast(message){const el=$('toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),2800);}
function notifyError(err){console.error(err);toast(err?.message||'操作失败');}
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function btn(className,title,text,action){const b=el('button',className,text);b.type='button';b.title=title;b.setAttribute('aria-label',title);b.addEventListener('click',e=>{e.stopPropagation();action();});return b;}
function show(id){const d=$(id);if(!d.open)d.showModal();}
function hide(id){$(id).close();}
function saveTheme(next){document.documentElement.dataset.theme=next;localStorage.setItem(themeKey,next);}
function toggleTheme(){saveTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');}
const preferred=localStorage.getItem(themeKey)||((matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light');
saveTheme(preferred);
function updateStatus(){
  const status=$('storageStatus');status.replaceChildren();
  const dot=el('span',`status-dot${cloud?' cloud':''}`);status.append(dot,document.createTextNode(cloud?' 已连接个人云端':' 本地演示 · 未跨设备同步'));
  $('settingsMode').textContent=cloud?'个人云同步已启用。每次修改立即写入 Supabase，其他设备刷新或重新打开后可见。':'当前为本地演示：只保存在这台设备的浏览器。填写 config.js 并部署 Supabase 后可启用个人云同步。';
  $('refreshBtn').textContent=cloud?'↻ 从云端刷新':'↻ 刷新列表';
  $('logoutBtn').hidden=!cloud;
  $('syncNotice').textContent=cloud?'':'当前为本地演示模式：数据仅存于本浏览器，尚未启用云同步。';
}
async function reload(){
  try{items=await repo.list();render();updateStatus();}
  catch(err){items=[];render();notifyError(err);if(cloud){repo.logout();show('authDialog');}}
}
function closeMenus(){ document.querySelectorAll('.card-menu[open]').forEach(menu=>menu.open=false); }
function card(item){
  const article=el('article','prompt-card'); article.dataset.id=item.id;
  const main=btn('card-main',`复制${item.kind==='project'?'临时调用词':'提示词'}：${item.title}`,'',()=>copyItem(item));
  if(item.pinned) main.append(el('span','pinned-label','📌 置顶'));
  main.append(el('div','card-title',item.title),el('div','card-summary',item.summary|| (item.kind==='project'?'点击复制项目临时调用词':'点击复制提示词')));
  const bottom=el('div','card-bottom');
  bottom.append(el('span','card-hint',item.kind==='project'?'◇ 项目入口':'轻点卡片复制'));
  const tools=el('div','card-tools');
  tools.append(btn(`tool${item.starred?' star-active':''}`,item.starred?'取消收藏':'加入收藏',item.starred?'★':'☆',()=>changeFlag(item,'starred')));
  tools.append(btn('tool tool-ai','复制给 AI 修改','✧ AI',()=>copyForAI(item)));
  if(item.kind==='project')tools.append(btn('tool handoff','复制正式接手 Worker 提示词','接手',()=>copyItem(item,'handoff')));
  const menu=el('details','card-menu');
  const summary=el('summary','tool menu-trigger','···');summary.title='更多操作';summary.setAttribute('aria-label','更多操作');
  summary.addEventListener('click',e=>{e.stopPropagation();const wasOpen=menu.open;closeMenus(); if(wasOpen)menu.open=true;});
  const options=el('div','menu-popover');
  const opt=(name,label,run)=>options.append(btn('menu-option',name,label,()=>{menu.open=false;run();}));
  opt('编辑','✎ 编辑',()=>openEdit(item));
  opt('置顶',item.pinned?'取消置顶':'📌 置顶',()=>changeFlag(item,'pinned'));
  if(item.kind==='project')opt('打开项目入口','↗ 打开入口',()=>window.open(item.entry_url,'_blank','noopener,noreferrer'));
  menu.append(summary,options);tools.append(menu);
  bottom.append(tools);article.append(main,bottom);return article;
}

function render(){
  const q=$('search').value;const list=sortedItems(items,q,activeFilter==='star');
  $('allCount').textContent=items.length;$('starCount').textContent=items.filter(x=>x.starred).length;
  $('allFilter').classList.toggle('active',activeFilter==='all');$('starFilter').classList.toggle('active',activeFilter==='star');
  $('cards').replaceChildren(...list.map(card));$('empty').hidden=list.length>0;
  $('emptyTitle').textContent=items.length===0?'还没有提示词':activeFilter==='star'?'暂无收藏':'没有找到匹配项';
  $('emptySub').textContent=items.length===0?'点击「新建」，添加你的第一条提示词。':activeFilter==='star'?'为常用卡片点亮星标，它们会出现在这里。':'换个关键词试试，或者创建新提示词。';
  $('emptyNew').hidden=items.length>0;
}
async function write(record, original=null){
  if(saving)throw Error('上一项操作尚未完成');
  saving=true;
  try{const row=await repo.save(record,original);const ix=items.findIndex(v=>v.id===row.id);if(ix<0)items.push(row);else items[ix]=row;render();return row;}
  finally{saving=false;}
}
async function changeFlag(item,key){try{await write({...item,[key]:!item[key]},item);toast(key==='starred'?'收藏已更新':'置顶已更新');}catch(err){notifyError(err);}}
async function copyItem(item,mode='temporary'){
  const content=projectPrompt(item,mode);
  try{await copyText(content);toast(mode==='handoff'?'✓ 已复制正式接手词':'✓ 已复制到剪贴板');}
  catch{ $('manualCopyText').value=content;show('manualCopyDialog');$('manualCopyText').select(); }
}
function setKind(kind){const isProject=kind==='project';$('projectFields').hidden=!isProject;$('bodyLabel').textContent=isProject?'调用补充说明（可选）':'提示词正文';$('bodyHelp').textContent=isProject?'主卡片复制临时调用词；「接手」按钮复制正式接手词。':'点击卡片主体即可一键复制。';$('editBody').required=!isProject;$('editEntry').required=isProject;}
function openEdit(item=null){
  editing=item;
  $('editHeading').textContent=item?'编辑提示词':'新建提示词';
  $('editTitle').value=item?.title||'';$('editSummary').value=item?.summary||'';
  $('editEntry').value=item?.entry_url||'';$('editCurrent').value=item?.current_url||'';$('editBody').value=item?.body||'';
  const kind=item?.kind||'prompt';document.querySelector(`input[name="kind"][value="${kind}"]`).checked=true;
  setKind(kind);$('deleteBtn').hidden=!item;$('copyForAIBtn').hidden=!item;
  show('editDialog');$('editTitle').focus();
}
async function saveEdit(event){
  event.preventDefault();if(saving)return;
  const form=new FormData($('editForm'));const patch=Object.fromEntries(['kind','title','summary','body','entry_url','current_url'].map(k=>[k,String(form.get(k)||'')]));
  try{const fields=normalizeItem(patch);await write({...(editing||{}),...fields,starred:Boolean(editing?.starred),pinned:Boolean(editing?.pinned)},editing);hide('editDialog');toast('✓ 保存成功');}
  catch(err){notifyError(err);}
}
async function deleteEdit(){if(!editing)return;
  if(!confirm(`确定删除「${editing.title}」？删除后可通过已有 JSON 备份恢复。`))return;
  try{await repo.remove(editing);items=items.filter(v=>v.id!==editing.id);render();hide('editDialog');toast('已删除');}
  catch(err){notifyError(err);}
}
async function copyForAI(item=editing){if(!item)return;
  const request=aiEditRequest(item,getAiGuidance());
  try{await copyText(request);toast('✓ 已复制 AI 修改请求，直接粘贴给 ChatGPT 即可');}
  catch{$('manualCopyText').value=request;show('manualCopyDialog');$('manualCopyText').select();}
}

function previewItems(target,records,kind){
  target.replaceChildren();
  const labels={title:'标题',body:'正文',summary:'简介',kind:'类型',entry_url:'入口',current_url:'Current',starred:'收藏',pinned:'置顶'};
  const snippet=value=>{
    const text=String(value ?? '（空）');
    return text.length>180?text.slice(0,180)+'…（预览只显示前 180 字）':text;
  };
  for(const v of records){
    const block=el('div','preview-item');
    block.append(el('div','diff-title',kind==='ai'?`${v.action==='create'?'新增':'更新'} · ${v.after.title}`:`${v.existing?'合并':'新增'} · ${v.item.title}`));
    if(!v.changed.length){block.append(el('div','before-after','没有内容变化'));target.append(block);continue;}
    const original=kind==='ai'?v.before:v.existing;
    const next=kind==='ai'?v.after:v.data;
    for(const key of v.changed){
      const line=el('div','diff-line');line.append(el('div','diff-name',labels[key]||key));
      if(original)line.append(el('div','before-after','原：'+snippet(original[key])));
      line.append(el('div','before-after after','新：'+snippet(next[key])));
      block.append(line);
    }
    target.append(block);
  }
}
function openAI(){aiPending=null;$('aiInput').value='';$('aiPreview').replaceChildren();$('applyAiBtn').disabled=true;show('aiDialog');}
function previewAI(){aiPending=null;$('applyAiBtn').disabled=true;const box=$('aiPreview');box.replaceChildren();
  try{const changes=parseAIPatch($('aiInput').value,items);aiPending=changes;previewItems(box,changes,'ai');$('applyAiBtn').disabled=!changes.some(v=>v.changed.length);if(!changes.some(v=>v.changed.length))box.prepend(el('div','preview-item','内容无变化，无须导入。'));}
  catch(err){box.append(el('div','preview-item preview-error',err.message));}
}
async function applyAI(){if(!aiPending)return;let count=0;try{
  $('applyAiBtn').disabled=true;
  for(const change of aiPending){if(!change.changed.length)continue;
    const current=change.before?items.find(v=>v.id===change.id):null;
    if(change.before && current?.revision!==change.before.revision)throw Error('有记录在预览后发生变化，请重新检查差异');
    await write({...change.after,starred:Boolean(current?.starred),pinned:Boolean(current?.pinned)},current);count++;
  }
  aiPending=null;hide('aiDialog');toast(`✓ 已应用 ${count} 条修改`);
}catch(err){notifyError(err);$('aiPreview').prepend(el('div','preview-item preview-error',`已应用 ${count} 条；后续操作失败：${err.message}。请刷新后重新预览剩余修改。`));}
}
function downloadBackup(){const json=createBackup(items),blob=new Blob([json],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`project-hub-backup-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`✓ 已导出 ${items.length} 条记录`);}
async function readBackupFile(){const file=$('backupFile').files?.[0];if(!file)return;backupPending=null;$('backupPreview').replaceChildren();$('applyBackupBtn').hidden=true;
  try{if(file.size>4*1024*1024)throw Error('备份文件超过 4 MB，请拆分');
    const result=parseBackup(await file.text());const byId=new Map(items.map(v=>[v.id,v]));const changed=result.map(item=>{
      const existing=byId.get(item.id)||null;
      // The backup owns content but leaves existing personal star/pin choices intact.
      const data={...normalizeItem(item),starred:existing?.starred ?? item.starred,pinned:existing?.pinned ?? item.pinned};
      const keys=['title','body','kind','summary','entry_url','current_url','starred','pinned'];
      return {item,existing,data,changed:keys.filter(k=>existing?.[k]!==data[k])};
    }).filter(v=>v.changed.length);
    backupPending=changed;previewItems($('backupPreview'),changed,'backup');
    $('backupPreview').prepend(el('div','preview-item',`共读取 ${result.length} 条；待新增或更新 ${changed.length} 条。仅合并，不会删除当前记录。`));
    $('applyBackupBtn').hidden=changed.length===0;
  }catch(err){$('backupPreview').replaceChildren(el('div','preview-item preview-error',err.message));}
  finally{$('backupFile').value='';}
}
async function applyBackup(){if(!backupPending)return;let done=0;try{
  $('applyBackupBtn').disabled=true;
  for(const change of backupPending){const current=change.existing?items.find(v=>v.id===change.existing.id):null;
    if(change.existing && current?.revision!==change.existing.revision)throw Error('记录在预览后已改变，请重新导入备份');
    await write({...change.data,id:change.item.id},current);done++;
  }
  backupPending=null;$('backupPreview').replaceChildren();$('applyBackupBtn').hidden=true;toast(`✓ 合并 ${done} 条记录`);
}catch(err){notifyError(err);$('backupPreview').prepend(el('div','preview-item preview-error',`已合并 ${done} 条；其余未完成。请重新导入检查。`));}
finally{$('applyBackupBtn').disabled=false;}
}
async function login(e){e.preventDefault();try{await repo.login($('email').value,$('password').value);$('password').value='';hide('authDialog');await reload();toast('✓ 云端同步已连接');}catch(err){notifyError(err);}}

$('search').addEventListener('input',render);
$('newBtn').addEventListener('click',()=>openEdit());$('emptyNew').addEventListener('click',()=>openEdit());
$('allFilter').addEventListener('click',()=>{activeFilter='all';render();});
$('starFilter').addEventListener('click',()=>{activeFilter='star';render();});
$('themeBtn').addEventListener('click',toggleTheme);$('settingsThemeBtn').addEventListener('click',toggleTheme);
$('settingsBtn').addEventListener('click',()=>{$('aiGuidance').value=getAiGuidance();show('settingsDialog');});$('aiBtn').addEventListener('click',openAI);
$('editForm').addEventListener('submit',saveEdit);$('editForm').addEventListener('change',e=>{if(e.target.name==='kind')setKind(e.target.value);});
$('deleteBtn').addEventListener('click',deleteEdit);$('copyForAIBtn').addEventListener('click',()=>copyForAI(editing));
$('saveAiGuidanceBtn').addEventListener('click',()=>{const v=$('aiGuidance').value.trim();if(!v){toast('偏好不能为空，可选择恢复默认');return;}localStorage.setItem(aiGuidanceKey,v);toast('✓ AI 编辑偏好已保存');});
$('resetAiGuidanceBtn').addEventListener('click',()=>{$('aiGuidance').value=AI_DEFAULT_GUIDANCE;localStorage.removeItem(aiGuidanceKey);toast('✓ 已恢复默认');});
document.addEventListener('click',e=>{if(!e.target.closest('.card-menu'))closeMenus();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenus();});
$('previewAiBtn').addEventListener('click',previewAI);$('applyAiBtn').addEventListener('click',applyAI);
$('aiInput').addEventListener('input',()=>{$('applyAiBtn').disabled=true;aiPending=null;});
$('exportBtn').addEventListener('click',downloadBackup);$('importBtn').addEventListener('click',()=>$('backupFile').click());$('backupFile').addEventListener('change',readBackupFile);$('applyBackupBtn').addEventListener('click',applyBackup);
$('refreshBtn').addEventListener('click',async()=>{await reload();toast('列表已刷新');});
$('logoutBtn').addEventListener('click',()=>{repo.logout();items=[];render();hide('settingsDialog');show('authDialog');});
$('authForm').addEventListener('submit',login);
for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>hide(b.dataset.close));
for(const d of document.querySelectorAll('dialog:not(#authDialog)'))d.addEventListener('click',e=>{if(e.target===d)d.close();});
window.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();$('search').focus();}});
updateStatus();
if(cloud && !repo.signedIn)show('authDialog');else reload();
