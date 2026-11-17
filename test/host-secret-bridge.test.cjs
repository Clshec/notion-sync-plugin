'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const src=fs.readFileSync(path.join(__dirname,'..','plugin.js'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.json'),'utf8'));
const marker='<meta name="alf-plugin-owner" content="alf-notion-super-productivity">';
const ctx={console};
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'plugin.js'});
const createHandler=vm.runInContext('alfCreateHostRpcHandler',ctx);

function mount(){
  const calls=[],out=[],stored=new Map();
  const authorized={postMessage(x){out.push(x);}};
  const unrelated={postMessage(x){throw new Error('Leaked response to unrelated iframe');}};
  const doc={querySelectorAll(){return [
    {contentWindow:authorized,srcdoc:'<!doctype html>'+marker},
    {contentWindow:unrelated,srcdoc:'<html>Other plugin</html>'}
  ];}};
  const api={
    async getSecret(k){calls.push(['get',k]);return stored.get(k)||null;},
    async setSecret(k,v){calls.push(['set',k]);stored.set(k,v);},
    async deleteSecret(k){calls.push(['delete',k]);stored.delete(k);},
    async request(url,options){calls.push(['http',url,options]);return {
      object:'data_source',id:'synthetic-only',
      properties:{'المصدر':{type:'title'}}
    };}
  };
  const onMessage=createHandler(api,doc);
  async function send(op,args,source=authorized){
    const prev=out.length;
    await onMessage({source,data:{channel:'alf-notion-host-rpc-v1',
      type:'request',id:'req-'+(prev+1),op,args}});
    return out.length===prev?null:out.at(-1);
  }
  return {calls,out,stored,authorized,unrelated,send};
}

test('SP 20 iframe source genuinely omits credential methods, so UI uses host bridge',()=>{
  assert.equal(manifest.minSupVersion,'20.0.0');
  assert.equal(manifest.version,'0.32.0');
  assert.ok(ui.includes(marker));
  assert.ok(ui.includes("alfHostRpc('setSecret'"));
  assert.ok(ui.includes("alfHostRpc('notion'"));
  assert.ok(ui.includes('function alfUiGetSecret'));
});

test('credential write is per-plugin local and never echoed on read',async()=>{
  const e=mount();
  const resp=await e.send('setSecret',{key:'alf-notion-token',value:'ntn_FAKE_TEST_ONLY'});
  assert.equal(resp.ok,true);
  assert.equal(e.stored.get('alf-notion-token'),'ntn_FAKE_TEST_ONLY');
  const read=await e.send('getSecret',{key:'alf-notion-token'});
  assert.equal(read.ok,true);
  assert.equal(read.value,'configured');
  assert.equal(JSON.stringify(e.out).includes('ntn_FAKE_TEST_ONLY'),false);
  await e.send('deleteSecret',{key:'alf-notion-token'});
  assert.equal(e.stored.has('alf-notion-token'),false);
});

test('unrelated iframe or unapproved secret keys cannot use Alf credential bridge',async()=>{
  const e=mount();
  const unauthorized=await e.send('setSecret',{key:'alf-notion-token',value:'FAKE'},e.unrelated);
  assert.equal(unauthorized,null);
  assert.equal(e.calls.length,0);
  const forbidden=await e.send('getSecret',{key:'another-plugin-token'});
  assert.equal(forbidden.ok,false);
  assert.equal(e.calls.length,0);
});

test('Notion GET uses host-side token, never exposes it in the response',async()=>{
  const e=mount();
  e.stored.set('alf-notion-token','ntn_FAKE_TEST_ONLY');
  const r=await e.send('notion',{path:'/data_sources/212b4a624b7d806989b9000b73ac11c8',
    method:'GET'});
  assert.equal(r.ok,true);
  assert.equal(r.value.object,'data_source');
  const http=e.calls.find(x=>x[0]==='http');
  assert.ok(http);
  assert.equal(http[1],'https://api.notion.com/v1/data_sources/212b4a624b7d806989b9000b73ac11c8');
  assert.equal(http[2].headers.Authorization,'Bearer ntn_FAKE_TEST_ONLY');
  assert.equal(JSON.stringify(e.out).includes('ntn_FAKE_TEST_ONLY'),false);
});

test('host rejects arbitrary Notion PATCHes, unrelated URLs and invalid methods',async()=>{
  const e=mount();
  e.stored.set('alf-notion-token','ntn_FAKE_TEST_ONLY');
  const page='/pages/212b4a624b7d806989b9000b73ac11c8';
  for(const args of [
    {path:'/users',method:'GET'},
    {path:page,method:'DELETE'},
    {path:page,method:'PATCH',body:{archived:true}},
    {path:page,method:'PATCH',body:{properties:{A:{number:3},B:{number:4}}}},
    {path:page,method:'PATCH',body:{properties:{A:{rich_text:[]}}}}
  ]){
    const resp=await e.send('notion',args);
    assert.equal(resp.ok,false);
  }
  assert.equal(e.calls.some(x=>x[0]==='http'),false);
});

test('host accepts only a single reviewed numeric or Status property PATCH',async()=>{
  const e=mount();
  e.stored.set('alf-notion-token','ntn_FAKE_TEST_ONLY');
  const path='/pages/212b4a624b7d806989b9000b73ac11c8';
  for(const v of [{number:2},{status:{name:'Done'}},{select:{name:'Done'}}]){
    const response=await e.send('notion',{path,method:'PATCH',body:{properties:{Status:v}}});
    assert.equal(response.ok,true);
  }
  assert.equal(e.calls.filter(x=>x[0]==='http').length,3);
});
