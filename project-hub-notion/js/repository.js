const KEY='project-hub-notion-demo-v1';
function generateId(){
  if(globalThis.crypto?.randomUUID)return crypto.randomUUID();
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const SESSION_KEY='project-hub-session';
const base = cfg => cfg.supabaseUrl.replace(/\/$/, '');
const msg = (s) => s ? JSON.stringify(s).slice(0,250) : '网络错误';
const checkOps = ops => {
  if(!Array.isArray(ops)||ops.length<1||ops.length>2000)throw Error('每次提交需要 1–2000 条修改');
  const seen=new Set();
  for(const op of ops){
    if(!['create','update','delete'].includes(op?.action))throw Error('不支持的修改类型');
    if(!op.id||typeof op.id!=='string'||op.id.length>128||seen.has(op.id))throw Error('记录 ID 缺失、过长或重复');
    seen.add(op.id);
    if(op.action!=='create'&&(!Number.isSafeInteger(op.base_revision)||op.base_revision<1))throw Error('修改缺少原版本，请刷新后重试');
    if(op.action!=='delete'&&(!op.record||typeof op.record!=='object'))throw Error('修改内容不完整');
  }
};
const recordFields = o => Object.fromEntries(['kind','title','summary','body','entry_url','current_url','starred','pinned','status'].map(k=>[k,o[k]]));

export class LocalRepository {
  async list(){ return JSON.parse(localStorage.getItem(KEY)||'[]'); }
  async applyBatch(ops){
    checkOps(ops);
    const stored=await this.list();const rows=stored.map(x=>({...x}));const now=new Date().toISOString();const result=[];
    for(const op of ops){
      const i=rows.findIndex(x=>x.id===op.id);let row=null;
      if(op.action==='create'){
        if(i>=0)throw Error('记录 ID 已存在，未写入任何修改');
        row={...recordFields(op.record),id:op.id,revision:1,created_at:now,updated_at:now};rows.push(row);
      }else{
        if(i<0||rows[i].revision!==op.base_revision)throw Error('记录已由其他操作更新；本次全部取消，请刷新后重试');
        if(op.action==='delete')rows.splice(i,1);
        else{row={...rows[i],...recordFields(op.record),revision:rows[i].revision+1,updated_at:now};rows[i]=row;}
      }
      result.push({action:op.action,id:op.id,row});
    }
    localStorage.setItem(KEY,JSON.stringify(rows)); // exactly one durable write; failed validation writes nothing
    return result;
  }
  async save(record,original=null){
    const id=original?.id||record.id||generateId();
    const [r]=await this.applyBatch([{action:original?'update':'create',id,base_revision:original?.revision,record}]);return r.row;
  }
  async remove(row){await this.applyBatch([{action:'delete',id:row.id,base_revision:row.revision}]);}
}

export class SupabaseRepository {
  constructor(config){ this.config=config;this.auth=JSON.parse(localStorage.getItem(SESSION_KEY)||'null'); }
  get signedIn(){return Boolean(this.auth?.access_token);}
  async request(path,{method='GET',body=null,token=this.auth?.access_token,prefer}={}){
    const headers={apikey:this.config.supabaseAnonKey,'Content-Type':'application/json'};
    if(token) headers.Authorization=`Bearer ${token}`;
    if(prefer) headers.Prefer=prefer;
    let response;
    try{response=await fetch(`${base(this.config)}${path}`,{method,headers,body:body==null?undefined:JSON.stringify(body),cache:'no-store'});}
    catch{throw Error('无法访问云端。为避免数据分叉，本次没有改为本地保存。');}
    const result=response.status===204 ? null : await response.json().catch(()=>null);
    if(!response.ok){
      const err=new Error(result?.msg || result?.error_description || result?.message || `云端操作失败 (${response.status})：${msg(result)}`);
      err.status=response.status;throw err;
    }
    return result;
  }
  async login(email,password){
    const result=await this.request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},token:null});
    this.auth={...result,expires_at:result.expires_at||Math.floor(Date.now()/1000)+(result.expires_in||3600)};
    localStorage.setItem(SESSION_KEY,JSON.stringify(this.auth));return this.auth;
  }
  logout(){this.auth=null;localStorage.removeItem(SESSION_KEY);}
  async ensureAuth(){
    if(!this.signedIn)throw Error('请先登录以读取云端内容');
    if(Date.now() < (this.auth.expires_at||0)*1000-45000)return;
    const result=await this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:this.auth.refresh_token},token:null});
    this.auth={...result,expires_at:result.expires_at||Math.floor(Date.now()/1000)+(result.expires_in||3600)};
    localStorage.setItem(SESSION_KEY,JSON.stringify(this.auth));
  }
  async list(){
    await this.ensureAuth();
    // PostgREST projects often cap one response at 1,000 rows. Read all pages,
    // rather than silently hiding older records in a larger personal library.
    const pageSize=500, records=[];
    for(let offset=0;offset<20000;offset+=pageSize){
      const page=await this.request(`/rest/v1/hub_items?select=*&order=updated_at.desc,id.asc&limit=${pageSize}&offset=${offset}`);
      if(!Array.isArray(page))throw Error('云端列表响应格式错误，未替换当前内容');
      records.push(...page);
      if(page.length<pageSize)return records;
    }
    throw Error('云端列表超过 20000 条；为避免遗漏，请先分批整理后重试');
  }
  async applyBatch(ops){
    checkOps(ops);await this.ensureAuth();
    // A single Postgres RPC transaction. Never emulate an atomic batch with sequential REST writes.
    const result=await this.request('/rest/v1/rpc/hub_apply_batch',{method:'POST',body:{p_changes:ops}});
    if(!Array.isArray(result)||result.length!==ops.length)throw Error('云端返回异常，请刷新检查修改结果');
    return result;
  }
  // Compatibility for earlier callers and unit tests; user operations use applyBatch.
  async save(record,original=null){
    const id=original?.id||record.id||generateId();
    const [r]=await this.applyBatch([{action:original?'update':'create',id,base_revision:original?.revision,record}]);return r.row;
  }
  async remove(row){await this.applyBatch([{action:'delete',id:row.id,base_revision:row.revision}]);}
}
export { generateId };
