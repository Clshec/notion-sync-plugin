'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const code=fs.readFileSync(path.join(__dirname,'..','plugin.js'),'utf8');
const BOARD='212b4a624b7d806989b9000b73ac11c8';
const HABIT_SOURCE='212b4a624b7d8050a6aa000b01b292b8';
const HABIT='habit-original-1';
const PAGE='habit-day-original-1';
const DAY='2026-11-16';
const PREFIX='alf-habit-auto-anchor-v1-';
function fixture(){
  const fields={
    'نوع الصفحة':{type:'multi_select',id:'habit-type-id'},
    'قاعدة العادات':{type:'relation',id:'habit-relation-id'},
    'يوم التنفيذ':{type:'date',id:'habit-date-id'},
    'Habit Count':{type:'number',id:'habit-count-id'}
  };
  const props={
    'نوع الصفحة':{type:'multi_select',id:'habit-type-id',multi_select:[{name:'عادة'}]},
    'قاعدة العادات':{type:'relation',id:'habit-relation-id',
      relation:[{id:HABIT}],has_more:false},
    'يوم التنفيذ':{type:'date',id:'habit-date-id',date:{start:DAY}},
    'Habit Count':{type:'number',id:'habit-count-id',number:0}
  };
  const page={object:'page',id:PAGE,properties:props,in_trash:false,
    parent:{type:'data_source_id',data_source_id:BOARD}};
  const rows=[page];
  const c={
    version:2,taskSource:BOARD,habitSource:HABIT_SOURCE,
    habitOccTypeProp:'نوع الصفحة',habitOccTypeValue:'عادة',
    habitOccRelationProp:'قاعدة العادات',habitOccDayProp:'يوم التنفيذ',
    habitOccCountProp:'Habit Count',habitOccUnit:'count',
    habitPropertyBindings:{definitions:{},occurrences:{}}
  };
  const names=['habitOccTypeProp','habitOccRelationProp','habitOccDayProp','habitOccCountProp'];
  const ids=['habit-type-id','habit-relation-id','habit-date-id','habit-count-id'];
  for(let i=0;i<names.length;i++)
    c.habitPropertyBindings.occurrences[names[i]]={
      sourceId:BOARD,input:c[names[i]],id:ids[i]
    };
  const counter={id:'a',type:'ClickCounter',isEnabled:true,
    countOnDay:{[DAY]:3}};
  const state={simpleCounters:{a:counter}};
  const linked={version:1,notionId:HABIT,spCounterId:'a',notionSourceId:HABIT_SOURCE};
  const store=new Map([
    ['alf-mapping-v2',JSON.stringify(c)],
    ['alf-habit-definition-link-v1-'+HABIT,JSON.stringify(linked)]
  ]);
  const secrets=new Map([
    ['alf-notion-token','ntn_FAKE_HABIT_TOKEN'],
    ['alf-auto-habit-local-enabled-v1','enabled']
  ]);
  const requests=[],metadata=[],env={day:DAY,onQuery:null,queryCount:0};
  const api={
    registerHeaderButton(){},registerHook(){},showIndexHtmlAsView(){},
    Hooks:{ACTION:'action',CURRENT_TASK_CHANGE:'currentTaskChange'},
    async getSecret(k){return secrets.get(k)||null;},
    async loadSyncedData(k){return store.get(k)||null;},
    async listSyncedDataKeys(prefix){return [...store.keys()].filter(k=>k.startsWith(prefix));},
    async persistDataSynced(data,key){metadata.push({key,data});store.set(key,data);},
    async getDayContext(){return {todayStr:env.day};},
    async getAppState(){return state;},
    async request(url,opts) {
      requests.push({url,opts});
      assert.equal(new URL(url).host,'api.notion.com');
      assert.equal(opts.headers.Authorization,'Bearer ntn_FAKE_HABIT_TOKEN');
      if(opts.method==='GET'&&url.includes('/data_sources/'))return {properties:fields};
      if(opts.method==='POST'){
        assert.ok(url.includes('/data_sources/'+BOARD+'/query'));
        assert.equal(opts.body.filter.and[0].property,'habit-type-id');
        assert.equal(opts.body.filter.and[1].property,'habit-date-id');
        env.queryCount++;
        if(env.onQuery)env.onQuery(env.queryCount);
        return {results:rows,has_more:false,next_cursor:null};
      }
      if(opts.method==='GET'&&url.includes('/pages/')){
        const id=url.split('/').pop();
        const p=rows.find(x=>x.id===id);
        if(!p)throw new Error('Notion page absent');
        return p;
      }
      if(opts.method==='PATCH'){
        const id=url.split('/').pop(),p=rows.find(x=>x.id===id);
        assert.ok(p,'Never create a new Notion page');
        assert.equal(Object.keys(opts.body.properties).length,1);
        const [propertyId,payload]=Object.entries(opts.body.properties)[0];
        assert.equal(propertyId,'habit-count-id');
        const key=Object.keys(p.properties).find(k=>p.properties[k].id===propertyId);
        assert.ok(key,'Pinned existing property must still exist');
        p.properties[key].number=payload.number;
        return p;
      }
      throw new Error('Unexpected Notion API operation');
    }
  };
  const context={PluginAPI:api,console,localStorage:{getItem(){return null;}}};
  vm.createContext(context);
  vm.runInContext(code,context,{filename:'plugin.js'});
  const engine=vm.runInContext('alfCreateAutoHabitSync(PluginAPI,{maxBatch:3})',context);
  return {api,engine,c,page,fields,props,rows,counter,state,store,secrets,requests,metadata,env};
}
test('no local habit automation permission performs zero Notion requests/writes',async()=>{
  const f=fixture();f.secrets.delete('alf-auto-habit-local-enabled-v1');
  assert.equal((await f.engine.runOnce()).enabled,false);
  assert.equal(f.requests.length,0);
  assert.equal(f.metadata.length,0);
});
test('existing zero habit Number is written monotonically, anchored and idempotent',async()=>{
  const f=fixture();
  const first=await f.engine.runOnce();
  assert.equal(first.written,1);
  assert.equal(f.page.properties['Habit Count'].number,3);
  assert.equal(f.requests.filter(x=>x.opts.method==='PATCH').length,1);
  assert.equal(JSON.parse(f.store.get(PREFIX+PAGE)).expectedNumber,3);
  assert.equal(f.metadata.length,1);
  const repeat=await f.engine.runOnce();
  assert.equal(repeat.written,0);
  assert.equal(f.requests.filter(x=>x.opts.method==='PATCH').length,1);
  assert.equal(f.metadata.length,1);
  f.counter.countOnDay[DAY]=5;
  const advanced=await f.engine.runOnce();
  assert.equal(advanced.written,1);
  assert.equal(f.page.properties['Habit Count'].number,5);
  assert.equal(f.requests.filter(x=>x.opts.method==='PATCH').length,2);
});
test('already matching existing positive count seeds a baseline without PATCH',async()=>{
  const f=fixture();
  f.page.properties['Habit Count'].number=3;
  const first=await f.engine.runOnce();
  assert.equal(first.anchored,1);
  assert.equal(f.requests.filter(x=>x.opts.method==='PATCH').length,0);
  assert.equal(JSON.parse(f.store.get(PREFIX+PAGE)).expectedRaw,3);
  f.counter.countOnDay[DAY]=4;
  assert.equal((await f.engine.runOnce()).written,1);
  assert.equal(f.page.properties['Habit Count'].number,4);
});
test('unreviewed existing positive Notion mismatch is never overwritten',async()=>{
  for(const n of [1,9]){
    const f=fixture();
    f.page.properties['Habit Count'].number=n;
    const result=await f.engine.runOnce();
    assert.equal(result.written,0);
    assert.equal(result.conflicts,1);
    assert.equal(f.page.properties['Habit Count'].number,n);
    assert.equal(f.requests.filter(x=>x.opts.method==='PATCH').length,0);
  }
});
test('manual edit after anchored sync and SP counter reset remain authoritative conflicts',async()=>{
  const f=fixture();
  assert.equal((await f.engine.runOnce()).written,1);
  f.page.properties['Habit Count'].number=7;
  f.counter.countOnDay[DAY]=9;
  const conflict=await f.engine.runOnce();
  assert.equal(conflict.written,0);
  assert.equal(conflict.conflicts,1);
  assert.equal(f.page.properties['Habit Count'].number,7);
  const g=fixture();
  assert.equal((await g.engine.runOnce()).written,1);
  g.counter.countOnDay[DAY]=2;
  assert.equal((await g.engine.runOnce()).written,0);
  assert.equal(g.page.properties['Habit Count'].number,3);
});
test('duplicate existing habit/day rows block all Number PATCH',async()=>{
  const f=fixture();
  const duplicate=JSON.parse(JSON.stringify(f.page));
  duplicate.id='habit-day-duplicate-2';
  f.rows.push(duplicate);
  const result=await f.engine.runOnce();
  assert.equal(result.written,0);
  assert.equal(result.conflicts,1);
  assert.equal(f.requests.filter(x=>x.opts.method==='PATCH').length,0);
});
test('a second duplicate appearing between inventory reads prevents PATCH',async()=>{
  const f=fixture();
  f.env.onQuery=(count)=>{
    if(count===2){
      const copy=JSON.parse(JSON.stringify(f.page));
      copy.id='late-duplicate';
      f.rows.push(copy);
    }
  };
  const result=await f.engine.runOnce();
  assert.equal(result.written,0);
  assert.equal(result.conflicts,1);
  assert.equal(f.requests.filter(x=>x.opts.method==='PATCH').length,0);
});
test('counter mapping reuse across two habit definitions is ambiguous and blocked',async()=>{
  const f=fixture();
  f.store.set('alf-habit-definition-link-v1-another-habit',
    JSON.stringify({version:1,notionId:'another-habit',
      spCounterId:'a',notionSourceId:HABIT_SOURCE}));
  const result=await f.engine.runOnce();
  assert.equal(result.written,0);
  assert.equal(result.conflicts,1);
});
test('incorrect counter unit, disabled counter, or missing definition link cannot write',async()=>{
  const a=fixture();a.counter.type='StopWatch';
  assert.equal((await a.engine.runOnce()).written,0);
  const b=fixture();b.counter.isEnabled=false;
  assert.equal((await b.engine.runOnce()).written,0);
  const c=fixture();c.store.delete('alf-habit-definition-link-v1-'+HABIT);
  assert.equal((await c.engine.runOnce()).written,0);
});
test('StopWatch minutes write explicit converted Number, never raw milliseconds',async()=>{
  const f=fixture();
  f.c.habitOccUnit='minutes';
  f.store.set('alf-mapping-v2',JSON.stringify(f.c));
  f.counter.type='StopWatch';
  f.counter.countOnDay[DAY]=600000;
  const result=await f.engine.runOnce();
  assert.equal(result.written,1);
  assert.equal(f.page.properties['Habit Count'].number,10);
  assert.equal(f.requests.filter(x=>x.opts.method==='PATCH')[0].opts.body.properties['habit-count-id'].number,10);
});
test('a renamed pinned Notion Number remains safe; a replaced ID fails closed',async()=>{
  const f=fixture();
  f.page.properties['Daily Count']=f.page.properties['Habit Count'];
  delete f.page.properties['Habit Count'];
  f.fields['Daily Count']=f.fields['Habit Count'];
  delete f.fields['Habit Count'];
  f.page.properties['Habit Count']={id:'new-invalid-field',type:'number',number:40};
  f.fields['Habit Count']={id:'new-invalid-field',type:'number'};
  assert.equal((await f.engine.runOnce()).written,1);
  assert.equal(f.page.properties['Daily Count'].number,3);
  assert.equal(f.page.properties['Habit Count'].number,40);
  const g=fixture();
  g.fields['Habit Count']={id:'replacement-field',type:'number'};
  assert.equal((await g.engine.runOnce()).written,0);
  assert.equal(g.requests.filter(x=>x.opts.method==='PATCH').length,0);
});
test('logical-day change and missing new-day Notion row never create a page',async()=>{
  const f=fixture();
  f.env.day='2026-11-17';
  f.counter.countOnDay['2026-11-17']=4;
  const result=await f.engine.runOnce();
  assert.equal(result.written,0);
  assert.equal(f.requests.filter(x=>x.opts.method==='PATCH').length,0);
  assert.equal(f.rows.length,1);
});
test('Notion page moved, relation changed, or type changed are never written',async()=>{
  for(const broken of ['move','relation','kind']){
    const f=fixture();
    if(broken==='move')f.page.parent.data_source_id='ffffffffffffffffffffffffffffffff';
    if(broken==='relation')f.page.properties['قاعدة العادات'].relation=[{id:'another-habit'}];
    if(broken==='kind')f.page.properties['نوع الصفحة'].multi_select=[{name:'تعلم'}];
    assert.equal((await f.engine.runOnce()).written,0);
    assert.equal(f.requests.filter(x=>x.opts.method==='PATCH').length,0);
  }
});
