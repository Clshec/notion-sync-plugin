'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function functionFromUi(name,context={}){
  const re=new RegExp('(async )?function '+name+
    '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}');
  const found=html.match(re);
  assert.ok(found,'UI function '+name+' exists');
  return vm.runInNewContext('('+found[0]+')',context);
}
function validProfile(){
  const uuid=x=>x.repeat(32),board=uuid('1');
  const fields=['titleProp','typeProp','executionProp',
    'estimateProp','actualProp','statusProp','projectProp','parentProp'];
  const habitFields=['habitTitleProp','habitCadenceProp'];
  const occurrenceFields=['habitOccTypeProp','habitOccRelationProp',
    'habitOccDayProp'];
  const pin=(keys,source,prefix)=>Object.fromEntries(keys.map((key,i)=>[
    key,{sourceId:source,input:'existing-'+key,id:prefix+'-pin-'+i}]));
  return {
    version:2,taskSource:board,habitSource:uuid('2'),
    projectSource:uuid('3'),
    alfProfile:{name:'alf-life-os',upperSource:uuid('4'),
      lowerSource:uuid('3')},
    habitPropertyBindings:{
      definitions:pin(habitFields,uuid('2'),'habit'),
      occurrences:pin(occurrenceFields,board,'day')},
    taskPropertyBindings:pin(fields,board,'task'),
    ...Object.fromEntries([...fields,...habitFields,...occurrenceFields]
      .map(key=>[key,'existing-'+key]))
  };
}
test('end-user connection validates original shared sources and pinned fields without manual IDs',()=>{
  const ready=functionFromUi('alfQuickReady');
  const c=validProfile();
  assert.equal(ready(c),true);
  assert.equal(ready({...c,alfProfile:{...c.alfProfile,upperSource:''}}),false);
  assert.equal(ready({...c,taskPropertyBindings:{
    ...c.taskPropertyBindings,actualProp:{...c.taskPropertyBindings.actualProp,
      sourceId:'unrelated-source'}}}),false);
  assert.equal(ready({...c,habitPropertyBindings:{
    ...c.habitPropertyBindings,definitions:{}}}),false,
  'missing habit pins must not enable synchronization');
  assert.equal(ready({...c,habitPropertyBindings:{
    ...c.habitPropertyBindings,occurrences:{
      ...c.habitPropertyBindings.occurrences,habitOccDayProp:{
        ...c.habitPropertyBindings.occurrences.habitOccDayProp,
        sourceId:'unrelated-source'}}}}),false);
});
test('one-token connection automatically enables a device writer exactly once',async()=>{
  const saved=new Map(),secretWrites=[];
  const metadata=new Map([
    ['alf-mapping-v2',JSON.stringify(validProfile())]
  ]);
  const context={
    GRAPH_CUTOVER_KEY:'alf-auto-graph-cutover-v1',
    GRAPH_AUTO_KEY:'alf-auto-graph-local-enabled-v1',
    GRAPH_SP_PROJECT_BASELINE_KEY:'alf-graph-sp-projects-at-connect-v1',
    CFG_KEY:'alf-mapping-v2',
    PluginAPI:{
      async loadSyncedData(k){return metadata.get(k)||null;},
      async persistDataSynced(v,k){metadata.set(k,v);},
      async getAllProjects(){return [{id:'old-sp-project',title:'Old project'}];}
    },
    alfUiGetSecret:async k=>saved.get(k)||null,
    alfUiSetSecret:async(k,v)=>{saved.set(k,v);secretWrites.push(k);}
  };
  const start=functionFromUi('alfQuickStartVerifiedSync',context);
  await start();
  assert.equal(saved.get('alf-auto-graph-local-enabled-v1'),'enabled');
  const initial=saved.get('alf-auto-graph-cutover-v1');
  const boundary=JSON.parse(initial);
  assert.equal(boundary.version,1);
  assert.ok(boundary.sinceMs>Date.now()-10000);
  await start();
  assert.equal(saved.get('alf-auto-graph-cutover-v1'),initial);
  assert.equal(secretWrites.filter(k=>k==='alf-auto-graph-cutover-v1').length,1,
    'reconnection cannot reset the no-mass-import boundary');
  const projects=JSON.parse(metadata.get('alf-graph-sp-projects-at-connect-v1'));
  assert.deepEqual(projects.ids,['old-sp-project']);
  // A harmless reconnect must preserve the same boundary. But a credential
  // rotation to the SAME Notion source must re-snapshot current native SP
  // projects, otherwise old projects can be exported as new.
  let currentProjects=[{id:'old-sp-project',title:'Old project'},
    {id:'created-before-rotation',title:'Existing now'}];
  context.PluginAPI.getAllProjects=async()=>currentProjects;
  await start(true);
  const refreshed=JSON.parse(metadata.get('alf-graph-sp-projects-at-connect-v1'));
  assert.deepEqual(refreshed.ids,
    ['created-before-rotation','old-sp-project']);
  const connect=html.slice(html.indexOf('async function alfQuickConnect()'),
    html.indexOf('function dataSourceId(value'));
  assert.match(connect,
    /await PluginAPI\.persistDataSynced\(JSON\.stringify\(discovery\.config\),CFG_KEY\);[\s\S]*?await alfQuickStartVerifiedSync\(credentialChanged\|\|workBindingChanged\)/);
});
test('technical selectors are behind collapsed developer diagnostics',()=>{
  assert.match(html,/<details id="advancedSettings" class="advanced">/);
  assert.match(html,/advanced\.appendChild\(ui\('graphSyncSection'\)\)/);
  assert.match(html,/advanced\.appendChild\(ui\('quickPreviews'\)\)/);
  assert.match(html,/<input id="quickToken" type="password"/);
});
