import {copyText} from './legacy/clipboard.js';
import {normalizeItem,sortedItems,projectPrompt,parseBackup,createBackup,parseBackupSettings} from './model.js';
import {aiEditRequest,parseAIPatch,AI_DEFAULT_GUIDANCE} from './ai-protocol.js';
import {LocalRepository,SupabaseRepository,generateId,parseRecoveryFragment} from './repository.js?v=auth-reset-20261018-1';
import {assemblePrompt,encodeRecipe,decodeRecipe,normalizeRecipe} from './composer.js';

const $=id=>document.getElementById(id);
const config=window.PROJECT_HUB_CONFIG||{};
const cloud=Boolean(config.supabaseUrl && config.supabaseAnonKey);
const repo=cloud ? new SupabaseRepository(config) : new LocalRepository();
let recoveryLink=cloud ? parseRecoveryFragment(window.location.hash) : null;
const hasRecoveryLink=Boolean(recoveryLink);
let recoveryAccessToken=recoveryLink?.accessToken||null;
const recoveryError=recoveryLink?.error||'';
if(hasRecoveryLink){window.history.replaceState(null,'',window.location.pathname+window.location.search);recoveryLink=null;}
let items=[], editing=null, activeFilter='all', aiPending=null, backupPending=null, saving=false, toastTimer=null, previewTimer=null;
let activeDraftId=null, draftTimer=null, draftFlushPromise=null;
let composeSources=[], composeEditing=null;
const undoStack=[];
const themeKey='project-hub-theme';
const aiGuidanceKey='project-hub-ai-guidance-v1';
function getAiGuidance(){ return localStorage.getItem(aiGuidanceKey)||AI_DEFAULT_GUIDANCE; }

