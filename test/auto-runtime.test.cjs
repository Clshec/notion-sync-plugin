'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','plugin.js'),'utf8');

test('SP onReady registers four opt-in background engines and unload clears all their timers',async()=>{
  let ready=null,unload=null,n=0;
  const timers=new Map(),hooks=new Map(),notionRequests=[],localWrites=[],syncWrites=[];
  const secrets=new Map(); // all opt-in flags absent by default
  const api={
    Hooks:{ACTION:'action',CURRENT_TASK_CHANGE:'currentTaskChange',
      TASK_CREATED:'taskCreated',TASK_COMPLETE:'taskComplete',
      TASK_UPDATE:'taskUpdate',PROJECT_LIST_UPDATE:'projectListUpdate'},
    registerHeaderButton(){},
    showIndexHtmlAsView(){},
    registerHook(type,fn){hooks.set(type,fn);},
    onReady(fn){assert.equal(ready,null);ready=fn;},
    onUnload(fn){assert.equal(unload,null);unload=fn;},
    async getSecret(k){return secrets.get(k)||null;},
    async setSecret(k,v){localWrites.push([k,v]);secrets.set(k,v);},
    async request(url,opts){notionRequests.push([url,opts]);throw new Error('no auto HTTP while off');},
    async loadSyncedData(){throw new Error('no synced metadata read while off');},
    async persistDataSynced(v,k){syncWrites.push([v,k]);},
    async listSyncedDataKeys(){throw new Error('no inventory read while off');}
  };
  const context={PluginAPI:api,console,
    localStorage:{getItem(){return null;}},
    setInterval(fn,ms){const id=++n;timers.set(id,{fn,ms});return id;},
    clearInterval(id){assert.ok(timers.has(id));timers.delete(id);}
  };
  vm.createContext(context);
  vm.runInContext(code,context,{filename:'plugin.js'});
  assert.equal(typeof ready,'function');
  assert.equal(typeof unload,'function');
  assert.equal(hooks.size,6);
  assert.equal(timers.size,0,'start only after SP signals readiness');
  await ready();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(timers.size,4,'planning, work time, habit day and project/task graph each register timer');
  assert.deepEqual([...timers.values()].map(v=>v.ms).sort((a,b)=>a-b),
    [15000,60000,60000,60000]);
  assert.equal(notionRequests.length,0,'disabled engines must not access Notion');
  assert.equal(localWrites.length,0,'disabled engines must not update local diagnostics');
  assert.equal(syncWrites.length,0,'disabled engines must not alter SuperSync metadata');
  for(const timer of timers.values())timer.fn(); // should still not poll Notion
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(notionRequests.length,0);
  await unload();
  assert.equal(timers.size,0,'SP unloading plugin clears all scheduled timers');
});

test('auto status records are local only and contain no task IDs or credentials',async()=>{
  const data=[];
  const api={async setSecret(k,v){data.push({key:k,value:v});}};
  const context={console};
  vm.createContext(context);
  vm.runInContext(code,context,{filename:'plugin.js'});
  const write=vm.runInContext('alfStoreAutoStatus',context);
  await write(api,'planning',{processed:8,updated:2,conflicts:1,errors:0,
    privateToken:'ntn_THIS_IS_A_TEST',taskId:'notion-page-private'});
  assert.equal(data.length,1);
  assert.equal(data[0].key,'alf-auto-status-local-v1-planning');
  const parsed=JSON.parse(data[0].value);
  assert.equal(parsed.version,1);
  assert.equal(parsed.counts.processed,8);
  assert.equal(parsed.counts.conflicts,1);
  assert.equal(parsed.outcome,'conflicts');
  assert.ok(!data[0].value.includes('ntn_THIS_IS_A_TEST'));
  assert.ok(!data[0].value.includes('notion-page-private'));
});
