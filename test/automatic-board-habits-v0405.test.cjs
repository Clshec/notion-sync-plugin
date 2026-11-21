'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,Date,Math};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','plugin.js'),'utf8'),ctx);
const run=(fn,...args)=>vm.runInContext(fn,ctx)(...args);
const uid=x=>x.repeat(32);
const board=uid('1'),lower=uid('2'),upper=uid('3'),day='2026-11-21';
const keys=['titleProp','typeProp','executionProp','estimateProp',
  'actualProp','statusProp','projectProp','parentProp'];
const labels=['المصدر','نوع الصفحة','يوم التنفيذ','الوقت المخطط له',
  'الوقت الفعلي','Status','العنصر الفرعي','الحزمة الأب'];
function config(){
  const pairs=Object.fromEntries(keys.map((key,i)=>[key,labels[i]]));
  return {
    version:2,taskSource:board,projectSource:lower,
    alfProfile:{name:'alf-life-os',upperSource:upper,lowerSource:lower},
    ...pairs,taskPropertyBindings:Object.fromEntries(keys.map((key,i)=>
      [key,{id:key+'-id',input:labels[i],sourceId:board}])),
    habitPropertyBindings:{occurrences:{
      habitOccTypeProp:{id:'occ-type-id',sourceId:board},
      habitOccDayProp:{id:'occ-day-id',sourceId:board},
      habitOccRelationProp:{id:'occ-rel-id',sourceId:board}
    }}
  };
}
function page(id,title,def,status='Not started',kinds=['عادة']){
  return {object:'page',id,parent:{data_source_id:board},properties:{
    'المصدر':{id:'titleProp-id',type:'title',title:[{plain_text:title}]},
    'نوع الصفحة':{id:'typeProp-id',type:'multi_select',
      multi_select:kinds.map(name=>({name}))},
    'يوم التنفيذ':{id:'executionProp-id',type:'date',date:{start:day}},
    'Status':{id:'statusProp-id',type:'status',status:{name:status}},
    'قاعدة العادات':{id:'occ-rel-id',type:'relation',relation:[{id:def}]}
  }};
}
function counter(id,title,count=0){
  return {id,title,type:'ClickCounter',isEnabled:true,
    streakMinValue:1,countOnDay:{[day]:count}};
}
function fixture(rows,counters=[],enabled=true){
  const saved=new Map([['alf-mapping-v2',JSON.stringify(config())]]);
  const events=[];
  const api={
    async getSecret(key){
      return key==='alf-auto-graph-local-enabled-v1'&&enabled?'enabled':
        key==='alf-notion-token'?'ntn_TEST_ONLY':null;
    },
    async getDayContext(){return {todayStr:day};},
    async loadSyncedData(key){return saved.get(key)||null;},
    async persistDataSynced(value,key){saved.set(key,value);events.push(['save',key]);},
    async getAllSimpleCounters(){return counters.map(x=>({...x,countOnDay:{...x.countOnDay}}));},
    async setCounter(id,value){
      const found=counters.find(c=>c.id===id);
      assert.ok(found,'never call setCounter on a missing native counter');
      found.countOnDay[day]=value;events.push(['native',id,value]);
    },
    async setSecret(key,value){events.push(['secret',key]);},
    async request(uri,opts){
      const endpoint=uri.split('/v1')[1];
      events.push(['notion',opts.method,endpoint,opts.body]);
      if(opts.method==='GET'&&endpoint==='/data_sources/'+board)
        return {properties:{
          'type':{id:'occ-type-id',type:'multi_select'},
          'date':{id:'occ-day-id',type:'date'},
          'relation':{id:'occ-rel-id',type:'relation'}
        }};
      if(opts.method==='POST'&&endpoint==='/data_sources/'+board+'/query')
        return {results:rows,has_more:false,next_cursor:null};
      if(opts.method==='GET'&&endpoint.startsWith('/pages/')){
        const p=rows.find(x=>x.id===endpoint.split('/').pop());
        if(!p)throw new Error('Unknown page');
        return p;
      }
      if(opts.method==='PATCH'&&endpoint.startsWith('/pages/')){
        const p=rows.find(x=>x.id===endpoint.split('/').pop());
        assert.ok(p);
        assert.equal(opts.body.properties['statusProp-id'].status.name,'Done');
        p.properties.Status.status.name='Done';return p;
      }
      throw new Error('Unexpected Notion endpoint: '+opts.method+' '+endpoint);
    }
  };
  return {api,rows,counters,saved,events};
}
test('before one-token connection the daily mirror makes no Notion requests',async()=>{
  const f=fixture([page(uid('4'),'القران الكريم',uid('6'))],[],false);
  const out=await run('alfCreateBoardHabitsSync',f.api).runOnce();
  assert.equal(out.enabled,false);
  assert.equal(f.events.length,0);
});
test('one token automatically discovers and displays both existing and missing native Habits',async()=>{
  const f=fixture([
    page(uid('4'),'القران الكريم',uid('6')),
    page(uid('5'),'لا شطرنج',uid('7'))
  ],[counter('sp-existing','القران الكريم')]);
  const sync=run('alfCreateBoardHabitsSync',f.api);
  const result=await sync.runOnce();
  assert.equal(result.errors,0);
  assert.equal(result.processed,2);
  assert.equal(result.matched,1);
  assert.equal(result.missing,1);
  const data=JSON.parse(f.saved.get('alf-board-habits-today-v1'));
  assert.equal(data.day,day);
  assert.equal(data.rows.length,2);
  assert.equal(data.rows[0].counterId,'sp-existing');
  assert.equal(data.rows[1].counterId,null);
  assert.equal(f.events.filter(x=>x[0]==='native').length,0);
  const saveCount=f.events.filter(x=>x[0]==='save').length;
  await sync.runOnce();
  assert.equal(f.events.filter(x=>x[0]==='save').length,saveCount);
});
test('Notion Done can hydrate an EXISTING native ClickCounter, but cannot create another',async()=>{
  const f=fixture([page(uid('4'),'القران الكريم',uid('6'),'Done')],
    [counter('sp-quran','القران الكريم')]);
  const result=await run('alfCreateBoardHabitsSync',f.api).runOnce();
  assert.equal(result.written,1);
  assert.equal(f.counters[0].countOnDay[day],1);
  assert.deepEqual(f.events.filter(x=>x[0]==='native'),
    [['native','sp-quran',1]]);
  const same=await run('alfCreateBoardHabitsSync',f.api).runOnce();
  assert.equal(same.written,0);
});
test('after a baseline, native SP completion updates the original single-role Notion day only',async()=>{
  const f=fixture([page(uid('4'),'لا شطرنج',uid('6'))],
    [counter('sp-no-chess','لا شطرنج')]);
  const sync=run('alfCreateBoardHabitsSync',f.api);
  await sync.runOnce();
  f.counters[0].countOnDay[day]=1;
  const updated=await sync.runOnce();
  assert.equal(updated.written,1);
  assert.equal(f.rows[0].properties.Status.status.name,'Done');
  assert.equal(f.events.filter(x=>x[0]==='notion'&&x[1]==='PATCH').length,1);
  await sync.runOnce();
  assert.equal(f.events.filter(x=>x[0]==='notion'&&x[1]==='PATCH').length,1);
});
test('a daily row that is BOTH habit and task does not receive a habit-driven Status PATCH',async()=>{
  const f=fixture([page(uid('4'),'الحمد',uid('6'),'In progress',['عادة','مهمة'])],
    [counter('sp-hamd','الحمد')]);
  const sync=run('alfCreateBoardHabitsSync',f.api);
  await sync.runOnce();
  f.counters[0].countOnDay[day]=1;
  const result=await sync.runOnce();
  assert.equal(result.written,0);
  assert.equal(f.rows[0].properties.Status.status.name,'In progress');
  assert.equal(f.events.filter(x=>x[0]==='notion'&&x[1]==='PATCH').length,0);
});
test('duplicate daily definitions or names fail closed without native or Notion mutations',async()=>{
  const f=fixture([
    page(uid('4'),'القران الكريم',uid('6')),
    page(uid('5'),'القران الكريم',uid('6'))
  ],[counter('sp-quran','القران الكريم')]);
  const result=await run('alfCreateBoardHabitsSync',f.api).runOnce();
  assert.equal(result.conflicts,2);
  assert.equal(result.matched,0);
  assert.equal(f.events.filter(x=>x[0]==='native'||x[1]==='PATCH').length,0);
});
test('native-missing habit can be completed through plugin UI, without any setup approval',async()=>{
  const p=page(uid('4'),'الترفيه',uid('6'));
  const f=fixture([p],[]);
  const result=await run('alfCompleteBoardHabit',f.api,{
    pageId:p.id,definitionId:uid('6'),day,title:'الترفيه',
    expectedStatus:'Not started'
  });
  assert.equal(result.completed,true);
  assert.equal(p.properties.Status.status.name,'Done');
  assert.equal(f.events.filter(x=>x[0]==='notion'&&x[1]==='PATCH').length,1);
});
test('mixed task+habit cannot be completed by the separate habit-only UI button',async()=>{
  const p=page(uid('4'),'الحمد',uid('6'),'In progress',['عادة','مهمة']);
  const f=fixture([p],[]);
  await assert.rejects(()=>run('alfCompleteBoardHabit',f.api,{
    pageId:p.id,definitionId:uid('6'),day,title:'الحمد',
    expectedStatus:'In progress'
  }),/Daily habit missing/);
  assert.equal(f.events.filter(x=>x[0]==='notion'&&x[1]==='PATCH').length,0);
});
test('pre-connection SP completion and Notion open state are preserved as a visible conflict',async()=>{
  const f=fixture([page(uid('4'),'لا شطرنج',uid('6'))],
    [counter('sp-chess','لا شطرنج',1)]);
  const sync=run('alfCreateBoardHabitsSync',f.api);
  const first=await sync.runOnce();
  assert.equal(first.conflicts,1);
  const second=await sync.runOnce();
  assert.equal(second.conflicts,1);
  assert.equal(JSON.parse(f.saved.get('alf-board-habits-today-v1')).rows[0].stateConflict,true);
  assert.equal(f.events.filter(e=>e[0]==='notion'&&e[1]==='PATCH').length,0);
  f.counters[0].countOnDay[day]=2;
  const third=await sync.runOnce();
  assert.equal(third.written,1);
  assert.equal(f.rows[0].properties.Status.status.name,'Done');
});
test('an explicit native habit threshold is respected before writing Done',async()=>{
  const f=fixture([page(uid('4'),'عدد الخطوات',uid('6'))],
    [{...counter('steps','عدد الخطوات'),streakMinValue:5}]);
  const sync=run('alfCreateBoardHabitsSync',f.api);
  await sync.runOnce();
  f.counters[0].countOnDay[day]=4;
  const partial=await sync.runOnce();
  assert.equal(partial.written,0);
  assert.equal(f.rows[0].properties.Status.status.name,'Not started');
  f.counters[0].countOnDay[day]=5;
  assert.equal((await sync.runOnce()).written,1);
  assert.equal(f.rows[0].properties.Status.status.name,'Done');
});
test('StopWatch progress is displayed but never interpreted as a one-click completion',async()=>{
  const f=fixture([page(uid('4'),'وقت العمل',uid('6'))],
    [{...counter('work','وقت العمل',3600000),type:'StopWatch'}]);
  const result=await run('alfCreateBoardHabitsSync',f.api).runOnce();
  assert.equal(result.matched,1);
  assert.equal(result.written,0);
  assert.equal(f.rows[0].properties.Status.status.name,'Not started');
  assert.equal(f.events.filter(e=>e[0]==='notion'&&e[1]==='PATCH').length,0);
});
test('replaced original daily relation schema stops synchronization without writes',async()=>{
  const f=fixture([page(uid('4'),'القران الكريم',uid('6'))],
    [counter('native-quran','القران الكريم')]);
  const original=f.api.request;
  f.api.request=async(uri,opts)=>{
    if(opts.method==='GET'&&uri.endsWith('/data_sources/'+board))
      return {properties:{'type':{id:'occ-type-id',type:'multi_select'},
        'day':{id:'occ-day-id',type:'date'},
        'relation':{id:'WRONG-REPLACED-ID',type:'relation'}}};
    return original(uri,opts);
  };
  const result=await run('alfCreateBoardHabitsSync',f.api).runOnce();
  assert.equal(result.errors,1);
  assert.equal(f.events.filter(e=>e[0]==='native'||e[1]==='PATCH').length,0);
  assert.equal(f.saved.has('alf-board-habits-today-v1'),false);
});
test('an original habit-day row without a definition relation remains visible as a conflict',async()=>{
  const p=page(uid('4'),'منشطات',uid('6'));
  p.properties['قاعدة العادات'].relation=[];
  const f=fixture([p],[counter('sp-habit','منشطات')]);
  const result=await run('alfCreateBoardHabitsSync',f.api).runOnce();
  assert.equal(result.processed,1);
  assert.equal(result.conflicts,1);
  const snapshot=JSON.parse(f.saved.get('alf-board-habits-today-v1'));
  assert.equal(snapshot.rows.length,1);
  assert.equal(snapshot.rows[0].definitionId,null);
  assert.equal(snapshot.rows[0].ambiguous,true);
  assert.equal(snapshot.rows[0].counterId,null);
});
test('daily Notion view filter includes Created-today rows whose execution day is EMPTY',()=>{
  const occ=config().habitPropertyBindings.occurrences;
  const filter=JSON.parse(JSON.stringify(run('alfBoardHabitDayFilter',occ,day)));
  assert.equal(filter.and[0].multi_select.contains,'عادة');
  assert.equal(filter.and[1].or[0].date.equals,day);
  const fallback=filter.and[1].or[1].and;
  assert.equal(fallback[0].date.is_empty,true);
  assert.equal(fallback[1].created_time.on_or_after,new Date(day+'T00:00:00').toISOString());
  const tomorrow=new Date(day+'T00:00:00');
  tomorrow.setDate(tomorrow.getDate()+1);
  assert.equal(fallback[1].created_time.before,tomorrow.toISOString());
});
test('same original Notion view returns 9: six explicitly dated and three Created-today',async()=>{
  // Reproduced from the 2026-11-21 "عادات اليوم" original Notion view:
  // missing dates on النوم, المغرب, أذكار المساء (not missing definitions).
  const rows=[
    page(uid('4'),'الحمد',uid('a'),'In progress',['عادة','مهمة']),
    page(uid('5'),'القران الكريم',uid('b'),'Done'),
    page(uid('6'),'لا شطرنج',uid('c')),
    page(uid('7'),'منشطات',uid('d')),
    page(uid('8'),'وقت العمل',uid('e')),
    page(uid('9'),'الترفيه',uid('f')),
    page(uid('a'),'أذكار المساء',uid('1')),
    page(uid('b'),'المغرب',uid('2')),
    page(uid('c'),'النوم',uid('3'))
  ];
  for(const item of rows.slice(6)){
    item.properties['يوم التنفيذ'].date=null;
    item.created_time='2026-11-21T00:55:06.330Z';
  }
  const counters=rows.map((row,i)=>counter('habit-'+i,
    row.properties['المصدر'].title[0].plain_text,
    row.properties.Status.status.name==='Done'?1:0));
  const f=fixture(rows,counters);
  const sync=run('alfCreateBoardHabitsSync',f.api);
  const result=await sync.runOnce();
  assert.equal(result.errors,0);
  assert.equal(result.processed,9);
  assert.equal(result.matched,9);
  assert.equal(result.missing,0);
  const snapshot=JSON.parse(f.saved.get('alf-board-habits-today-v1'));
  assert.equal(snapshot.rows.length,9);
  for(const name of ['أذكار المساء','المغرب','النوم']){
    assert.equal(snapshot.rows.filter(r=>r.title===name&&r.day===day).length,1);
  }
  const filter=f.events.find(e=>e[0]==='notion'&&e[1]==='POST')[3].filter;
  assert.equal(filter.and[1].or[1].and[0].date.is_empty,true);
  assert.equal(f.events.filter(e=>e[0]==='notion'&&e[1]==='PATCH').length,0);
});
test('empty execution date from YESTERDAY is rejected, without an accidental status write',async()=>{
  const yesterday=page(uid('4'),'النوم',uid('5'),'Not started');
  yesterday.properties['يوم التنفيذ'].date=null;
  yesterday.created_time='2026-11-20T12:00:00.000Z';
  const f=fixture([yesterday],[counter('sleep','النوم',1)]);
  const result=await run('alfCreateBoardHabitsSync',f.api).runOnce();
  assert.equal(result.processed,0);
  assert.equal(result.conflicts,1);
  assert.equal(f.events.filter(e=>e[0]==='notion'&&e[1]==='PATCH').length,0);
});
test('marking a Created-today habit complete succeeds with exact page identity without changing its date',async()=>{
  const p=page(uid('4'),'المغرب',uid('5'));
  p.properties['يوم التنفيذ'].date=null;
  p.created_time='2026-11-21T00:55:06.330Z';
  const f=fixture([p]);
  const done=await run('alfCompleteBoardHabit',f.api,{
    pageId:p.id,definitionId:uid('5'),day,
    title:'المغرب',expectedStatus:'Not started'
  });
  assert.equal(done.completed,true);
  assert.equal(p.properties.Status.status.name,'Done');
  assert.equal(p.properties['يوم التنفيذ'].date,null);
});