function toast(message, undo=false){
  const area=$('toast');area.replaceChildren(document.createTextNode(message));
  if(undo&&undoStack.length){ const button=el('button','toast-undo','撤销');button.type='button';button.addEventListener('click',undoLast);area.append(button); }
  area.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>area.classList.remove('visible'),undo?9500:3300);
}
function updateUndoButton(){const button=$('undoSettingsBtn');if(button)button.disabled=!undoStack.length;}
function snapshot(row){return row ? {kind:row.kind,title:row.title,body:row.body,summary:row.summary,entry_url:row.entry_url,current_url:row.current_url,starred:row.starred,pinned:row.pinned,status:row.status||'published'} : null;}
async function commitOperations(ops,message,{trackUndo=true}={}){
  if(saving)throw Error('有操作正在保存，请完成后再试');
  saving=true;
  try{
    const before=new Map(items.map(r=>[r.id,{...r}]));
    const result=await repo.applyBatch(ops);const current=new Map(items.map(r=>[r.id,r]));
    for(const change of result){if(change.action==='delete')current.delete(change.id);else current.set(change.id,change.row);}
    items=[...current.values()];render();
    if(trackUndo){
      const inverse=[];
      for(const change of result.slice().reverse()){
        const previous=before.get(change.id);
        if(change.action==='create')inverse.push({action:'delete',id:change.id,base_revision:change.row.revision});
        if(change.action==='update')inverse.push({action:'update',id:change.id,base_revision:change.row.revision,record:snapshot(previous)});
        if(change.action==='delete')inverse.push({action:'create',id:change.id,record:snapshot(previous)});
      }
      undoStack.push(inverse);if(undoStack.length>5)undoStack.shift();updateUndoButton();
    }
    if(message)toast(message,trackUndo);
    return result;
  }finally{saving=false;}
}
async function undoLast(){
  if(saving||!undoStack.length)return;
  const inverse=undoStack.at(-1);
  try{
    const changes=await commitOperations(inverse,'↶ 已撤销最近一次操作',{trackUndo:false});
    undoStack.pop();
    // Earlier undo checkpoints for the same record must track its new revision.
    for(const change of changes){
      for(let i=undoStack.length-1;i>=0;i--){
        const prior=undoStack[i].find(op=>op.id===change.id);
        if(prior){if(prior.action!=='create'&&change.row)prior.base_revision=change.row.revision;break;}
      }
    }
    updateUndoButton();
  }
  catch(err){notifyError(err);toast('无法安全撤销：数据已变化，请刷新查看');}
}
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
  const dot=el('span',`status-dot${cloud?' cloud':''}`);status.append(dot,document.createTextNode(cloud?(repo.signedIn?' 个人云端 · 已登录':' 云同步已配置 · 待登录'):' 本地演示 · 未跨设备同步'));
  $('settingsMode').textContent=cloud?(repo.signedIn?'已登录个人云端。每次修改会请求保存到 Supabase，其他设备刷新或重新打开后可见。':'云同步已配置，但还没有登录。请登录后再查看或修改私有提示词。'):'当前为本地演示：只保存在这台设备的浏览器。填写 config.js 并部署 Supabase 后可启用个人云同步。';
  $('refreshBtn').textContent=cloud?'↻ 从云端刷新':'↻ 刷新列表';
  $('logoutBtn').hidden=!cloud;
  $('syncNotice').textContent=cloud?'':'当前为本地演示模式：数据仅存于本浏览器，尚未启用云同步。';
}
async function reload(){
  try{
    const latest=await repo.list();
    items=latest;render();updateStatus();return true;
  }catch(err){
    // A transient cloud failure is NOT a sign that the user's data disappeared.
    // Keep the last successful view; never fall back to an unsynced local copy.
    notifyError(err);
    if(cloud && (err?.status===401 || err?.status===403 || !repo.signedIn))show('authDialog');
    updateStatus();return false;
  }
}
function closeMenus(){ document.querySelectorAll('.card-menu[open]').forEach(menu=>menu.open=false); }
function card(item){
  const article=el('article','prompt-card'); article.dataset.id=item.id;
  const isDraft=item.status==='draft';
  const isRecipe=!isDraft&&typeof item.body==='string'&&item.body.startsWith('PROJECT_HUB_RECIPE_V1:');
  if(isDraft)article.classList.add('draft-card');
  const main=btn('card-main',isDraft?'继续写草稿':`复制${isRecipe?'动态组合':item.kind==='project'?'临时调用词':'提示词'}：${item.title}`,'',()=>isDraft?openDraft(item):copyItem(item));
  if(item.pinned) main.append(el('span','pinned-label','📌 置顶'));
  main.append(el('div','card-title',item.title),el('div','card-summary',isDraft?(item.body.slice(0,90)||'还没有内容，点击继续写'):item.summary|| (isRecipe?'引用当前项目记录，点击生成并复制':item.kind==='project'?'点击复制项目临时调用词':'点击复制提示词')));
  const bottom=el('div','card-bottom');
  bottom.append(el('span','card-hint',isDraft?'✎ 草稿 · 点击继续写':isRecipe?'◇ 动态组合':item.kind==='project'?'◇ 项目入口':'轻点卡片复制'));
  const tools=el('div','card-tools');
  if(!isDraft)tools.append(btn(`tool${item.starred?' star-active':''}`,item.starred?'取消收藏':'加入收藏',item.starred?'★':'☆',()=>changeFlag(item,'starred')));
  if(!isRecipe)tools.append(btn('tool tool-ai','复制给 AI 修改','✧ AI',()=>copyForAI(item)));
  if(item.kind==='project'){
    tools.append(btn('tool tool-compose','添加到提示词组装','组装',()=>openCompose(item)));
    tools.append(btn('tool handoff','复制正式接手 Worker 提示词','接手',()=>copyItem(item,'handoff')));
  }
  const menu=el('details','card-menu');
  const summary=el('summary','tool menu-trigger','···');summary.title='更多操作';summary.setAttribute('aria-label','更多操作');
  summary.addEventListener('click',e=>{e.stopPropagation();const wasOpen=menu.open;closeMenus(); if(wasOpen)menu.open=true;});
  const options=el('div','menu-popover');
  const opt=(name,label,run)=>options.append(btn('menu-option',name,label,()=>{menu.open=false;run();}));
  opt('编辑',isRecipe?'✎ 编辑组合':'✎ 编辑',()=>isDraft?openDraft(item):isRecipe?openCompose(null,item):openEdit(item));
  if(isRecipe)opt('删除','删除这个组合',()=>deleteRecipe(item));
  opt('置顶',item.pinned?'取消置顶':'📌 置顶',()=>changeFlag(item,'pinned'));
  if(item.kind==='project')opt('打开项目入口','↗ 打开入口',()=>window.open(item.entry_url,'_blank','noopener,noreferrer'));
  menu.append(summary,options);tools.append(menu);
  bottom.append(tools);article.append(main,bottom);return article;
}

