// Run with: node project-hub/tests/auth-recovery-test.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../js/repository.js',import.meta.url),'utf8');
const {SupabaseRepository,parseRecoveryFragment}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const memory=new Map();
globalThis.localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
let count=0;
function check(name,fn){return Promise.resolve().then(fn).then(()=>{count++;console.log('PASS',name);});}

await check('extracts a recovery session from the email redirect',()=>{
  assert.deepEqual(parseRecoveryFragment('#access_token=one-time-access&refresh_token=one-time-refresh&expires_in=1800&type=recovery'),{
    accessToken:'one-time-access'
  });
});
await check('returns a readable error for an expired recovery link',()=>{
  assert.deepEqual(parseRecoveryFragment('#error=access_denied&error_code=otp_expired&error_description=Email+link+has+expired'),{
    error:'Email link has expired'
  });
});
await check('rejects a recovery link that contains no access token',()=>{
  assert.deepEqual(parseRecoveryFragment('#type=recovery'),{error:'重置链接无效或已过期，请重新申请。'});
});
await check('does not treat an unrelated auth fragment as password recovery',()=>{
  assert.equal(parseRecoveryFragment('#access_token=signup-token&type=signup'),null);
});
await check('requests a reset link with the site callback and no user token',async()=>{
  const original=globalThis.fetch;let call;
  globalThis.fetch=async(url,options)=>{call={url,options};return {ok:true,status:200,json:async()=>({})};};
  try{
    const repo=new SupabaseRepository({supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'public-key'});
    await repo.requestPasswordRecovery('owner@example.com','https://example.com/project-hub/');
    const url=new URL(call.url);
    assert.equal(url.pathname,'/auth/v1/recover');
    assert.equal(url.searchParams.get('redirect_to'),'https://example.com/project-hub/');
    assert.equal(call.options.method,'POST');
    assert.equal(call.options.headers.apikey,'public-key');
    assert.equal(call.options.headers.Authorization,undefined);
    assert.deepEqual(JSON.parse(call.options.body),{email:'owner@example.com'});
  }finally{globalThis.fetch=original;}
});
await check('updates the password using only the one-time recovery access token',async()=>{
  const original=globalThis.fetch;let call;
  globalThis.fetch=async(url,options)=>{call={url,options};return {ok:true,status:200,json:async()=>({id:'user-id'})};};
  try{
    const repo=new SupabaseRepository({supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'public-key'});
    await repo.updatePassword('new-password','one-time-access');
    assert.equal(new URL(call.url).pathname,'/auth/v1/user');
    assert.equal(call.options.method,'PUT');
    assert.equal(call.options.headers.Authorization,'Bearer one-time-access');
    assert.deepEqual(JSON.parse(call.options.body),{password:'new-password'});
    assert.equal(memory.has('project-hub-session'),false);
  }finally{globalThis.fetch=original;}
});

console.log('auth recovery tests:',count,'/ 6');
