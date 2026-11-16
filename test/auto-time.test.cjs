'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const code=fs.readFileSync(path.join(__dirname,'..','plugin.js'),'utf8');
const SOURCE='212b4a624b7d806989b9000b73ac11c8';
const PAGE='aab4a62b4b7d806989b9000b73ac11c8';
const ANCHOR_KEY='alf-time-anchor-v1-'+PAGE;
function fixture(){
  const props={
    'المصدر':{id:'id-title',type:'title',title:[{plain_text:'Tracked task'}]},
    'نوع الصفحة':{id:'id-type',type:'multi_select',multi_select:[{name:'مهمة'}]},
    'الوقت الفعلي':{id:'id-work',type:'number',number:2}
  };
  const schema={
    'المصدر':{id:'id-title',type:'title'},
    'نوع الصفحة':{id:'id-type',type:'multi_select'},
    'الوقت الفعلي':{id:'id-work',type:'number'}
  };
  const page={object:'page',id:PAGE,parent:{type:'data_source_id',data_source_id:SOURCE},
    properties:props,in_trash:false};
  const task={id:'sp-existing',title:'Tracked task',projectId:'projectX',parentId:null,
    notes:'alf-notion-page-id:'+PAGE,isDone:false,subTaskIds:[],
    timeSpent:7200000,timeEstimate:3600000,tagIds:['existing']};
  const c={version:2,taskSource:SOURCE,typeProp:'نوع الصفحة',actualProp:'الوقت الفعلي',
    typeValues:'مهمة, حزمة',unit:'hours',
    taskPropertyBindings:{
      typeProp:{sourceId:SOURCE,input:'نوع الصفحة',id:'id-type'},
      actualProp:{sourceId:SOURCE,input:'الوقت الفعلي',id:'id-work'}
    }
  };
  const spec={sourceId:SOURCE,typeId:'id-type',actualId:'id-work',
    unit:'hours',allowed:['حزمة','مهمة'].sort()};
  const anchor={version:1,notionId:PAGE,spId:task.id,sourceId:SOURCE,
    spec:JSON.stringify(spec),projectId:'projectX',parentId:null,
    expectedNotion:2,expectedSpMs:7200000};
  const store=new Map([
    ['alf-mapping-v2',JSON.stringify(c)],
    [ANCHOR_KEY,JSON.stringify(anchor)],
    ['alf-page-link-'+PAGE,JSON.stringify({version:1,notionId:PAGE,spId:task.id})]
  ]);
  const secrets=new Map([
    ['alf-notion-token','ntn_NOT_A_REAL_TOKEN'],
    ['alf-auto-time-local-enabled-v1','enabled']
  ]);
  const requests=[],writes=[],updates=[],state={counter:0,notionMutateOnSecondRead:null};
  const api={
    registerHeaderButton(){},registerHook(){},showIndexHtmlAsView(){},
    Hooks:{ACTION:'action',CURRENT_TASK_CHANGE:'currentTaskChange'},
    async loadSyncedData(k){return store.get(k)||null;},
    async listSyncedDataKeys(prefix){return [...store.keys()].filter(k=>k.startsWith(prefix));},
    async persistDataSynced(data,key){writes.push({key,data});store.set(key,data);},
    async getSecret(k){return secrets.get(k)||null;},
    async setSecret(k,v){secrets.set(k,v);},
    async getTasks(){return [task];},
    async getArchivedTasks(){return [];},
    async request(url,opts){
      requests.push({url,opts});
      assert.equal(new URL(url).host,'api.notion.com');
      assert.equal(opts.headers.Authorization,'Bearer ntn_NOT_A_REAL_TOKEN');
      if(opts.method==='GET' && url.includes('/data_sources/'))return {properties:schema};
      if(opts.method==='GET' && url.includes('/pages/')){
        state.counter++;
        if(state.counter===2 && typeof state.notionMutateOnSecondRead==='function')
          state.notionMutateOnSecondRead();
        return page;
      }
      if(opts.method==='PATCH'){
        const fields=Object.entries(opts.body.properties||{});
        assert.equal(fields.length,1,'single existing numeric field only');
        assert.equal(fields[0][0],'id-work','Never patch an unpinned or unrelated property');
        assert.equal(typeof fields[0][1].number,'number');
        const match=Object.keys(props).find(k=>props[k].id===fields[0][0]);
        assert.ok(match,'Patch must target a real existing Notion property ID');
        props[match].number=fields[0][1].number;
        return page;
      }
      throw new Error('Unexpected endpoint');
    }
  };
  const context={PluginAPI:api,console,localStorage:{getItem(){return null;}}};
  vm.createContext(context);
  vm.runInContext(code,context,{filename:'plugin.js'});
  const sync=vm.runInContext('alfCreateAutoTimeSync(PluginAPI,{maxBatch:5})',context);
  return {api,sync,c,spec,anchor,store,secrets,requests,writes,updates,task,page,props,schema,state};
}
test('no opt-in means zero Notion HTTP, PATCH or synced metadata changes',async()=>{
  const e=fixture();e.secrets.delete('alf-auto-time-local-enabled-v1');
  assert.equal((await e.sync.runOnce()).enabled,false);
  assert.equal(e.requests.length,0);
  assert.equal(e.writes.length,0);
});
test('positive tracked work increments one existing pinned Notion Number and baseline only once',async()=>{
  const e=fixture();
  e.task.timeSpent=10800000;
  const result=await e.sync.runOnce();
  assert.equal(result.written,1);
  const writes=e.requests.filter(x=>x.opts.method==='PATCH');
  assert.equal(writes.length,1);
  assert.equal(writes[0].opts.body.properties['id-work'].number,3);
  assert.equal(e.props['الوقت الفعلي'].number,3);
  assert.equal(e.writes.length,1);
  assert.equal(JSON.parse(e.store.get(ANCHOR_KEY)).expectedNotion,3);
  assert.equal(JSON.parse(e.store.get(ANCHOR_KEY)).expectedSpMs,10800000);
  assert.equal(e.task.timeSpent,10800000,'SP work time cannot be modified');
  assert.equal(e.task.isDone,false);
  const again=await e.sync.runOnce();
  assert.equal(again.written,0);
  assert.equal(e.requests.filter(x=>x.opts.method==='PATCH').length,1);
  assert.equal(e.writes.length,1,'no repeated metadata mutation on unchanged time');
});
test('manually edited Notion time higher/lower than approved baseline prevents overwrite',async()=>{
  for(const edited of [1,4]){
    const e=fixture();e.task.timeSpent=10800000;
    e.props['الوقت الفعلي'].number=edited;
    const result=await e.sync.runOnce();
    assert.equal(result.written,0);
    assert.equal(result.conflicts,1);
    assert.equal(e.props['الوقت الفعلي'].number,edited);
    assert.equal(e.requests.filter(x=>x.opts.method==='PATCH').length,0);
  }
});
test('SP time reduction, parent rollups and ambiguous task markers do not export',async()=>{
  for(const change of [{timeSpent:1800000},{subTaskIds:['subtask']},{parentId:'changed'}]){
    const e=fixture();Object.assign(e.task,change);
    const result=await e.sync.runOnce();
    assert.equal(result.written,0);
    assert.equal(e.requests.some(x=>x.opts.method==='PATCH'),false);
  }
  const f=fixture();f.task.notes='prefix alf-notion-page-id:'+PAGE+'-copy';
  f.task.timeSpent=10800000;
  assert.equal((await f.sync.runOnce()).written,0);
});
test('replaced pinned Number schema fails closed even under identical old property label',async()=>{
  const e=fixture();e.task.timeSpent=10800000;
  e.schema['الوقت الفعلي']={id:'new-wrong-property',type:'number'};
  const result=await e.sync.runOnce();
  assert.equal(result.written,0);
  assert.equal(result.errors,1);
  assert.equal(e.requests.filter(x=>x.opts.method==='PATCH').length,0);
});
test('renamed Notion Number property retains stable ID and is safely updated',async()=>{
  const e=fixture();e.task.timeSpent=10800000;
  e.schema['Actual Worked']=e.schema['الوقت الفعلي'];delete e.schema['الوقت الفعلي'];
  e.page.properties['Actual Worked']=e.page.properties['الوقت الفعلي'];
  delete e.page.properties['الوقت الفعلي'];
  // Recreate old label with unrelated field; must not be patched.
  e.schema['الوقت الفعلي']={id:'new-wrong-property',type:'number'};
  e.page.properties['الوقت الفعلي']={id:'new-wrong-property',type:'number',number:99};
  const result=await e.sync.runOnce();
  assert.equal(result.written,1);
  assert.equal(e.requests.filter(x=>x.opts.method==='PATCH')[0].opts.body.properties['id-work'].number,3);
  assert.equal(e.page.properties['الوقت الفعلي'].number,99);
});
test('Notion changes during second preflight read refuse stale PATCH',async()=>{
  const e=fixture();e.task.timeSpent=10800000;
  e.state.notionMutateOnSecondRead=()=>{e.props['الوقت الفعلي'].number=5;};
  const result=await e.sync.runOnce();
  assert.equal(result.written,0);
  assert.equal(result.conflicts,1);
  assert.equal(e.requests.filter(x=>x.opts.method==='PATCH').length,0);
});
test('source page moved/deleted or task item type changed prevents work-time PATCH',async()=>{
  for(const caseName of ['moved','deleted','type']){
    const e=fixture();e.task.timeSpent=10800000;
    if(caseName==='moved')e.page.parent.data_source_id='ffffffffffffffffffffffffffffffff';
    if(caseName==='deleted')e.page.in_trash=true;
    if(caseName==='type')e.page.properties['نوع الصفحة'].multi_select=[{name:'تعلم'}];
    assert.equal((await e.sync.runOnce()).written,0);
    assert.equal(e.requests.filter(x=>x.opts.method==='PATCH').length,0);
  }
});
test('invalid anchor baseline, Notion schema mismatch or missing token blocks export',async()=>{
  const a=fixture();a.store.set(ANCHOR_KEY,JSON.stringify({...a.anchor,expectedSpMs:-1}));
  a.task.timeSpent=10800000;
  assert.equal((await a.sync.runOnce()).written,0);
  const b=fixture();b.task.timeSpent=10800000;b.secrets.delete('alf-notion-token');
  assert.equal((await b.sync.runOnce()).written,0);
  assert.equal(b.requests.length,0);
});