function render(){
  const q=$('search').value;const published=items.filter(x=>x.status!=='draft'),drafts=items.filter(x=>x.status==='draft');
  const visible=activeFilter==='draft'?drafts:published;
  const list=sortedItems(visible,q,activeFilter==='star');
  $('allCount').textContent=published.length;$('starCount').textContent=published.filter(x=>x.starred).length;$('draftCount').textContent=drafts.length;
  for(const name of ['all','star','draft'])$(name+'Filter').classList.toggle('active',activeFilter===name);
  $('draftQuick').hidden=activeFilter!=='draft';
  $('cards').replaceChildren(...list.map(card));$('empty').hidden=list.length>0;
  $('emptyTitle').textContent=activeFilter==='draft'?'还没有草稿':activeFilter==='star'?'暂无收藏':'没有找到匹配项';
  $('emptySub').textContent=activeFilter==='draft'?'点击上方输入区，想写什么就写什么。':activeFilter==='star'?'为常用卡片点亮星标，它们会出现在这里。':'换个关键词试试，或者新建提示词。';
  $('emptyNew').hidden=activeFilter==='draft'||items.length>0;
}
async function write(record, original=null, label='✓ 已保存'){
  const id=original?.id||record.id||generateId();
  const [result]=await commitOperations([{action:original?'update':'create',id,base_revision:original?.revision,record}],label);
  return result.row;
}
async function changeFlag(item,key){try{await write({...item,[key]:!item[key]},item,key==='starred'?'收藏已更新':'置顶已更新');}catch(err){notifyError(err);}}
async function copyItem(item,mode='temporary'){
  let content;
  try{const recipe=decodeRecipe(item.body);content=recipe?assemblePrompt(recipe,items):projectPrompt(item,mode);}
  catch(err){notifyError(err);return;}
  try{await copyText(content);toast(mode==='handoff'?'✓ 已复制正式接手词':'✓ 已复制到剪贴板');}
  catch{ $('manualCopyText').value=content;show('manualCopyDialog');$('manualCopyText').select(); }
}
function liveProjects(){return items.filter(row=>row.kind==='project'&&row.status!=='draft'&&row.entry_url);}
function projectOption(row){const option=document.createElement('option');option.value=row.id;option.textContent=row.title;return option;}
function openCompose(main=null,saved=null){
  try{
    composeEditing=saved;const loaded=saved?decodeRecipe(saved.body):null;
    composeSources=loaded?.sources?.map(s=>({...s}))||[];
    const projects=liveProjects();
    $('composeMain').replaceChildren(el('option','','请选择主项目'),...projects.map(projectOption));
    $('composeMain').firstChild.value='';
    $('composeMain').value=loaded?.mainId||main?.id||'';
    $('composeMode').value=loaded?.mode||'temporary';
    $('composeTask').value=loaded?.task||'';
    show('composeDialog');updateCompose();
  }catch(err){notifyError(err);}
}
function composeData(){
  return normalizeRecipe({mode:$('composeMode').value,mainId:$('composeMain').value,
    task:$('composeTask').value,sources:composeSources});
}
function updateCompose(){
  const selected=$('composeMain').value;
  const all=liveProjects(),occupied=new Set([selected,...composeSources.map(s=>s.id)]);
  const previous=$('composeSource').value;
  const choose=el('option','','选择一项参考');choose.value='';
  $('composeSource').replaceChildren(choose,...all.filter(x=>!occupied.has(x.id)).map(projectOption));
  $('composeSource').value=occupied.has(previous)?'':previous;
  const chosen=$('composeChosen');chosen.replaceChildren();
  for(const [i,s] of composeSources.entries()){
    const row=items.find(x=>x.id===s.id);
    const box=el('div','compose-reference');
    const header=el('div','compose-ref-header');
    header.append(el('strong','',(s.role==='method'?'方法 · ':'参考 · ')+(row?.title||'原引用已失效')));
    const remove=btn('tool','移除参考','×',()=>{composeSources.splice(i,1);updateCompose();});
    header.append(remove);box.append(header);
    const note=el('input','compose-note');note.placeholder=s.role==='method'?'具体应用在哪一步（可选）':'具体借鉴什么（可选）';
    note.maxLength=400;note.value=s.note||'';note.setAttribute('aria-label','借鉴点：'+(row?.title||s.id));
    note.addEventListener('input',()=>{s.note=note.value;refreshComposePreview();});
    box.append(note);chosen.append(box);
  }
  refreshComposePreview();
}
function refreshComposePreview(){
  try{const spec=composeData();const result=assemblePrompt(spec,items);
    $('composeOutput').textContent=result;$('composeStatus').textContent='✓ 即时预览';
    $('composeCopyBtn').disabled=false;$('composeSaveBtn').disabled=false;
  }catch(err){$('composeOutput').textContent='请先完成选择。';$('composeStatus').textContent=err.message;
    $('composeCopyBtn').disabled=true;$('composeSaveBtn').disabled=true;}
}
function addComposeSource(role){
  const id=$('composeSource').value;
  if(!id){toast('先选择一个项目或 KH 方法入口');return;}
  composeSources.push({id,role,note:''});updateCompose();
}
async function copyComposed(){
  let value;
  try{value=assemblePrompt(composeData(),items);}catch(err){notifyError(err);return;}
  try{await copyText(value);toast('✓ 已复制完整提示词');}
  catch{$('manualCopyText').value=value;show('manualCopyDialog');$('manualCopyText').select();}
}
async function saveComposed(){
  try{const spec=composeData();assemblePrompt(spec,items);
    const main=items.find(x=>x.id===spec.mainId);
    const defaultName=composeEditing?.title||'组合 · '+main.title;
    const label=window.prompt('为常用组合起个名字',defaultName);
    if(label===null)return;
    if(!label.trim()){toast('请输入组合名称');return;}
    const record=normalizeItem({kind:'prompt',title:label.trim(),summary:'动态组合：引用当前项目与方法入口',body:encodeRecipe(spec),status:'published'});
    const result=await write({...record,starred:true,pinned:Boolean(composeEditing?.pinned)},composeEditing,'✓ 常用组合已保存');
    composeEditing=result;toast('✓ 已保存到正式词库 · 收藏');render();
  }catch(err){notifyError(err);}
}
async function deleteRecipe(row){
  if(!confirm('确定删除这个收藏组合吗？被引用的项目和方法不会删除。'))return;
  try{await commitOperations([{action:'delete',id:row.id,base_revision:row.revision}],'组合已删除');}
  catch(err){notifyError(err);}
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
  try{const fields=normalizeItem(patch);await write({...(editing||{}),...fields,starred:Boolean(editing?.starred),pinned:Boolean(editing?.pinned),status:'published'},editing,'✓ 保存成功');hide('editDialog');}
  catch(err){notifyError(err);}
}
async function deleteEdit(){if(!editing)return;
  if(!confirm(`确定删除「${editing.title}」？删除后可通过已有 JSON 备份恢复。`))return;
  try{await commitOperations([{action:'delete',id:editing.id,base_revision:editing.revision}],'已删除');hide('editDialog');}
  catch(err){notifyError(err);}
}
async function copyForAI(item=editing){if(!item)return;
  const request=aiEditRequest(item,getAiGuidance());
  try{await copyText(request);toast('✓ 已复制 AI 修改请求，直接粘贴给 ChatGPT 即可');}
  catch{$('manualCopyText').value=request;show('manualCopyDialog');$('manualCopyText').select();}
}

