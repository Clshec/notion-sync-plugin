'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','plugin.js'),'utf8');
const context={console};
vm.createContext(context);
vm.runInContext(source,context,{filename:'plugin.js'});
const create=vm.runInContext('alfCreateReviewedDailyCounter',context);
const sourceId='212b4a624b7d806989b9000b73ac11c8';
const pageId='22222222222242228222222222222222';
const definitionId='11111111111141118111111111111111';
const day='2026-11-18';
const title='Learn 15 minutes';
const counterId='alfn-'+definitionId;
const config={
  alfProfile:{name:'alf-life-os'},taskSource:sourceId,
  taskPropertyBindings:{titleProp:{sourceId,id:'title-id'}},
  habitPropertyBindings:{occurrences:{
    habitOccTypeProp:{sourceId,id:'type-id'},
    habitOccRelationProp:{sourceId,id:'relation-id'},
    habitOccDayProp:{sourceId,id:'day-id'}
  }}
};
function makeRow(id=pageId,def=definitionId,name=title,when=day){
  return {
    object:'page',id,in_trash:false,
    parent:{type:'data_source_id',data_source_id:sourceId},
    properties:{
      'المصدر':{id:'title-id',type:'title',title:[{plain_text:name}]},
      'نوع الصفحة':{id:'type-id',type:'multi_select',multi_select:[{name:'عادة'}]},
      'يوم التنفيذ':{id:'day-id',type:'date',date:{start:when}},
      'قاعدة العادات':{id:'relation-id',type:'relation',relation:[{id:def}]}
    }
  };
}
function fixture(options={}){
  const log=[],counters=new Map();
  if(options.counter)counters.set(options.counter.id,{...options.counter});
  const page=options.page||makeRow();
  const rows=options.rows||[page];
  const api={
    async getDayContext(){return {todayStr:options.today||day};},
    async loadSyncedData(key){
      assert.equal(key,'alf-mapping-v2');
      return JSON.stringify(config);
    },
    async getSecret(key){
      assert.equal(key,'alf-notion-token');
      return options.noToken?null:'TEST-ONLY-NOT-A-SECRET';
    },
    async request(url,opts){
      log.push(['notion',url,opts.method]);
      assert.equal(new URL(url).host,'api.notion.com');
      assert.notEqual(opts.method,'PATCH');
      if(opts.method==='GET'&&url.includes('/pages/'))return page;
      if(opts.method==='POST'&&url.includes('/query'))
        return {results:rows,has_more:false,next_cursor:null};
      throw new Error('Unexpected request');
    },
    async getAllSimpleCounters(){return [...counters.values()];},
    async getSimpleCounter(id){return counters.get(id);},
    async setCounter(id,value){
      log.push(['set',id,value]);
      assert.equal(value,0);
      assert.equal(counters.has(id),false,'must not reset an existing counter');
      counters.set(id,{id,title:id,type:'ClickCounter',countOnDay:{[day]:0}});
    },
    async updateSimpleCounter(id,changes){
      log.push(['update',id,changes.title]);
      assert.ok(counters.has(id),'counter must exist before renaming');
      counters.get(id).title=changes.title;
    }
  };
  const args={pageId,definitionId,day,title};
  return {api,args,log,counters};
}

test('SP 20 missing-counter creation fails closed: setCounter upsert is NOT persisted',async()=>{
  const f=fixture();
  await assert.rejects(()=>create(f.api,f.args),/non-persistent/);
  assert.equal(f.counters.has(counterId),false);
  assert.equal(f.log.filter(x=>['set','update'].includes(x[0])).length,0);
  assert.equal(f.log.filter(x=>x[0]==='notion'&&x[2]==='PATCH').length,0);
});

test('reviewing an already-existing matching counter is read-only and preserves count',async()=>{
  const f=fixture({counter:{id:counterId,title,type:'ClickCounter',countOnDay:{[day]:4}}});
  const result=await create(f.api,f.args);
  assert.equal(result.created,false);
  assert.equal(result.counterId,counterId);
  assert.equal(f.counters.get(counterId).countOnDay[day],4);
  assert.equal(f.log.filter(x=>['set','update'].includes(x[0])).length,0);
});

test('stale day, changed page title and duplicated original day relation all refuse local writes',async()=>{
  const cases=[
    fixture({today:'2026-11-19'}),
    fixture({page:makeRow(pageId,definitionId,'Changed name')}),
    fixture({rows:[makeRow(),makeRow('33333333333343338333333333333333')]}),
    fixture({rows:[makeRow(),makeRow('33333333333343338333333333333333',
      '44444444444444448444444444444444',title)]})
  ];
  for(const f of cases){
    await assert.rejects(()=>create(f.api,f.args));
    assert.equal(f.log.filter(x=>['set','update'].includes(x[0])).length,0);
  }
});

test('existing unrelated counter title or unavailable Notion token cannot create duplicates',async()=>{
  const options=[
    fixture({counter:{id:'another',title,type:'ClickCounter',countOnDay:{[day]:5}}}),
    fixture({noToken:true})
  ];
  for(const f of options){
    await assert.rejects(()=>create(f.api,f.args));
    assert.equal(f.log.filter(x=>['set','update'].includes(x[0])).length,0);
  }
});
