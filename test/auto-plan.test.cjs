'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

const plugin=fs.readFileSync(path.join(__dirname,'..','plugin.js'),'utf8');
const SOURCE='212b4a624b7d806989b9000b73ac11c8';
const PAGE='aab4a62b4b7d806989b9000b73ac11c8';
const PREFIX='alf-plan-anchor-v1-';
const MARKER='alf-notion-page-id:';
function fixture() {
  const schema={
    'المصدر':{id:'stable-title',type:'title'},
    'نوع الصفحة':{id:'stable-kind',type:'multi_select'},
    'الوقت المخطط له':{id:'stable-estimate',type:'number'},
    'يوم التنفيذ':{id:'stable-day',type:'date'}
  };
  const bindings={
    titleProp:{sourceId:SOURCE,input:'المصدر',id:'stable-title'},
    typeProp:{sourceId:SOURCE,input:'نوع الصفحة',id:'stable-kind'},
    estimateProp:{sourceId:SOURCE,input:'الوقت المخطط له',id:'stable-estimate'},
    executionProp:{sourceId:SOURCE,input:'يوم التنفيذ',id:'stable-day'}
  };
  const config={
    version:2,taskSource:SOURCE,titleProp:'المصدر',typeProp:'نوع الصفحة',
    estimateProp:'الوقت المخطط له',executionProp:'يوم التنفيذ',
    unit:'hours',typeValues:'مهمة, حزمة',taskPropertyBindings:bindings
  };
  const spec={
    sourceId:SOURCE,
    input:{titleProp:'المصدر',typeProp:'نوع الصفحة',
      estimateProp:'الوقت المخطط له',executionProp:'يوم التنفيذ'},
    ids:{titleProp:'stable-title',typeProp:'stable-kind',
      estimateProp:'stable-estimate',executionProp:'stable-day'},
    unit:'hours',allowed:['مهمة','حزمة'].sort()
  };
  const pages=new Map([[PAGE,{
    object:'page',id:PAGE,in_trash:false,
    parent:{type:'data_source_id',data_source_id:SOURCE},
    properties:{
      'المصدر':{id:'stable-title',type:'title',
        title:[{plain_text:'Original task'}]},
      'نوع الصفحة':{id:'stable-kind',type:'multi_select',
        multi_select:[{name:'مهمة'}]},
      'الوقت المخطط له':{id:'stable-estimate',type:'number',number:1},
      'يوم التنفيذ':{id:'stable-day',type:'date',date:{start:'2026-11-16'}}
    }
  }]]);
  const tasks=[{id:'sp-already-linked',projectId:'p',parentId:null,
    notes:MARKER+PAGE,isDone:false,title:'Original task',
    timeEstimate:3600000,dueDay:'2026-11-16',dueWithTime:null,
    timeSpent:8400000,tagIds:['my-tag'],subTaskIds:[]}];
  const anchor={version:1,notionId:PAGE,spId:tasks[0].id,
    sourceId:SOURCE,spec:JSON.stringify(spec),projectId:'p',parentId:null,
    expected:{title:'Original task',timeEstimate:3600000,
      dueDay:'2026-11-16',dueWithTime:null}};
  const stored=new Map([
    ['alf-mapping-v2',JSON.stringify(config)],
    [PREFIX+PAGE,JSON.stringify(anchor)],
    ['alf-page-link-'+PAGE,JSON.stringify({notionId:PAGE,spId:tasks[0].id})]
  ]);
  const secrets=new Map([
    ['alf-notion-token','ntn_LOCAL_ONLY_FAKE_TOKEN'],
    ['alf-auto-plan-local-enabled-v1','enabled']
  ]);
  const requests=[],writes=[],updates=[];
  const api={
    registerHeaderButton(){},registerHook(){},showIndexHtmlAsView(){},
    Hooks:{ACTION:'action',CURRENT_TASK_CHANGE:'currentTaskChange'},
    async loadSyncedData(key){return stored.get(key)||null;},
    async listSyncedDataKeys(prefix){return [...stored.keys()].filter(k=>k.startsWith(prefix));},
    async persistDataSynced(json,key){writes.push({key,json});stored.set(key,json);},
    async getSecret(key){return secrets.get(key)||null;},
    async getTasks(){return tasks;},async getArchivedTasks(){return [];},
    async updateTask(id,fields,options){
      assert.ok(options.isIgnoreShortSyntax);
      assert.ok(Object.keys(fields).every(x=>
        ['title','timeEstimate','dueDay','dueWithTime'].includes(x)),
        'Never write work execution/status/note/project data');
      const task=tasks.find(x=>x.id===id);
      if(!task)throw new Error('Task absent');
      updates.push({id,fields});
      Object.assign(task,fields);
    },
    async request(url,options){
      requests.push({url,options});
      assert.equal(options.method,'GET','Automatic engine must never PATCH Notion');
      assert.equal(new URL(url).host,'api.notion.com');
      assert.equal(options.headers.Authorization,'Bearer ntn_LOCAL_ONLY_FAKE_TOKEN');
      if(url.includes('/data_sources/'))return {properties:schema};
      if(url.includes('/pages/')) {
        const id=url.split('/').pop(),page=pages.get(id);
        if(!page)throw new Error('Notion page not found');
        return page;
      }
      throw new Error('Unexpected Notion endpoint');
    }
  };
  const sandbox={PluginAPI:api,console,localStorage:{getItem(){return null;}}};
  vm.createContext(sandbox);
  vm.runInContext(plugin,sandbox,{filename:'plugin.js'});
  const engine=vm.runInContext('alfCreateAutoPlanSync(PluginAPI,{maxBatch:8})',sandbox);
  return {api,engine,config,spec,schema,anchor,tasks,pages,stored,secrets,requests,writes,updates};
}
test('opt-in auto planning never accesses Notion or SP if local enable flag is absent',async()=>{
  const f=fixture();
  f.secrets.delete('alf-auto-plan-local-enabled-v1');
  const outcome=await f.engine.runOnce();
  assert.equal(outcome.enabled,false);
  assert.equal(f.requests.length,0);
  assert.equal(f.updates.length,0);
  assert.equal(f.writes.length,0);
});
test('automatic planning refreshes only changed Notion-owned fields, then is idempotent',async()=>{
  const f=fixture();
  const page=f.pages.get(PAGE);
  page.properties['المصدر'].title=[{plain_text:'New Notion plan #literal'}];
  page.properties['الوقت المخطط له'].number=2;
  page.properties['يوم التنفيذ'].date={start:'2026-11-17'};
  const result=await f.engine.runOnce();
  assert.equal(result.updated,1);
  assert.equal(f.updates.length,1);
  assert.deepEqual(Object.keys(f.updates[0].fields).sort(),
    ['title','timeEstimate','dueDay'].sort());
  assert.equal(f.tasks[0].title,'New Notion plan #literal');
  assert.equal(f.tasks[0].timeEstimate,7200000);
  assert.equal(f.tasks[0].dueDay,'2026-11-17');
  assert.equal(f.tasks[0].timeSpent,8400000);
  assert.deepEqual(f.tasks[0].tagIds,['my-tag']);
  assert.equal(f.tasks[0].isDone,false);
  assert.equal(JSON.parse(f.stored.get(PREFIX+PAGE)).expected.timeEstimate,7200000);
  assert.equal(f.writes.length,1,'write back only the changed sync anchor');
  const again=await f.engine.runOnce();
  assert.equal(again.updated,0);
  assert.equal(f.updates.length,1,'repeated polling never repeats SP update');
  assert.equal(f.writes.length,1,'unchanged cycles must not create synced metadata churn');
});
test('local offline task edit causes a conflict instead of automatic overwrite',async()=>{
  const f=fixture();
  f.tasks[0].title='Local edit on Android';
  f.pages.get(PAGE).properties['المصدر'].title=[{plain_text:'Notion new title'}];
  const result=await f.engine.runOnce();
  assert.equal(result.updated,0);
  assert.equal(result.conflicts,1);
  assert.equal(f.tasks[0].title,'Local edit on Android');
  assert.equal(f.writes.length,0);
});
test('a stale or edited Notion field ID fails closed before any SP mutation',async()=>{
  const f=fixture();
  f.schema['المصدر']={id:'different-field',type:'title'};
  f.pages.get(PAGE).properties['المصدر'].title=[{plain_text:'Changed'}];
  const result=await f.engine.runOnce();
  assert.equal(result.errors,1);
  assert.equal(result.updated,0);
  assert.equal(f.updates.length,0);
});
test('a renamed Notion property with the same pinned ID keeps automatic planning safe',async()=>{
  const f=fixture();
  const old=f.pages.get(PAGE).properties['المصدر'];
  f.pages.get(PAGE).properties['English Title']=old;
  delete f.pages.get(PAGE).properties['المصدر'];
  f.schema['English Title']=f.schema['المصدر'];delete f.schema['المصدر'];
  old.title=[{plain_text:'Notion title renamed'}];
  f.schema['المصدر']={id:'new-unrelated-title-field',type:'title'};
  f.pages.get(PAGE).properties['المصدر']={id:'new-unrelated-title-field',type:'title',
    title:[{plain_text:'Wrong'}]};
  const result=await f.engine.runOnce();
  assert.equal(result.updated,1);
  assert.equal(f.tasks[0].title,'Notion title renamed');
});
test('task completion, recurring tasks and moved task hierarchy block automatic updates',async()=>{
  for(const change of [{isDone:true},{repeatCfgId:'repeat'},{parentId:'other'},{projectId:'other'}]) {
    const f=fixture();
    Object.assign(f.tasks[0],change);
    f.pages.get(PAGE).properties['المصدر'].title=[{plain_text:'Notion newer'}];
    const result=await f.engine.runOnce();
    assert.equal(result.updated,0);
    assert.equal(f.updates.length,0);
    assert.equal(result.conflicts,1);
  }
});
test('modified linked task identity or matching multiple tasks refuses automatic refresh',async()=>{
  const f=fixture();
  f.tasks.push({...f.tasks[0],id:'duplicate-sp',title:'A copy'});
  f.pages.get(PAGE).properties['المصدر'].title=[{plain_text:'Plan'}];
  assert.equal((await f.engine.runOnce()).conflicts,1);
  assert.equal(f.updates.length,0);
  const g=fixture();
  g.stored.set('alf-page-link-'+PAGE,JSON.stringify({notionId:PAGE,spId:'other'}));
  g.pages.get(PAGE).properties['المصدر'].title=[{plain_text:'Plan'}];
  assert.equal((await g.engine.runOnce()).conflicts,1);
  assert.equal(g.updates.length,0);
});
test('wrong Notion source/type never refreshes SP',async()=>{
  for(const broken of ['parent','type','deleted']) {
    const f=fixture(),page=f.pages.get(PAGE);
    if(broken==='parent')page.parent.data_source_id='ffffffffffffffffffffffffffffffff';
    if(broken==='type')page.properties['نوع الصفحة'].multi_select=[{name:'تعلم'}];
    if(broken==='deleted')page.in_trash=true;
    page.properties['المصدر'].title=[{plain_text:'Changed'}];
    const result=await f.engine.runOnce();
    assert.equal(result.updated,0);
    assert.equal(result.conflicts,1);
  }
});
test('invalid timezone-free Notion timestamp does not update existing SP dates',async()=>{
  const f=fixture();
  f.pages.get(PAGE).properties['يوم التنفيذ'].date={start:'2026-11-17T17:00:00'};
  const result=await f.engine.runOnce();
  assert.equal(result.updated,0);
  assert.equal(result.errors,1);
  assert.equal(f.tasks[0].dueDay,'2026-11-16');
});
test('Notion null estimate is not a request to clear local SP estimate',async()=>{
  const f=fixture();
  f.pages.get(PAGE).properties['الوقت المخطط له'].number=null;
  f.pages.get(PAGE).properties['المصدر'].title=[{plain_text:'New title'}];
  const result=await f.engine.runOnce();
  assert.equal(result.updated,1);
  assert.equal(f.tasks[0].title,'New title');
  assert.equal(f.tasks[0].timeEstimate,3600000);
  assert.equal(f.updates[0].fields.timeEstimate,undefined);
});
test('disabled device with token still cannot run automatic Notion planning',async()=>{
  const f=fixture();
  f.secrets.set('alf-auto-plan-local-enabled-v1','disabled');
  f.pages.get(PAGE).properties['المصدر'].title=[{plain_text:'Changed'}];
  assert.equal((await f.engine.runOnce()).enabled,false);
  assert.equal(f.requests.length,0);
  assert.equal(f.updates.length,0);
});