function previewItems(target,records,kind){
  target.replaceChildren();
  const labels={title:'标题',body:'正文',summary:'简介',kind:'类型',entry_url:'入口',current_url:'Current',starred:'收藏',pinned:'置顶',status:'状态'};
  for(const v of records){
    const block=el('div','preview-item');
    block.append(el('div','diff-title',kind==='ai'?`${v.action==='create'?'新增':'更新'} · ${v.after.title}`:`${v.existing?'合并':'新增'} · ${v.item.title}`));
    if(!v.changed.length){block.append(el('div','before-after','内容无变化'));target.append(block);continue;}
    const original=kind==='ai'?v.before:v.existing;
    const next=kind==='ai'?v.after:v.data;
    for(const key of v.changed){
      const line=el('div','diff-line');line.append(el('div','diff-name',labels[key]||key));
      const a=original ? '原：'+String(original[key]??'（空）') : '';
      const b='新：'+String(next[key]??'（空）');
      // Long content is fully inspectable without filling the dialog initially.
      if(Math.max(a.length,b.length)>200){
        const fold=el('details','diff-expand');fold.append(el('summary','','展开查看完整修改（'+Math.max(a.length,b.length)+' 字）'));
        if(original)fold.append(el('div','before-after',a));fold.append(el('div','before-after after',b));line.append(fold);
      } else {
        if(original)line.append(el('div','before-after',a));line.append(el('div','before-after after',b));
      }
      block.append(line);
    }
    target.append(block);
  }
}
function openAI(){aiPending=null;$('aiInput').value='';$('aiPreview').replaceChildren();$('applyAiBtn').disabled=true;show('aiDialog');}
function previewAI(){
  aiPending=null;$('applyAiBtn').disabled=true;const box=$('aiPreview');box.replaceChildren();
  const raw=$('aiInput').value.trim();if(!raw)return;
  try{
    const changes=parseAIPatch(raw,items);aiPending=changes;previewItems(box,changes,'ai');
    const updated=changes.filter(v=>v.changed.length).length;
    box.prepend(el('div','preview-status',`已检查 ${changes.length} 条，实际修改 ${updated} 条 · 将整体提交`));
    $('applyAiBtn').disabled=updated===0;
  }catch(err){box.append(el('div','preview-item preview-error',err.message));}
}
async function applyAI(){
  if(!aiPending)return;
  $('applyAiBtn').disabled=true;
  try{
    const changes=aiPending.filter(v=>v.changed.length);
    const ops=changes.map(c=>({action:c.action,id:c.id||generateId(),base_revision:c.before?.revision,
      record:{...c.after,starred:Boolean(c.before?.starred),pinned:Boolean(c.before?.pinned),status:c.before?.status||'published'}}));
    await commitOperations(ops,`✓ 已整体应用 ${ops.length} 条修改`);
    aiPending=null;hide('aiDialog');
  }catch(err){notifyError(err);$('aiPreview').prepend(el('div','preview-item preview-error',`未应用任何修改：${err.message}`));}
}
function downloadBackup(){const json=createBackup(items,{sourceApp:'supabase',aiGuidance:getAiGuidance()}),blob=new Blob([json],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`project-hub-supabase-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`✓ 已导出 ${items.length} 条记录（含 AI 偏好）`);}
async function readBackupFile(){const file=$('backupFile').files?.[0];if(!file)return;backupPending=null;$('backupPreview').replaceChildren();$('applyBackupBtn').hidden=true;
  try{if(file.size>4*1024*1024)throw Error('备份文件超过 4 MB，请拆分');
    const raw=await file.text();const result=parseBackup(raw),metadata=parseBackupSettings(raw);
    const guidance=metadata.ai_guidance!==null && metadata.ai_guidance!==getAiGuidance()?metadata.ai_guidance:null;
    const byId=new Map(items.map(v=>[v.id,v]));const changed=result.map(item=>{
      const existing=byId.get(item.id)||null;
      // The backup owns content but leaves existing personal star/pin choices intact.
      const data={...normalizeItem(item),starred:existing?.starred ?? item.starred,pinned:existing?.pinned ?? item.pinned};
      const keys=['title','body','kind','summary','entry_url','current_url','starred','pinned','status'];
      return {item,existing,data,changed:keys.filter(k=>existing?.[k]!==data[k])};
    }).filter(v=>v.changed.length);
    backupPending={records:changed,guidance};previewItems($('backupPreview'),changed,'backup');
    if(guidance!==null){
      const row=el('div','preview-item');row.append(el('div','diff-title','AI 编辑偏好 · 待恢复'));
      const fold=el('details','diff-expand');fold.append(el('summary','','展开比较原偏好和备份偏好'));
      fold.append(el('div','before-after','原：'+getAiGuidance()),el('div','before-after after','新：'+guidance));
      row.append(fold);$('backupPreview').append(row);
    }
    const origin=metadata.source_app==='supabase'?'Supabase 版':metadata.source_app==='notion'?'Notion 版':'';
    $('backupPreview').prepend(el('div','preview-item',`共读取 ${result.length} 条；待合并 ${changed.length} 条${guidance!==null?'，AI 偏好将更新':''}。${origin?'来源：'+origin+'；':''}不会删除其他记录。`));
    $('applyBackupBtn').hidden=changed.length===0 && guidance===null;
  }catch(err){$('backupPreview').replaceChildren(el('div','preview-item preview-error',err.message));}
  finally{$('backupFile').value='';}
}
async function applyBackup(){
  if(!backupPending)return;
  $('applyBackupBtn').disabled=true;
  try{
    const pending=backupPending;
    const ops=pending.records.map(c=>({action:c.existing?'update':'create',id:c.existing?.id||c.item.id,
      base_revision:c.existing?.revision,record:{...c.data}}));
    if(ops.length)await commitOperations(ops,`✓ 已合并 ${ops.length} 条记录`);
    // Apply the preference only after record storage succeeds. Old backups leave it untouched.
    if(pending.guidance!==null){localStorage.setItem(aiGuidanceKey,pending.guidance);$('aiGuidance').value=pending.guidance;}
    backupPending=null;$('backupPreview').replaceChildren();$('applyBackupBtn').hidden=true;
    if(pending.guidance!==null)toast(ops.length?'✓ 已合并记录并恢复 AI 偏好':'✓ 已恢复 AI 编辑偏好');
  }catch(err){notifyError(err);$('backupPreview').prepend(el('div','preview-item preview-error',`未合并任何修改：${err.message}`));}
  finally{$('applyBackupBtn').disabled=false;}
}
async function login(e){e.preventDefault();try{
  await repo.login($('email').value,$('password').value);$('password').value='';
  const loaded=await reload();
  if(loaded){hide('authDialog');toast('✓ 云端同步已连接');}
}catch(err){notifyError(err);}}
function showAuthPanel(name){
  $('loginPanel').hidden=name!=='login';
  $('resetRequestPanel').hidden=name!=='request';
  $('passwordRecoveryPanel').hidden=name!=='change';
}
async function requestPasswordRecovery(e){
  e.preventDefault();const button=$('sendResetBtn');button.disabled=true;$('resetRequestStatus').textContent='';
  try{
    const redirectTo=new URL('./',window.location.href).href;
    await repo.requestPasswordRecovery($('resetEmail').value,redirectTo);
    $('resetRequestStatus').textContent='如果该邮箱已注册，重设密码邮件就会发出。请检查收件箱和垃圾邮件。';
  }catch(err){$('resetRequestStatus').textContent=err.message;}
  finally{button.disabled=false;}
}
async function saveRecoveredPassword(e){
  e.preventDefault();const status=$('passwordRecoveryStatus');status.textContent='';
  const password=$('newPassword').value,confirmation=$('confirmNewPassword').value;
  if(!recoveryAccessToken){status.textContent='这个重设链接无效或已过期。请返回登录页重新申请。';return;}
  if(password!==confirmation){status.textContent='两次输入的新密码不一致，请重新输入。';$('confirmNewPassword').focus();return;}
  const button=$('saveNewPasswordBtn');button.disabled=true;
  try{
    await repo.updatePassword(password,recoveryAccessToken);
    recoveryAccessToken=null;$('newPassword').value='';$('confirmNewPassword').value='';
    $('email').value=$('resetEmail').value||$('email').value;
    showAuthPanel('login');toast('✓ 新密码已保存，请用新密码登录');
  }catch(err){status.textContent=err.message;}
  finally{button.disabled=!recoveryAccessToken;}
}

// A draft is an ordinary record with status=draft. Drafts never appear in the published list.
// The editor queues writes and flushes before closing, so autosave cannot overwrite a later edit.
async function newDraft(){
  if(saving)return;
  try{
    const fields=normalizeItem({status:'draft',kind:'prompt',title:'未命名草稿',body:''});
    const row=await write({...fields,starred:false,pinned:false},null,'已创建草稿');
    activeFilter='draft';render();openDraft(row);
  }catch(err){notifyError(err);}
}
function draftValue(){
  return {title:$('draftTitle').value.trim()||'未命名草稿',body:$('draftBody').value,status:'draft',kind:'prompt'};
}
function openDraft(row){
  clearTimeout(draftTimer);activeDraftId=row.id;
  $('draftTitle').value=row.title==='未命名草稿'?'':row.title;
  $('draftBody').value=row.body;
  $('draftStatus').textContent='自动保存';show('draftDialog');$('draftBody').focus();
}
function draftDirty(row,data){return row.title!==data.title||row.body!==data.body;}
async function flushDraft(){
  clearTimeout(draftTimer);
  if(draftFlushPromise)return draftFlushPromise;
  if(!activeDraftId)return;
  const run=async()=>{
    for(let tries=0;tries<25;tries++){
      const row=items.find(x=>x.id===activeDraftId);
      if(!row||row.status!=='draft')return;
      const data=draftValue();
      if(!draftDirty(row,data)){$('draftStatus').textContent='✓ 已保存';return;}
      if(saving){await new Promise(r=>setTimeout(r,140));continue;}
      try{
        $('draftStatus').textContent='正在保存…';
        await write({...row,...data},row,null);
      }catch(err){$('draftStatus').textContent='保存失败，请检查网络后重试';throw err;}
    }
    throw Error('保存繁忙，请重试');
  };
  draftFlushPromise=run().finally(()=>{draftFlushPromise=null;});return draftFlushPromise;
}
function scheduleDraft(){clearTimeout(draftTimer);$('draftStatus').textContent='等待自动保存…';draftTimer=setTimeout(()=>flushDraft().catch(notifyError),750);}
async function closeDraft(){
  if(!activeDraftId)return;
  try{await flushDraft();$('draftDialog').close();activeDraftId=null;}
  catch(err){notifyError(err);}
}
async function promoteDraft(){
  if(!activeDraftId)return;
  try{
    await flushDraft();const row=items.find(x=>x.id===activeDraftId);
    if(!row)return;
    if(!$('draftTitle').value.trim()){$('draftStatus').textContent='请先给正式提示词起个标题';$('draftTitle').focus();return;}
    if(!row.body.trim()){$('draftStatus').textContent='正文不能为空';$('draftBody').focus();return;}
    const fields=normalizeItem({...row,status:'published',title:$('draftTitle').value.trim()});
    await write({...row,...fields},row,'✓ 已收入正式词库');
    $('draftDialog').close();activeDraftId=null;activeFilter='all';render();
  }catch(err){notifyError(err);}
}
async function deleteDraft(){
  const row=items.find(x=>x.id===activeDraftId);if(!row)return;
  if(!confirm('确定删除这条草稿吗？'))return;
  try{await commitOperations([{action:'delete',id:row.id,base_revision:row.revision}],'已删除草稿');$('draftDialog').close();activeDraftId=null;}
  catch(err){notifyError(err);}
}
async function draftAI(){
  try{await flushDraft();const row=items.find(x=>x.id===activeDraftId);if(row)await copyForAI(row);}
  catch(err){notifyError(err);}
}
$('draftFilter').addEventListener('click',()=>{activeFilter='draft';render();});
$('newDraftBtn').addEventListener('click',newDraft);
$('draftTitle').addEventListener('input',scheduleDraft);
$('draftBody').addEventListener('input',scheduleDraft);
$('closeDraftBtn').addEventListener('click',closeDraft);
$('draftAiBtn').addEventListener('click',draftAI);
$('draftDeleteBtn').addEventListener('click',deleteDraft);
$('promoteDraftBtn').addEventListener('click',promoteDraft);
$('draftDialog').addEventListener('cancel',event=>{event.preventDefault();closeDraft();});
$('draftDialog').addEventListener('click',event=>{if(event.target===$('draftDialog'))closeDraft();});

$('composeBtn').addEventListener('click',()=>openCompose());
$('composeMode').addEventListener('change',refreshComposePreview);
$('composeMain').addEventListener('change',updateCompose);
$('composeSource').addEventListener('change',()=>{});
$('composeTask').addEventListener('input',refreshComposePreview);
$('addReferenceBtn').addEventListener('click',()=>addComposeSource('reference'));
$('addMethodBtn').addEventListener('click',()=>addComposeSource('method'));
$('composeCopyBtn').addEventListener('click',copyComposed);
$('composeSaveBtn').addEventListener('click',saveComposed);
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
$('applyAiBtn').addEventListener('click',applyAI);
$('aiInput').addEventListener('input',()=>{clearTimeout(previewTimer);$('applyAiBtn').disabled=true;aiPending=null;previewTimer=setTimeout(previewAI,180);});
$('undoSettingsBtn').addEventListener('click',()=>undoLast());
$('exportBtn').addEventListener('click',downloadBackup);$('importBtn').addEventListener('click',()=>$('backupFile').click());$('backupFile').addEventListener('change',readBackupFile);$('applyBackupBtn').addEventListener('click',applyBackup);
$('refreshBtn').addEventListener('click',async()=>{if(await reload())toast('列表已刷新');});
$('logoutBtn').addEventListener('click',()=>{repo.logout();items=[];undoStack.length=0;updateUndoButton();render();hide('settingsDialog');show('authDialog');});
$('authForm').addEventListener('submit',login);
$('forgotPasswordBtn').addEventListener('click',()=>{$('resetEmail').value=$('email').value;$('resetRequestStatus').textContent='';showAuthPanel('request');$('resetEmail').focus();});
$('backToLoginBtn').addEventListener('click',()=>showAuthPanel('login'));
$('resetRequestForm').addEventListener('submit',requestPasswordRecovery);
$('passwordRecoveryForm').addEventListener('submit',saveRecoveredPassword);
$('recoveryBackBtn').addEventListener('click',()=>showAuthPanel('login'));
for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>hide(b.dataset.close));
for(const d of document.querySelectorAll('dialog:not(#authDialog)'))d.addEventListener('click',e=>{if(e.target===d)d.close();});
window.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();$('search').focus();}});
updateStatus();updateUndoButton();
if(cloud && hasRecoveryLink){
  show('authDialog');showAuthPanel('change');
  $('passwordRecoveryStatus').textContent=recoveryError;
  $('saveNewPasswordBtn').disabled=!recoveryAccessToken;
}else if(cloud && !repo.signedIn)show('authDialog');else reload();
