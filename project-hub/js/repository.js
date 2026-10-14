const KEY='project-hub-demo-v1';
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

export class LocalRepository {
  async list(){ return JSON.parse(localStorage.getItem(KEY)||'[]'); }
  async save(record, original=null) {
    const values=await this.list();
    const now=new Date().toISOString();
    const row={...record,id: original?.id || record.id || generateId(),revision:(original?.revision||0)+1,updated_at:now};
    if(original){const i=values.findIndex(x=>x.id===original.id);if(i<0||values[i].revision!==original.revision)throw Error('记录已被其他操作更新，请刷新');values[i]=row;}
    else values.push(row);
    localStorage.setItem(KEY,JSON.stringify(values));return row;
  }
  async remove(row) {const values=await this.list();localStorage.setItem(KEY, JSON.stringify(values.filter(v=>v.id!==row.id)));}
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
    if(!response.ok)throw Error(result?.msg || result?.error_description || result?.message || `云端操作失败 (${response.status})：${msg(result)}`);
    return result;
  }
  async login(email,password){
    const result=await this.request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},token:null});
    this.auth=result;localStorage.setItem(SESSION_KEY,JSON.stringify(result));return result;
  }
  logout(){this.auth=null;localStorage.removeItem(SESSION_KEY);}
  async ensureAuth(){
    if(!this.signedIn)throw Error('请先登录以读取云端内容');
    if(Date.now() < (this.auth.expires_at||0)*1000-45000)return;
    const result=await this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:this.auth.refresh_token},token:null});
    this.auth=result;localStorage.setItem(SESSION_KEY,JSON.stringify(result));
    // Supabase token refresh returns expires_in, expires_at often included; persist local fallback.
    if(!this.auth.expires_at)this.auth.expires_at=Math.floor(Date.now()/1000)+(result.expires_in||3600);
    localStorage.setItem(SESSION_KEY,JSON.stringify(this.auth));
  }
  async list(){await this.ensureAuth();return this.request('/rest/v1/hub_items?select=*&order=updated_at.desc');}
  async save(record, original=null){
    await this.ensureAuth();
    const data={kind:record.kind,title:record.title,summary:record.summary,body:record.body,entry_url:record.entry_url,current_url:record.current_url,starred:Boolean(record.starred),pinned:Boolean(record.pinned)};
    if(original){
      const rows=await this.request(`/rest/v1/hub_items?id=eq.${encodeURIComponent(original.id)}&revision=eq.${original.revision}&select=*`,{method:'PATCH',body:data,prefer:'return=representation'});
      if(rows.length===0)throw Error('云端记录已变更，未覆盖其他设备修改。请点击同步后重试。');
      return rows[0];
    }
    return (await this.request('/rest/v1/hub_items?select=*',{method:'POST',body:{...data,id:record.id||generateId()},prefer:'return=representation'}))[0];
  }
  async remove(row){
    await this.ensureAuth();
    const result=await this.request(`/rest/v1/hub_items?id=eq.${encodeURIComponent(row.id)}&revision=eq.${row.revision}&select=*`,{method:'DELETE',prefer:'return=representation'});
    if(result.length===0)throw Error('云端记录已变更，未删除其他设备修改。请同步后重试。');
  }
}
