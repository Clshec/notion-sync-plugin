'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','plugin.js'),'utf8');
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

test('Alf mixed habit+task page is never eligible for unattended SP planning',()=>{
  assert.equal(allowed(boardPage(['مهمة','عادة']),planSpec),false);
  assert.equal(allowed(boardPage(['حزمة','عادة']),planSpec),false);
  assert.equal(allowed(boardPage(['مهمة']),planSpec),true);
  assert.equal(allowed(boardPage(['حزمة']),planSpec),true);
});

test('Alf mixed habit+task page is never eligible for automatic work-time Number PATCH',()=>{
  assert.equal(timePage(boardPage(['مهمة','عادة']),timeSpec,notionId),null);
  assert.equal(timePage(boardPage(['مهمة']),timeSpec,notionId),0);
});
