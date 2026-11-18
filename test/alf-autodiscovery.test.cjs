'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Synthetic Notion 2026-03-11 fixtures based on LIVE Alf schema inspection.
// No personal pages, real integration secrets, or fixed production source IDs.
const src=fs.readFileSync(path.join(__dirname,'..','plugin.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const context={console};
vm.createContext(context);
vm.runInContext(src,context,{filename:'plugin.js'});
const discover=vm.runInContext('alfDiscoverProfile',context);
const allowed=vm.runInContext('alfHostNotionMethodAllowed',context);
const makeBridgeHandler=vm.runInContext('alfCreateHostRpcHandler',context);
const ids={
  board:'11111111-1111-4111-8111-111111111111',
  habits:'22222222-2222-4222-8222-222222222222',
  upper:'33333333-3333-4333-8333-333333333333',
  lower:'44444444-4444-4444-8444-444444444444'
};
const titles={board:'اللوح',habits:'قاعدة العادات',
  upper:'المستويات العليا',lower:'المستويات الفرعية'};
let sequence=0;
function prop(type,extra={}){
  sequence++;
  return {type,id:'p'+sequence,...extra};
}
function rel(to){
  return prop('relation',{relation:{data_source_id:ids[to]}});
}
function prepare(){
  sequence=0;
  const board={
    'المصدر':prop('title'),
    'نوع الصفحة':prop('multi_select',{multi_select:{options:[
      {name:'مهمة'},{name:'حزمة'},{name:'عادة'},{name:'تعلم'},{name:'تدوين'}
    ]}}),
    'يوم التنفيذ':prop('date'),
    'الوقت المخطط له':prop('number'),
    'الوقت الفعلي':prop('number'),
    'Status':prop('status',{status:{options:[
      {name:'Not started'},{name:'In progress'},{name:'Done'}
    ]}}),
    'العنصر الفرعي':rel('lower'),
    'الحزمة الأب':rel('board'),
    'قاعدة العادات':rel('habits')
  };
  const habits={
    'العادة':prop('title'),
    'التكرار':prop('select'),
    'اللوح':rel('board'),
    'متتبع العادات':rel('habits')
  };
  const upper={
    'Name':prop('title'),
    'النظام':prop('select'),
    'العناصر الفرعية':rel('lower')
  };
  const lower={
    'Name':prop('title'),
    'النوع  ':prop('multi_select'),
    'العنصر الأب':rel('upper'),
    'اللوح':rel('board')
  };
  const map={board,habits,upper,lower};
  const entries=Object.keys(ids).map((role)=>({
    object:'data_source',id:ids[role],
    title:[{plain_text:titles[role]}],
    parent:{database_id:ids[role]},properties:map[role]
  }));
  const requests=[];
  let index=0;
  const api={
    async getSecret(key){
      assert.equal(key,'alf-notion-token');
      return 'ntn_FAKE_TEST_NOT_REAL';
    },
    async request(url,opts){
      requests.push({url,opts});
      assert.equal(opts.headers['Notion-Version'],'2026-03-11');
      assert.equal(opts.headers.Authorization,'Bearer ntn_FAKE_TEST_NOT_REAL');
      if(url.endsWith('/search')){
        assert.equal(opts.method,'POST');
        assert.equal(opts.body.filter.value,'data_source');
        if(index===0){index++;return {results:entries.slice(0,2),
          has_more:true,next_cursor:'cursor-2'};}
        assert.equal(opts.body.start_cursor,'cursor-2');
        return {results:entries.slice(2),has_more:false,next_cursor:null};
      }
      assert.equal(opts.method,'GET');
      return entries.find((s)=>url.endsWith(
        '/data_sources/'+s.id.replace(/-/g,'')))||null;
    }
  };
  return {entries,map,api,requests};
}
function normalize(obj){return JSON.parse(JSON.stringify(obj));}

test('one token discovers four existing Alf sources, exact relations and pinned fields',async()=>{
  const a=prepare();
  const result=normalize(await discover(a.api));
  const c=result.config;
  assert.equal(c.version,2);
  assert.equal(result.totalFields,13);
  assert.deepEqual(result.names,Object.values(titles));
  assert.equal(c.taskSource,ids.board.replace(/-/g,''));
  assert.equal(c.habitSource,ids.habits.replace(/-/g,''));
  assert.equal(c.projectSource,ids.lower.replace(/-/g,''));
  assert.equal(c.alfProfile.upperSource,ids.upper.replace(/-/g,''));
  assert.equal(c.titleProp,'المصدر');
  assert.equal(c.typeProp,'نوع الصفحة');
  assert.equal(c.habitTitleProp,'العادة');
  assert.equal(c.habitOccRelationProp,'قاعدة العادات');
  assert.equal(c.habitOccDayProp,'يوم التنفيذ');
  assert.equal(c.unit,'hours');
  assert.equal(c.typeValues,'مهمة, حزمة');
  assert.equal(c.habitOccTypeValue,'عادة');
  assert.equal(c.alfProfile.writebackEnabled,false);
  for(const [key,binding] of Object.entries(c.taskPropertyBindings)){
    assert.equal(binding.input,c[key]);
    assert.equal(binding.sourceId,c.taskSource);
    assert.ok(binding.id);
  }
  assert.equal(c.deadlineProp,'');
  assert.equal(c.priorityProp,'');
  assert.equal(c.habitOccCountProp,'');
  assert.equal(c.observedPomoProp,'');
  assert.equal(a.requests.length,6); // two search pages + four read-only GETs
  assert.ok(a.requests.every(x=>
    x.opts.method==='GET'||(x.opts.method==='POST'&&x.url.endsWith('/search'))));
  assert.ok(!JSON.stringify(result).includes('ntn_FAKE_TEST_NOT_REAL'));
  assert.ok(!JSON.stringify(result).includes('تعلم') &&
            !c.typeValues.includes('تدوين'));
});

test('missing shared Notion source fails closed without substituting known tenant IDs',async()=>{
  const a=prepare();
  const orig=a.api.request;
  a.api.request=async (url,opts)=>{
    const result=await orig(url,opts);
    if(url.endsWith('/search'))result.results=result.results.filter(
      s=>!s.title.some(p=>p.plain_text==='قاعدة العادات'));
    return result;
  };
  await assert.rejects(()=>discover(a.api),/ALF_DISCOVERY_MISSING: قاعدة العادات/);
});

test('duplicate exact-title data sources are not guessed from ordering',async()=>{
  const a=prepare(),old=a.api.request;
  a.api.request=async(url,opts)=>{
    const result=await old(url,opts);
    if(url.endsWith('/search')&&opts.body.start_cursor){
      result.results.push({...result.results[0],id:
        '55555555-5555-4555-8555-555555555555',
        title:[{plain_text:'اللوح'}]});
    }
    return result;
  };
  await assert.rejects(()=>discover(a.api),/ALF_DISCOVERY_AMBIGUOUS: اللوح/);
});

test('wrong or missing existing field blocks mapping rather than creating a property',async()=>{
  const a=prepare();
  a.map.board['الوقت الفعلي'].type='formula';
  await assert.rejects(()=>discover(a.api),/ALF_DISCOVERY_SCHEMA: اللوح \/ الوقت الفعلي/);
});

test('changed project relation target fails closed even when all names match',async()=>{
  const a=prepare();
  a.map.board['العنصر الفرعي'].relation.data_source_id=ids.upper;
  await assert.rejects(()=>discover(a.api),/ALF_DISCOVERY_RELATION: اللوح/);
});

test('missing exact task/habit/status option does not invent an option',async()=>{
  const a=prepare();
  a.map.board['نوع الصفحة'].multi_select.options=
    a.map.board['نوع الصفحة'].multi_select.options.filter(x=>x.name!=='حزمة');
  await assert.rejects(()=>discover(a.api),/ALF_DISCOVERY_OPTIONS: نوع الصفحة \/ حزمة/);
});

test('only Alf data-source-only search shape is permitted by restricted host bridge',()=>{
  assert.equal(allowed('/search','POST',{page_size:100,
    filter:{property:'object',value:'data_source'}}),true);
  assert.equal(allowed('/search','POST',{page_size:101,
    filter:{property:'object',value:'data_source'}}),false);
  assert.equal(allowed('/search','POST',{page_size:100,
    filter:{property:'object',value:'page'}}),false);
  assert.equal(allowed('/search','POST',{page_size:100,query:'secret',
    filter:{property:'object',value:'data_source'}}),false);
});

test('unconfigured local token cannot even initiate a Notion inventory request',async()=>{
  const a=prepare();
  a.api.getSecret=async()=>null;
  await assert.rejects(()=>discover(a.api),/Save a local Notion token/);
  assert.equal(a.requests.length,0);
});

test('the real same-plugin host RPC discovery path never echoes the access token',async()=>{
  const a=prepare(),responses=[];
  const source={postMessage(data){responses.push(data);}};
  const handler=makeBridgeHandler(a.api,{querySelectorAll(){
    return [{contentWindow:source,
      srcdoc:'<!doctype html><meta name="alf-plugin-owner" content="alf-notion-super-productivity">'}];
  }});
  await handler({source,data:{channel:'alf-notion-host-rpc-v1',
    type:'request',id:'discover-1',op:'discover',args:{}}});
  assert.equal(responses.length,1);
  assert.equal(responses[0].ok,true);
  assert.equal(responses[0].value.totalFields,13);
  assert.ok(!JSON.stringify(responses).includes('ntn_FAKE_TEST_NOT_REAL'));
  assert.ok(a.requests.every(x=>x.opts.method==='GET'||x.url.endsWith('/search')));
  responses.length=0;
  await handler({source,data:{channel:'alf-notion-host-rpc-v1',
    type:'request',id:'discover-2',op:'discover',args:{query:'private'}}});
  assert.equal(responses[0].ok,false,'unbounded discovery options refused');
});

test('default interface is a single token field and advanced mapper is collapsed',()=>{
  const detailsAt=html.indexOf('<details id="advancedSettings"');
  const mainAt=html.indexOf('id="quickToken"');
  const oldAt=html.indexOf('id="taskSource"');
  assert.ok(mainAt>0 && mainAt<detailsAt);
  assert.ok(oldAt>detailsAt);
  assert.ok(html.includes('id="connectAuto"'));
  assert.ok(html.includes('id="quickReport"'));
  assert.ok(html.includes('id="quickPreviews" hidden'));
  assert.ok(html.includes("alfHostRpc('discover',{})"));
  assert.ok(html.includes("await PluginAPI.persistDataSynced(JSON.stringify(discovery.config),CFG_KEY)"));
});

test('daily habits use the main board entrypoint and CI is Woodpecker-only',()=>{
  assert.ok(html.includes('id="quickPreviewHabits"'));
  assert.ok(html.includes("addEventListener('click',previewTodayBoardHabits)"));
  assert.ok(html.includes("queryExistingHabitDay(c,day,sourceId,schema,false)"));
  assert.ok(html.includes('id="dailyHabitRows"'));
  const ci=fs.readFileSync(path.join(__dirname,'..','.woodpecker.yml'),'utf8');
  assert.match(ci,/node --test test\/\*\.test\.cjs/);
  assert.match(ci,/image: node:22-alpine/);
  assert.equal(fs.existsSync(path.join(__dirname,'..','.github','workflows','mapping-tests.yml')),false);
});
