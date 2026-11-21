'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','plugin.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const scope={console};
vm.createContext(scope);
vm.runInContext(source,scope,{filename:'plugin.js'});
const allowed=vm.runInContext('alfAutoAllowedType',scope);
const timePage=vm.runInContext('alfAutoTimePage',scope);
const sourceId='11111111111141118111111111111111';
const notionId='22222222222242228222222222222222';

function boardPage(types) {
  return {
    object:'page',id:notionId,in_trash:false,
    parent:{type:'data_source_id',data_source_id:sourceId},
    properties:{
      'نوع الصفحة':{id:'kindId',type:'multi_select',
        multi_select:types.map(name=>({name}))},
      'الوقت الفعلي':{id:'workHoursId',type:'number',number:0}
    }
  };
}
const planSpec={ids:{typeProp:'kindId'},allowed:['مهمة','حزمة'],
  excludedHabit:'عادة'};
const timeSpec={sourceId,typeId:'kindId',actualId:'workHoursId',
  allowed:['مهمة','حزمة'],unit:'hours',excludedHabit:'عادة'};

test('Alf multi-select task facet stays eligible for planning despite a habit facet',()=>{
  assert.equal(allowed(boardPage(['مهمة','عادة']),planSpec),true);
  assert.equal(allowed(boardPage(['حزمة','عادة']),planSpec),true);
  assert.equal(allowed(boardPage(['مهمة','عادة','تدوين']),planSpec),true);
  assert.equal(allowed(boardPage(['مهمة']),planSpec),true);
  assert.equal(allowed(boardPage(['حزمة']),planSpec),true);
  assert.equal(allowed(boardPage(['عادة']),planSpec),false);
  assert.equal(allowed(boardPage(['تدوين']),planSpec),false);
});

test('Alf mixed habit+task page retains its independently mapped work-time facet',()=>{
  assert.equal(timePage(boardPage(['مهمة','عادة']),timeSpec,notionId),0);
  assert.equal(timePage(boardPage(['مهمة','عادة','تدوين']),timeSpec,notionId),0);
  assert.equal(timePage(boardPage(['حزمة','عادة']),timeSpec,notionId),0);
  assert.equal(timePage(boardPage(['مهمة']),timeSpec,notionId),0);
  assert.equal(timePage(boardPage(['عادة']),timeSpec,notionId),null);
});

test('manual task preview and importer recognize both facets for same Notion page',()=>{
  const match=html.match(/  function taskTypesAllowed\(page,c,allowed\) \{[\s\S]*?\n  \}/);
  assert.ok(match,'manual task filter exists');
  const uiAllowed=vm.runInNewContext('('+match[0]+')',{
    taskProperty:(page)=>page.properties['نوع الصفحة'],
    typeValue:(p)=>p.multi_select.map(x=>x.name)
  });
  const config={alfProfile:{name:'alf-life-os'},habitOccTypeValue:'عادة'};
  assert.equal(uiAllowed(boardPage(['مهمة','عادة']),config,['مهمة','حزمة']),true);
  assert.equal(uiAllowed(boardPage(['حزمة','عادة']),config,['مهمة','حزمة']),true);
  assert.equal(uiAllowed(boardPage(['عادة']),config,['مهمة','حزمة']),false);
  assert.equal(uiAllowed(boardPage(['عادة','تدوين']),config,['مهمة','حزمة']),false);
  assert.equal(uiAllowed(boardPage(['عادة','تدوين']),config,['عادة']),true);
});
