// Only the private Cloudflare Worker serves /api endpoints. No Notion credential in browser.
export class NotionRepository {
  get signedIn(){return true;}
  async request(path,options){
    let r;try{r=await fetch(path,{cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});}
    catch{throw Error('Notion 服务无法访问，未改为本地保存');}
    const d=await r.json().catch(()=>null);
    if(!r.ok){const err=Error(d?.error||'Notion 服务返回错误 '+r.status);err.status=r.status;err.applied=d?.applied||[];throw err;}
    return d;
  }
  async list(){const r=await this.request('/api/items');if(!Array.isArray(r))throw Error('Notion 数据格式错误');return r;}
  async applyBatch(ops){
    const r=await this.request('/api/batch',{method:'POST',body:JSON.stringify({changes:ops})});
    if(!Array.isArray(r)||r.length!==ops.length)throw Error('Notion 返回条数与请求不一致，需刷新确认');
    return r;
  }
}
