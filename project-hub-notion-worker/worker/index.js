// Project Hub Notion adapter. Deploy as a PRIVATE Cloudflare Worker with Access.
// No secret is ever exposed to the public GitHub Pages demo or client JavaScript.
const version='2026-03-11';
const prop={title:'Name',id:'HubID',kind:'Kind',status:'Status',body:'Body',summary:'Summary',entry:'EntryUrl',current:'CurrentUrl',starred:'Starred',pinned:'Pinned'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const err=(message,status=400,applied=[])=>json({error:message,applied},status);
const text=v=>String(v??'');
function fromB64Url(s){const bytes=atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'='));return Uint8Array.from(bytes,c=>c.charCodeAt(0));}
async function accessAuthorized(request,env){
  const token=request.headers.get('Cf-Access-Jwt-Assertion');
  if(!token||!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD||!env.ALLOWED_EMAIL)return false;
  const parts=token.split('.');if(parts.length!==3)return false;
  try{
    const header=JSON.parse(new TextDecoder().decode(fromB64Url(parts[0])));
    const body=JSON.parse(new TextDecoder().decode(fromB64Url(parts[1])));
    if(header.alg!=='RS256'||!header.kid)return false;
    const now=Math.floor(Date.now()/1000);
    const domain=env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//,'').replace(/\/$/,'');
    if(body.iss!==`https://${domain}`||body.exp<=now||(body.nbf&&body.nbf>now))return false;
    if(![].concat(body.aud||[]).includes(env.ACCESS_AUD))return false;
    if(String(body.email||'').toLowerCase()!==env.ALLOWED_EMAIL.toLowerCase())return false;
    const k=await fetch(`https://${domain}/cdn-cgi/access/certs`,{cf:{cacheTtl:60,cacheEverything:true}});
    if(!k.ok)return false;const keys=(await k.json()).keys||[];
    const jwk=keys.find(x=>x.kid===header.kid&&x.kty==='RSA');if(!jwk)return false;
    const cryptoKey=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5',cryptoKey,fromB64Url(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  }catch{return false;}
}
function rich(value,max=100000){
 const chars=Array.from(text(value)).slice(0,max);
 if(!chars.length)return [];
 const out=[];for(let i=0;i<chars.length;i+=1800)out.push({type:'text',text:{content:chars.slice(i,i+1800).join('')}});
 return out;
}
const plain=p=>(p?.rich_text||p?.title||[]).map(v=>v.plain_text??v.text?.content??'').join('');
function toRow(page){
 const p=page.properties||{};return {
  id:plain(p[prop.id]),title:plain(p[prop.title])||'未命名草稿',kind:p[prop.kind]?.select?.name||'prompt',
  status:p[prop.status]?.select?.name||'published',body:plain(p[prop.body]),summary:plain(p[prop.summary]),
  entry_url:p[prop.entry]?.url||'',current_url:p[prop.current]?.url||'',starred:!!p[prop.starred]?.checkbox,
  pinned:!!p[prop.pinned]?.checkbox,revision:Date.parse(page.last_edited_time)||1,
  created_at:page.created_time,updated_at:page.last_edited_time,_page_id:page.id
 };
}
function validateRecord(row){
 if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Invalid record');
 const kind=row.kind||'prompt',status=row.status||'published';
 if(!['prompt','project'].includes(kind)||!['draft','published'].includes(status)||(status==='draft'&&kind!=='prompt'))throw Error('Invalid type/status');
 const title=text(row.title).trim()||(status==='draft'?'未命名草稿':'');
 if(!title||title.length>160)throw Error('Invalid title');
 const body=text(row.body);
 if(body.length>100000||(kind==='prompt'&&status==='published'&&!body.trim()))throw Error('Invalid body');
 for(const k of ['entry_url','current_url'])if(row[k]&&!/^https?:\/\//i.test(row[k]))throw Error('Invalid URL');
 if(kind==='project'&&!row.entry_url)throw Error('Missing project URL');
 return {title,kind,status,body,summary:text(row.summary).slice(0,400),entry_url:text(row.entry_url),current_url:text(row.current_url),starred:!!row.starred,pinned:!!row.pinned};
}
function toProperties(id,row){return {
 [prop.title]:{title:rich(row.title,160)},[prop.id]:{rich_text:rich(id,128)},
 [prop.kind]:{select:{name:row.kind}},[prop.status]:{select:{name:row.status}},
 [prop.body]:{rich_text:rich(row.body)},[prop.summary]:{rich_text:rich(row.summary,400)},
 [prop.entry]:{url:row.entry_url||null},[prop.current]:{url:row.current_url||null},
 [prop.starred]:{checkbox:!!row.starred},[prop.pinned]:{checkbox:!!row.pinned}
};}
async function notion(path,env,method='GET',body){
 for(let attempt=0;attempt<3;attempt++){
  const response=await fetch('https://api.notion.com/v1'+path,{method,headers:{'Authorization':`Bearer ${env.NOTION_TOKEN}`,'Notion-Version':version,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  if(response.status===429&&attempt<2){await new Promise(r=>setTimeout(r,Math.min(3000,Number(response.headers.get('Retry-After'))*1000||1000)));continue;}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(`Notion ${response.status}: ${String(data.message||'request rejected').slice(0,200)}`);
  return data;
 }
}
async function listRows(env){
 const out=[];let cursor;
 for(let page=0;page<30;page++){
  const body={page_size:100};if(cursor)body.start_cursor=cursor;
  const r=await notion(`/data_sources/${encodeURIComponent(env.NOTION_DATA_SOURCE_ID)}/query`,env,'POST',body);
  out.push(...(r.results||[]).filter(x=>!x.archived&&!x.in_trash).map(toRow).filter(x=>!!x.id));
  if(!r.has_more)return out;
  if(!r.next_cursor)throw Error('Notion pagination cursor missing');cursor=r.next_cursor;
 }
 throw Error('Too many Notion records (>3000)');
}
async function applyBatch(changes,env){
 if(!Array.isArray(changes)||changes.length<1||changes.length>100)throw Error('Batch must contain 1–100 actions');
 const seen=new Set();const original=await listRows(env);const byId=new Map(original.map(x=>[x.id,x]));
 // First validate the WHOLE request; only then begin to write. Notion itself has no cross-page transaction.
 const prepared=changes.map(c=>{
  if(!c||!['create','update','delete'].includes(c.action)||typeof c.id!=='string'||!c.id||c.id.length>128||seen.has(c.id))throw Error('Invalid / duplicate action ID');
  seen.add(c.id);const old=byId.get(c.id);
  if(c.action==='create'&&old)throw Error('ID already exists');
  if(c.action!=='create'&&(!old||old.revision!==c.base_revision))throw Error('Outdated record; none modified');
  return {...c,previous:old,record:c.action==='delete'?null:validateRecord(c.record)};
 });
 const applied=[];
 for(const c of prepared){
  try{
   let row=null;
   if(c.action==='create'){
    const page=await notion('/pages',env,'POST',{parent:{type:'data_source_id',data_source_id:env.NOTION_DATA_SOURCE_ID},properties:toProperties(c.id,c.record)});
    row=toRow(page);
   }else if(c.action==='update'){
    // Recheck immediate remote last_edited_time; ChatGPT/Notion edits also advance it.
    const fresh=await notion(`/pages/${c.previous._page_id}`,env);
    if(Date.parse(fresh.last_edited_time)!==c.previous.revision)throw Error('Notion page changed since review');
    const page=await notion(`/pages/${c.previous._page_id}`,env,'PATCH',{properties:toProperties(c.id,c.record)});
    row=toRow(page);
   }else{
    const fresh=await notion(`/pages/${c.previous._page_id}`,env);
    if(Date.parse(fresh.last_edited_time)!==c.previous.revision)throw Error('Notion page changed since review');
    await notion(`/pages/${c.previous._page_id}`,env,'PATCH',{archived:true});
   }
   applied.push({action:c.action,id:c.id,row:row&&Object.fromEntries(Object.entries(row).filter(([k])=>k!=='_page_id'))});
  }catch(error){return {ok:false,applied,error:'Part of Notion batch may have been saved: '+error.message};}
 }
 return {ok:true,applied};
}
export default {
 async fetch(request,env){
  // Fail closed if Access is missing or misconfigured. Protect the Worker itself in Cloudflare too.
  if(!await accessAuthorized(request,env))return err('Unauthorized: configure Cloudflare Access for this Worker',401);
  if(!env.NOTION_TOKEN||!env.NOTION_DATA_SOURCE_ID)return err('Notion integration not configured',503);
  const path=new URL(request.url).pathname;
  try{
   if(path==='/config.js')return new Response('window.PROJECT_HUB_CONFIG={backend:"notion"};',{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
   if(path==='/api/items'&&request.method==='GET'){
     const rows=await listRows(env);return json(rows.map(row=>Object.fromEntries(Object.entries(row).filter(([k])=>k!=='_page_id'))));
   }
   if(path==='/api/batch'&&request.method==='POST'){
    if(Number(request.headers.get('Content-Length')||0)>4*1024*1024)return err('Request too large',413);
    const raw=await request.text();if(raw.length>4*1024*1024)return err('Request too large',413);
    const data=JSON.parse(raw);const result=await applyBatch(data.changes,env);
    return result.ok?json(result.applied):err(result.error,409,result.applied);
   }
   if(path.startsWith('/api/'))return err('API not found',404);
   const asset=await env.ASSETS.fetch(request);
   const headers=new Headers(asset.headers);headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');
   headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
   return new Response(asset.body,{status:asset.status,headers});
  }catch(e){return err('Notion adapter error: '+String(e.message||e).slice(0,250),502);}
 }
};
export {accessAuthorized,toRow,toProperties,validateRecord,applyBatch,rich};
