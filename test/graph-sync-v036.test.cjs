'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','plugin.js'),'utf8');
const ctx={console,setTimeout,clearTimeout,Date,Math};
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'plugin.js'});
const run=(expression,...args)=>{
  const fn=vm.runInContext(expression,ctx);
  return fn(...args);
};
const uid=x=>x.repeat(32);
const upper=uid('1'),small=uid('2'),board=uid('3'),habit=uid('4');
const bundle=uid('5'),child=uid('6'),folder=uid('7');
const keys={
  titleProp:['المصدر','title'],typeProp:['نوع الصفحة','multi_select'],
  executionProp:['يوم التنفيذ','date'],
  estimateProp:['الوقت المخطط له','number'],
  actualProp:['الوقت الفعلي','number'],
  statusProp:['Status','status'],
  projectProp:['العنصر الفرعي','relation'],
  parentProp:['الحزمة الأب','relation']
};
function mapping(){
  return {version:2,taskSource:board,projectSource:small,
    unit:'hours',typeValues:'مهمة, حزمة',
    alfProfile:{name:'alf-life-os',upperSource:upper,lowerSource:small},
    taskPropertyBindings:Object.fromEntries(Object.entries(keys).map(
      ([k,[input]])=>[k,{sourceId:board,input,id:k+'-id'}])),
    ...Object.fromEntries(Object.entries(keys).map(([k,[name]])=>[k,name]))};
}
function row(id,title,type,proj=small,parent=null){
  return {id,object:'page',parent:{data_source_id:board},properties:{
    'المصدر':{id:'titleProp-id',type:'title',title:[{plain_text:title}]},
    'نوع الصفحة':{id:'typeProp-id',type:'multi_select',
      multi_select:type.map(name=>({name}))},
    'يوم التنفيذ':{id:'executionProp-id',type:'date',date:{start:'2026-11-18'}},
    'الوقت المخطط له':{id:'estimateProp-id',type:'number',number:1.5},
    'الوقت الفعلي':{id:'actualProp-id',type:'number',number:0},
    'Status':{id:'statusProp-id',type:'status',status:{name:'Not started'}},
    'العنصر الفرعي':{id:'projectProp-id',type:'relation',
      relation:proj?[{id:proj}]:[]},
    'الحزمة الأب':{id:'parentProp-id',type:'relation',
      relation:parent?[{id:parent}]:[]}
  }};
}
function sample(){
  return {ids:{upper,lower:small,board},c:mapping(),token:'ntn_FAKE_TEST_ONLY',
    upperChoices:[{id:upper,name:'Master project'}],
    projects:[{id:small,name:'Verified small project',parent:upper}],
    tasks:[
      run('alfGraphItem',row(bundle,'Bundle A',['حزمة']),mapping()),
      run('alfGraphItem',row(child,'Child A',['مهمة'],small,bundle),mapping())
    ],spProjects:[],spActive:[],spArchive:[]};
}
function fixture(inventory=sample()){
  const saved=new Map(),events=[];
  let projects=inventory.spProjects.map(p=>({...p})),
    tasks=inventory.spActive.map(t=>({...t}));
  const api={
    async loadSyncedData(k){return saved.get(k)||null;},
    async persistDataSynced(v,k){events.push(['save',k]);saved.set(k,v);},
    async getAllProjects(){return projects.map(p=>({...p}));},
    async updateProject(id,changes){
      const p=projects.find(x=>x.id===id);
      if(!p)throw new Error('missing SP project');
      Object.assign(p,changes);events.push(['updateProject',id,changes.title]);
    },
    async getTasks(){return tasks.map(t=>({...t}));},
    async getArchivedTasks(){return [];},
    async addProject(p){
      const id='sp-project-'+(projects.length+1);
      projects.push({id,title:p.title});events.push(['addProject',p.title]);return id;
    },
    async addTask(t){
      const id='sp-task-'+(tasks.length+1);
      tasks.push({...t,id});events.push(['addTask',t.title,t.parentId||null]);return id;
    },
    async updateTask(id,changes){
      const t=tasks.find(x=>x.id===id);
      if(!t)throw new Error('missing task');
      Object.assign(t,changes);events.push(['updateTask',id]);
    },
    async request(uri,opts){
      events.push(['notion',uri,opts.method,opts.body]);
      if(opts.method==='POST'&&uri.endsWith('/pages')){
        const nid=uid(String(8+(events.filter(e=>e[0]==='notion').length%2)));
        const parentId=opts.body.parent.data_source_id;
        return {id:nid,object:'page',parent:{data_source_id:parentId}};
      }
      throw new Error('Unexpected Notion endpoint');
    }
  };
  return {api,saved,events,projects,tasks,inventory};
}
test('original board maps bundle to parent, task relation to subtask, excludes mixed habit',()=>{
  assert.equal(run('alfGraphItem',row(uid('8'),'Habit task',['مهمة','عادة']),mapping()),null);
  const childItem=run('alfGraphItem',row(child,'Child A',['مهمة'],small,bundle),mapping());
  assert.equal(childItem.parents[0],bundle);
  assert.equal(childItem.projects[0],small);
  assert.equal(childItem.estimateMs,5400000);
});
test('verified lower project and bundle graph creates native persistent SP entities in order',async()=>{
  const f=fixture();
  const p=await run('alfGraphPlan',f.api,f.inventory);
  assert.equal(p.projects.length,1);
  assert.deepEqual(Array.from(p.tasks,x=>x.kind),['task','subtask']);
  const saved=await run('alfGraphApplyLocal',f.api,f.inventory,p);
  assert.equal(saved.projects,1);
  assert.equal(saved.tasks,2);
  assert.deepEqual(f.events.filter(x=>x[0]==='addTask'),[
    ['addTask','Bundle A',null],['addTask','Child A','sp-task-1']
  ]);
  for(const id of [bundle,child]){
    const anchor=JSON.parse(f.saved.get('alf-graph-status-v1-'+id));
    assert.equal(anchor.notionId,id);
    assert.equal(anchor.spDone,false);
    assert.equal(anchor.notionStatus,'Not started');
  }
  assert.equal(f.tasks[0].notes,'alf-notion-page-id:55555555-5555-5555-5555-555555555555');
  assert.equal(f.tasks[1].notes,'alf-notion-page-id:66666666-6666-6666-6666-666666666666');
  assert.equal(f.events.some(x=>x[0]==='notion'),false);
  // Every Notion ID is preserved; a second review finds no missing entities.
  const next={...f.inventory,spProjects:f.projects,spActive:f.tasks};
  const review=await run('alfGraphPlan',f.api,next);
  assert.equal(review.projects.length,0);
  assert.equal(review.tasks.length,0);
});
test('SP-created small projects and tasks require no extra parent selection and never invent an upper parent',async()=>{
  const x=sample();
  x.spProjects=[{id:'sp-native-project',title:'New small project'}];
  x.spActive=[{id:'native-task',title:'New focus task',projectId:'sp-native-project',
    notes:'Personal note',timeSpent:900000,timeEstimate:1800000,
    isDone:false,dueDay:'2026-11-18',subTaskIds:[]}];
  const f=fixture(x);
  const plan=await run('alfGraphPlan',f.api,x);
  assert.equal(plan.exportsProjects.length,1);
  assert.equal(plan.exportsTasks.length,1);
  const noParent=await run('alfGraphApplyRemote',f.api,x,plan,'');
  assert.equal(noParent.projects,1);
  assert.equal(noParent.tasks,1);
  const posts=f.events.filter(e=>e[0]==='notion'&&e[2]==='POST');
  assert.equal(posts.length,2);
  assert.equal(posts[0][3].parent.data_source_id,small);
  assert.equal(posts[0][3].properties['العنصر الأب'],undefined,
    'the SP project is unassigned; no major project parent was fabricated');
  assert.equal(posts[1][3].parent.data_source_id,board);
  assert.equal(posts[1][3].properties['نوع الصفحة'].multi_select[0].name,'مهمة');
  assert.equal(posts[1][3].properties['الوقت الفعلي'].number,0.25);
  assert.match(f.tasks[0].notes,/Personal note\nalf-notion-page-id:/);
  // Replaying with the same reviewed plan refuses a second POST.
  const replay=await run('alfGraphApplyRemote',f.api,x,plan,'');
  assert.equal(replay.projects,0);
  assert.equal(replay.tasks,0);
  assert.equal(f.events.filter(e=>e[0]==='notion').length,2);
});
test('when a verified upper project is provided it is preserved for an SP-origin small project',async()=>{
  const x=sample();
  x.spProjects=[{id:'sp-native-project',title:'New small project'}];
  const f=fixture(x),p=await run('alfGraphPlan',f.api,x);
  const result=await run('alfGraphApplyRemote',f.api,x,p,upper);
  assert.equal(result.projects,1);
  const post=f.events.find(e=>e[0]==='notion'&&e[2]==='POST');
  assert.equal(post[3].properties['العنصر الأب'].relation[0].id,upper);
});
test('unassigned SP-created lower project is recognized by persisted identity, unrelated orphan pages remain excluded',async()=>{
  const linked=folder,unrelated=uid('a'),x=sample();
  x.spProjects=[{id:'sp-existing',title:'SP-created small project'}];
  x.tasks=[];
  const f=fixture(x);
  f.saved.set('alf-mapping-v2',JSON.stringify(mapping()));
  f.saved.set('alf-graph-project-v1-'+linked,JSON.stringify({
    version:1,notionId:linked,spId:'sp-existing'}));
  f.api.getSecret=async key=>key==='alf-notion-token'?
    'ntn_FAKE_TEST_ONLY':null;
  const smallRow=(id,title)=>({id,object:'page',
    created_time:'2026-11-19T00:00:00Z',properties:{
      Name:{type:'title',title:[{plain_text:title}]},
      'النوع  ':{type:'multi_select',multi_select:[]},
      'العنصر الأب':{type:'relation',relation:[]},
      'المجلد الأب الفرعي':{type:'relation',relation:[]}
    }});
  f.api.request=async(uri,opts)=>{
    const source=uri.split('/data_sources/')[1]||'';
    const isQuery=source.endsWith('/query');
    const id=source.replace(/\/query$/,'');
    if(!isQuery){
      if(id===upper)return {properties:{
        Name:{type:'title'},'النظام':{type:'select'}}};
      if(id===small)return {properties:{
        Name:{type:'title'},'العنصر الأب':{type:'relation'},
        'النوع  ':{type:'multi_select'}}};
      if(id===board)return {properties:Object.fromEntries(
        Object.entries(keys).map(([key,[name,type]])=>[
          name,{id:key+'-id',type}]))};
    }
    if(isQuery){
      if(id===upper)return {results:[{id:upper,properties:{
        Name:{type:'title',title:[{plain_text:'Main project'}]},
        'النظام':{type:'select',select:{name:'مشروع'}}}
      }],has_more:false};
      if(id===small)return {results:[
        smallRow(linked,'SP-created small project'),
        smallRow(unrelated,'Unrelated orphan knowledge')],
        has_more:false};
      if(id===board)return {results:[],has_more:false};
    }
    throw new Error('Unexpected Notion test URL '+uri);
  };
  const inv=await run('alfGraphInventory',f.api);
  assert.equal(inv.projects.length,1);
  assert.equal(inv.projects[0].id,linked);
  assert.equal(inv.projects[0].parent,null);
  const plan=await run('alfGraphPlan',f.api,inv);
  assert.equal(plan.links.projects.get(linked),'sp-existing');
  assert.equal(plan.exportsProjects.length,0);
});
test('a failed Notion create leaves durable attempted intent and is never retried',async()=>{
  const x=sample();x.spProjects=[{id:'native-project',title:'Native project'}];
  const f=fixture(x);
  f.api.request=async()=>{f.events.push(['failedPost']);throw new Error('timeout');};
  const plan=await run('alfGraphPlan',f.api,x);
  const first=await run('alfGraphApplyRemote',f.api,x,plan,upper);
  assert.equal(first.pending,1);
  const second=await run('alfGraphApplyRemote',f.api,x,plan,upper);
  assert.equal(second.pending,1);
  assert.equal(f.events.filter(e=>e[0]==='failedPost').length,1);
});
test('unknown project name collision blocks auto duplicate without guessing identity',async()=>{
  const x=sample();x.spProjects=[{id:'preexisting',title:'Verified small project'}];
  const f=fixture(x);
  const p=await run('alfGraphPlan',f.api,x);
  assert.equal(p.projects.length,1);
  assert.equal(p.projects[0].adoptSpId,'preexisting');
  const applied=await run('alfGraphApplyLocal',f.api,x,p);
  assert.equal(applied.projects,1);
  assert.equal(f.events.some(e=>e[0]==='addProject'),false);
});
test('linked small-project rename in Notion updates native SP Project without duplicate',async()=>{
  const x=sample();
  x.spProjects=[{id:'sp-project-1',title:'Verified small project'}];
  const f=fixture(x);
  f.saved.set('alf-graph-project-v1-'+small,JSON.stringify({
    version:1,notionId:small,spId:'sp-project-1'}));
  const plan=await run('alfGraphPlan',f.api,x);
  const initial=await run('alfGraphSyncProjectTitles',f.api,x,plan);
  assert.equal(initial.anchored,1);
  x.projects[0].name='Renamed in Notion';
  const updated=await run('alfGraphSyncProjectTitles',f.api,x,plan);
  assert.equal(updated.updatedSp,1);
  assert.equal(updated.writtenNotion,0);
  assert.equal(f.projects.length,1);
  assert.equal(f.projects[0].title,'Renamed in Notion');
  assert.equal(f.events.filter(e=>e[0]==='addProject').length,0);
});
test('native SP small-project rename writes only original Notion title after exact preflight',async()=>{
  const x=sample();
  x.spProjects=[{id:'sp-project-1',title:'Verified small project'}];
  const f=fixture(x);
  f.saved.set('alf-graph-project-v1-'+small,JSON.stringify({
    version:1,notionId:small,spId:'sp-project-1'}));
  const plan=await run('alfGraphPlan',f.api,x);
  await run('alfGraphSyncProjectTitles',f.api,x,plan);
  x.spProjects[0].title='Renamed from Super Productivity';
  f.projects[0].title='Renamed from Super Productivity';
  f.api.request=async(uri,opts)=>{
    f.events.push(['notion',uri,opts.method,opts.body]);
    if(opts.method==='GET'&&uri.endsWith('/pages/'+small))
      return {id:small,object:'page',parent:{data_source_id:small},
        properties:{Name:{type:'title',
          title:[{plain_text:'Verified small project'}]}}};
    if(opts.method==='PATCH'&&uri.endsWith('/pages/'+small))
      return {id:small,object:'page'};
    throw new Error('Unexpected Notion project request');
  };
  const updated=await run('alfGraphSyncProjectTitles',f.api,x,plan);
  assert.equal(updated.writtenNotion,1);
  const patch=f.events.find(e=>e[0]==='notion'&&e[2]==='PATCH');
  assert.deepEqual(Object.keys(patch[3].properties),['Name']);
  assert.equal(patch[3].properties.Name.title[0].text.content,
    'Renamed from Super Productivity');
});
test('concurrent divergent small-project renames refuse to overwrite either side',async()=>{
  const x=sample();
  x.spProjects=[{id:'sp-project-1',title:'Verified small project'}];
  const f=fixture(x);
  f.saved.set('alf-graph-project-v1-'+small,JSON.stringify({
    version:1,notionId:small,spId:'sp-project-1'}));
  const plan=await run('alfGraphPlan',f.api,x);
  await run('alfGraphSyncProjectTitles',f.api,x,plan);
  x.projects[0].name='Notion new name';
  x.spProjects[0].title='Different SP new name';
  const result=await run('alfGraphSyncProjectTitles',f.api,x,plan);
  assert.equal(result.conflicts,1);
  assert.equal(result.writtenNotion,0);
  assert.equal(result.updatedSp,0);
  assert.equal(f.events.some(e=>e[0]==='notion'),false);
});
function linkedPlanningFixture(){
  const x=sample();
  x.tasks=[run('alfGraphItem',row(child,'Child A',['مهمة'],small),
    mapping())];
  const dashed=child.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    '$1-$2-$3-$4-$5');
  x.spActive=[{id:'sp-planned',title:'Child A',notes:
    'alf-notion-page-id:'+dashed,projectId:'INBOX_PROJECT',
    timeEstimate:5400000,dueDay:'2026-11-18',isDone:false,
    subTaskIds:[]}];
  const f=fixture(x);
  const plan={links:{tasks:new Map([[child,'sp-planned']])}};
  return {x,f,plan};
}
test('linked task title edit in Notion automatically updates native SP task',async()=>{
  const o=linkedPlanningFixture();
  const initial=await run('alfGraphSyncTaskPlanning',
    o.f.api,o.x,o.plan);
  assert.equal(initial.anchored,1);
  o.x.tasks[0].title='Updated in Notion';
  const res=await run('alfGraphSyncTaskPlanning',o.f.api,o.x,o.plan);
  assert.equal(res.updatedSp,1);
  assert.equal(o.f.tasks[0].title,'Updated in Notion');
  assert.equal(o.f.events.some(e=>e[0]==='notion'),false);
});
test('linked SP title, estimate and due-day edits PATCH exact original pinned Notion fields',async()=>{
  const o=linkedPlanningFixture();
  await run('alfGraphSyncTaskPlanning',o.f.api,o.x,o.plan);
  o.x.spActive[0].title='Edited in SP';
  o.x.spActive[0].timeEstimate=7200000;
  o.x.spActive[0].dueDay='2026-11-20';
  Object.assign(o.f.tasks[0],{
    title:'Edited in SP',timeEstimate:7200000,dueDay:'2026-11-20'});
  o.f.api.request=async(uri,opts)=>{
    o.f.events.push(['notion',uri,opts.method,opts.body]);
    if(opts.method==='GET'&&uri.endsWith('/pages/'+child))
      return row(child,'Child A',['مهمة'],small);
    if(opts.method==='PATCH'&&uri.endsWith('/pages/'+child))
      return {id:child,object:'page'};
    throw new Error('Unexpected planning endpoint');
  };
  const res=await run('alfGraphSyncTaskPlanning',o.f.api,o.x,o.plan);
  assert.equal(res.writtenNotion,1);
  const patch=o.f.events.find(e=>e[0]==='notion'&&e[2]==='PATCH');
  assert.deepEqual(Object.keys(patch[3].properties).sort(),
    ['titleProp-id','estimateProp-id','executionProp-id'].sort());
  assert.equal(patch[3].properties['titleProp-id'].title[0].text.content,
    'Edited in SP');
  assert.equal(patch[3].properties['estimateProp-id'].number,2);
  assert.equal(patch[3].properties['executionProp-id'].date.start,
    '2026-11-20');
});
test('divergent simultaneous Notion and SP task title edits never overwrite each other',async()=>{
  const o=linkedPlanningFixture();
  await run('alfGraphSyncTaskPlanning',o.f.api,o.x,o.plan);
  o.x.tasks[0].title='Notion edit';
  o.x.spActive[0].title='SP edit';
  const res=await run('alfGraphSyncTaskPlanning',o.f.api,o.x,o.plan);
  assert.equal(res.conflicts,1);
  assert.equal(res.updatedSp,0);
  assert.equal(res.writtenNotion,0);
  assert.equal(o.f.events.some(e=>e[0]==='notion'),false);
});
test('timed native due date cannot be silently rewritten by a date-only Notion field',async()=>{
  const o=linkedPlanningFixture();
  o.x.spActive[0].dueWithTime=1763550000000;
  const res=await run('alfGraphSyncTaskPlanning',o.f.api,o.x,o.plan);
  assert.equal(res.skipped,1);
  assert.equal(res.writtenNotion,0);
});
function linkedTaskProjectFixture(){
  const x=sample(),projectSpId='sp-linked-project';
  x.tasks=[run('alfGraphItem',row(child,'Child A',['مهمة'],small),
    mapping())];
  x.spProjects=[{id:projectSpId,title:'Verified small project'}];
  const dashed=child.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    '$1-$2-$3-$4-$5');
  x.spActive=[{id:'sp-linked-task',title:'Child A',projectId:projectSpId,
    notes:'alf-notion-page-id:'+dashed,isDone:false,
    timeEstimate:5400000,dueDay:'2026-11-18',subTaskIds:[]}];
  const f=fixture(x);
  const plan={links:{
    projects:new Map([[small,projectSpId]]),
    tasks:new Map([[child,'sp-linked-task']])
  }};
  return {x,f,plan};
}
test('Notion moves a linked top-level task to Inbox using native SP project move',async()=>{
  const o=linkedTaskProjectFixture();
  const init=await run('alfGraphSyncTaskProjects',o.f.api,o.x,o.plan);
  assert.equal(init.anchored,1);
  o.x.tasks[0].projects=[];
  const moved=await run('alfGraphSyncTaskProjects',o.f.api,o.x,o.plan);
  assert.equal(moved.updatedSp,1);
  assert.equal(o.f.tasks[0].projectId,null);
  assert.equal(moved.writtenNotion,0);
});
test('SP top-level task project move patches only the original Notion relation field',async()=>{
  const o=linkedTaskProjectFixture();
  await run('alfGraphSyncTaskProjects',o.f.api,o.x,o.plan);
  o.x.spActive[0].projectId='INBOX_PROJECT';
  o.f.tasks[0].projectId='INBOX_PROJECT';
  o.f.api.request=async(uri,opts)=>{
    o.f.events.push(['notion',uri,opts.method,opts.body]);
    if(opts.method==='GET')return row(child,'Child A',['مهمة'],small);
    if(opts.method==='PATCH')return {id:child,object:'page'};
    throw new Error('Unexpected project move request');
  };
  const res=await run('alfGraphSyncTaskProjects',o.f.api,o.x,o.plan);
  assert.equal(res.writtenNotion,1);
  const patch=o.f.events.find(e=>e[0]==='notion'&&e[2]==='PATCH');
  assert.deepEqual(Object.keys(patch[3].properties),['projectProp-id']);
  assert.equal(patch[3].properties['projectProp-id'].relation.length,0);
});
test('a linked subtask cannot be moved by writing parentId via unsafe SP API',async()=>{
  const o=linkedTaskProjectFixture();
  o.x.tasks[0].parents=[bundle];
  o.x.spActive[0].parentId='native-parent';
  const res=await run('alfGraphSyncTaskProjects',o.f.api,o.x,o.plan);
  assert.equal(res.skipped,1);
  assert.equal(res.updatedSp,0);
  assert.equal(res.writtenNotion,0);
});
test('linked SP task completion updates exactly its original Notion Status, not another field',async()=>{
  const x=sample();
  x.spProjects=[{id:'project-linked',title:'Verified small project'}];
  x.spActive=[{id:'task-linked',title:'Child A',projectId:'project-linked',
    notes:'alf-notion-page-id:'+child,isDone:false,subTaskIds:[]}];
  x.tasks=[x.tasks[1]];
  const f=fixture(x);
  const plan={links:{tasks:new Map([[child,'task-linked']])}};
  f.api.request=async(uri,opts)=>{
    f.events.push(['notion',uri,opts.method,opts.body]);
    if(opts.method==='GET')return {id:child,object:'page',
      parent:{data_source_id:board},
      properties:{'Status':{type:'status',status:{name:'Not started'}}}};
    if(opts.method==='PATCH')return {id:child,object:'page'};
    throw new Error('Unexpected API call');
  };
  const boot=await run('alfGraphSyncStatuses',f.api,x,plan);
  assert.equal(boot.anchored,1);
  x.spActive[0].isDone=true;
  f.tasks[0].isDone=true;
  const done=await run('alfGraphSyncStatuses',f.api,x,plan);
  assert.equal(done.written,1);
  const patches=f.events.filter(e=>e[0]==='notion'&&e[2]==='PATCH');
  assert.equal(patches.length,1);
  assert.deepEqual(Object.keys(patches[0][3].properties),['statusProp-id']);
  assert.equal(patches[0][3].properties['statusProp-id'].status.name,'Done');
  assert.equal(f.events.filter(e=>e[0]==='updateTask').length,0);
});
test('simultaneous divergent Notion/SP completion changes are a conflict, never overwrite',async()=>{
  const x=sample();
  x.spActive=[{id:'task-linked',notes:'alf-notion-page-id:'+child,isDone:false,
    subTaskIds:[]}];
  x.tasks=[x.tasks[1]];
  const f=fixture(x);
  const plan={links:{tasks:new Map([[child,'task-linked']])}};
  const first=await run('alfGraphSyncStatuses',f.api,x,plan);
  assert.equal(first.anchored,1);
  x.tasks[0].status='In progress';
  x.spActive[0].isDone=true;
  const changed=await run('alfGraphSyncStatuses',f.api,x,plan);
  assert.equal(changed.conflicts,1);
  assert.equal(changed.written,0);
  assert.equal(changed.updated,0);
  assert.equal(f.events.some(e=>e[0]==='notion'),false);
});
test('observed Pomodoro lower bound attaches only to independently linked SP task',async()=>{
  const x=sample();
  x.spProjects=[{id:'linked-project',title:'Verified small project'}];
  x.spActive=[{id:'sp-child',title:'Child A',notes:'alf-notion-page-id:'+child,
    projectId:'linked-project',isDone:false,subTaskIds:[]}];
  const f=fixture(x);
  f.saved.set('alf-page-link-'+child,
    JSON.stringify({version:1,notionId:child,spId:'sp-child'}));
  const session={
    schemaVersion:1,sessionId:'session-1',taskId:'sp-child',
    mode:'Pomodoro',automatic:true,manual:false,observedCompletion:true,
    verifiedCompletedPomodoro:true,source:'live-sp-action-hook',
    startedAt:100,endedAt:200
  };
  f.saved.set('alf-focus-observed-v1-session-1',JSON.stringify(session));
  f.saved.set('alf-focus-observed-v1-session-bad',
    JSON.stringify({...session,sessionId:'session-bad',manual:true}));
  f.api.listSyncedDataKeys=async prefix=>[...f.saved.keys()].filter(k=>k.startsWith(prefix));
  const p=await run('alfGraphPlan',f.api,x);
  assert.equal(p.observedFocus.length,1);
  assert.equal(p.observedFocus[0].notionId,child);
  assert.equal(p.observedFocus[0].observedMinimum,1);
  const display=run('alfGraphPublicReview',p);
  assert.equal(display.totals.linkedObservedPomodoroTasks,1);
  assert.equal(f.events.filter(e=>e[0]==='notion').length,0);
});
test('automatic graph reconciliation is OFF by default and performs no writes',async()=>{
  const f=fixture();
  f.api.getSecret=async()=>null;
  const engine=run('alfCreateAutoGraphSync',f.api,{intervalMs:2000});
  const status=await engine.runOnce();
  assert.equal(status.enabled,false);
  assert.equal(status.written,0);
  assert.equal(f.events.length,0);
});
test('v0.36 links remain compatible with v0.35 exact hyphenated Notion marker format',async()=>{
  const x=sample();
  x.spProjects=[{id:'sp-project-known',title:'Verified small project'}];
  const fmt=id=>id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
  const hyphen=fmt(child);
  x.spActive=[{id:'sp-task-known',title:'Child A',notes:'alf-notion-page-id:'+hyphen,
    projectId:'sp-project-known',isDone:false,subTaskIds:[]}];
  const f=fixture(x);
  f.saved.set('alf-graph-project-v1-'+small,
    JSON.stringify({version:1,notionId:small,spId:'sp-project-known'}));
  f.saved.set('alf-page-link-'+hyphen,
    JSON.stringify({version:1,notionId:hyphen,spId:'sp-task-known'}));
  const p=await run('alfGraphPlan',f.api,x);
  assert.equal(p.links.tasks.get(child),'sp-task-known');
  assert.equal(p.tasks.some(t=>t.id===child),false);
});
test('SP project adoption never creates a duplicate task with same title as an unlinked task',async()=>{
  const x=sample();
  x.spProjects=[{id:'sp-existing',title:'Verified small project'}];
  x.spActive=[{id:'user-task-existing',title:'Bundle A',notes:'',
    projectId:'sp-existing',isDone:false,subTaskIds:[]}];
  const f=fixture(x);
  const p=await run('alfGraphPlan',f.api,x);
  assert.equal(p.projects.length,1);
  assert.equal(p.projects[0].adoptSpId,'sp-existing');
  assert.equal(p.tasks.some(t=>t.id===bundle),false);
  assert.ok(p.skipped.conflicts>0);
});
test('standalone Notion tasks import to SP Inbox without fabricating a small project',async()=>{
  const x=sample();
  x.projects=[];x.tasks=[run('alfGraphItem',
    row(child,'Unassigned board task',['مهمة'],null),mapping())];
  x.spProjects=[{id:'INBOX_PROJECT',title:'Inbox'}];
  const f=fixture(x);
  const p=await run('alfGraphPlan',f.api,x);
  assert.equal(p.projects.length,0);
  assert.equal(p.tasks.length,1);
  assert.equal(p.tasks[0].project,null);
  assert.equal(p.exportsProjects.length,0);
  const applied=await run('alfGraphApplyLocal',f.api,x,p);
  assert.equal(applied.tasks,1);
  assert.equal(f.tasks[0].projectId,undefined);
  assert.equal(f.events.some(e=>e[0]==='addProject'),false);
});
test('a native SP Inbox task exports to existing Notion board with no project relation',async()=>{
  const x=sample();
  x.projects=[];x.tasks=[];
  x.spProjects=[{id:'INBOX_PROJECT',title:'Inbox'}];
  x.spActive=[{id:'native-inbox-task',title:'Unassigned SP task',
    projectId:'INBOX_PROJECT',notes:'',timeSpent:0,timeEstimate:0,
    isDone:false,subTaskIds:[]}];
  const f=fixture(x);
  const p=await run('alfGraphPlan',f.api,x);
  assert.equal(p.exportsProjects.length,0);
  assert.equal(p.exportsTasks.length,1);
  const sent=await run('alfGraphApplyRemote',f.api,x,p,'');
  assert.equal(sent.projects,0);
  assert.equal(sent.tasks,1);
  const post=f.events.find(e=>e[0]==='notion'&&e[2]==='POST');
  assert.equal(post[3].parent.data_source_id,board);
  assert.equal(post[3].properties['العنصر الفرعي'],undefined);
});
test('diagnostic export targets one reviewed SP task and leaves unrelated SP tasks alone',async()=>{
  const x=sample();
  x.projects=[];x.tasks=[];
  x.spProjects=[{id:'INBOX_PROJECT',title:'Inbox'}];
  x.spActive=[
    {id:'only-me',title:'HGS',projectId:'INBOX_PROJECT',notes:'',
      timeSpent:0,timeEstimate:0,isDone:false,subTaskIds:[]},
    {id:'unrelated',title:'Unrelated old task',projectId:'INBOX_PROJECT',
      notes:'',timeSpent:0,timeEstimate:0,isDone:false,subTaskIds:[]}
  ];
  const f=fixture(x);
  const plan=await run('alfGraphPlan',f.api,x);
  const sent=await run('alfGraphApplyRemote',f.api,x,plan,'',
    {taskId:'only-me',maxWrites:1});
  assert.equal(sent.tasks,1);
  const posts=f.events.filter(e=>e[0]==='notion'&&e[2]==='POST');
  assert.equal(posts.length,1);
  assert.equal(posts[0][3].properties['المصدر'].title[0].text.content,'HGS');
  assert.equal(f.tasks[1].notes,'');
});
test('SP v20 absent optional task fields do not falsely block exact unchanged task export',async()=>{
  const x=sample();
  x.projects=[];x.tasks=[];
  x.spProjects=[{id:'INBOX_PROJECT',title:'Inbox'}];
  x.spActive=[{id:'new-sp-task',title:'HGS',projectId:'INBOX_PROJECT',
    timeSpent:0,timeEstimate:0,subTaskIds:[]}];
  const f=fixture(x);
  const p=await run('alfGraphPlan',f.api,x);
  assert.equal(p.exportsTasks.length,1);
  const result=await run('alfGraphApplyRemote',f.api,x,p,'',
    {taskId:'new-sp-task',maxWrites:1});
  assert.equal(result.tasks,1);
  assert.equal(result.skipped,0);
  assert.equal(f.events.filter(e=>e[0]==='notion'&&e[2]==='POST').length,1);
  const record=JSON.parse(f.saved.get('alf-graph-task-export-v1-new-sp-task'));
  assert.equal(record.status,'committed');
  const anchor=JSON.parse(f.saved.get('alf-graph-status-v1-'+record.notionId));
  assert.equal(anchor.notionStatus,'Not started');
  assert.equal(anchor.spDone,false);
});
test('enabled automatic engine exports the newest eligible SP Inbox task without a manual button',async()=>{
  const x=sample();
  x.projects=[];x.tasks=[];
  x.spProjects=[{id:'INBOX_PROJECT',title:'Inbox'}];
  x.spActive=[
    {id:'older',title:'Old unrelated',created:1,projectId:'INBOX_PROJECT',
      notes:'',timeSpent:0,timeEstimate:0,isDone:false,subTaskIds:[]},
    {id:'newer',title:'HGS',created:200,projectId:'INBOX_PROJECT',
      notes:'',timeSpent:0,timeEstimate:0,isDone:false,subTaskIds:[]}
  ];
  const f=fixture(x);
  const secrets=new Map([['alf-auto-graph-local-enabled-v1','enabled'],
    ['alf-auto-graph-cutover-v1',JSON.stringify({version:1,sinceMs:100})]]);
  f.api.getSecret=async key=>secrets.get(key)||null;
  f.api.setSecret=async(k,v)=>{secrets.set(k,v);};
  const engine=run('alfCreateAutoGraphSync',f.api,{inventory:async()=>x});
  const res=await engine.runOnce();
  assert.equal(res.enabled,true);
  assert.equal(res.written,1);
  assert.equal(f.events.filter(e=>e[0]==='notion'&&e[2]==='POST').length,1);
  const sent=f.events.find(e=>e[0]==='notion'&&e[2]==='POST');
  assert.equal(sent[3].properties['المصدر'].title[0].text.content,'HGS');
  const next=await engine.runOnce();
  assert.equal(next.written,0);
  assert.equal(f.events.filter(e=>e[0]==='notion'&&e[2]==='POST').length,1);
});
test('automatic graph activation never imports years of pre-existing records',async()=>{
  const x=sample();
  x.projects=[];x.tasks=[];
  x.spProjects=[{id:'INBOX_PROJECT',title:'Inbox'}];
  x.spActive=[
    {id:'old-task',title:'Existing task from before activation',
      created:100,projectId:'INBOX_PROJECT',notes:'',
      timeSpent:0,timeEstimate:0,isDone:false,subTaskIds:[]},
    {id:'new-task',title:'New task after activation',
      created:300,projectId:'INBOX_PROJECT',notes:'',
      timeSpent:0,timeEstimate:0,isDone:false,subTaskIds:[]}
  ];
  const f=fixture(x);
  const secrets=new Map([['alf-auto-graph-local-enabled-v1','enabled'],
    ['alf-auto-graph-cutover-v1',JSON.stringify({version:1,sinceMs:200})]]);
  f.api.getSecret=async k=>secrets.get(k)||null;
  f.api.setSecret=async(k,v)=>{secrets.set(k,v);};
  const res=await run('alfCreateAutoGraphSync',f.api,
    {inventory:async()=>x,notionCatchupMs:0}).runOnce();
  assert.equal(res.written,1);
  const posts=f.events.filter(e=>e[0]==='notion'&&e[2]==='POST');
  assert.equal(posts.length,1);
  assert.equal(posts[0][3].properties['المصدر'].title[0].text.content,
    'New task after activation');
});
test('new Notion task may bring only its older required small project, never all old projects',async()=>{
  const x=sample();
  x.projects=[
    {...x.projects[0],createdAt:100},
    {id:uid('a'),name:'Old unrelated project',parent:upper,createdAt:100}
  ];
  x.tasks=[
    {...x.tasks[0],createdAt:300},
    {...x.tasks[1],createdAt:100}
  ];
  const f=fixture(x);
  const p=await run('alfGraphPlan',f.api,x);
  const filtered=run('alfGraphOnlyNewEntities',p,200,{notionCatchupMs:0});
  assert.equal(filtered.projects.length,1);
  assert.equal(filtered.projects[0].id,small);
  assert.equal(filtered.tasks.length,1);
  assert.equal(filtered.tasks[0].id,bundle);
});
test('recent Notion task created just before enabling device sync is recovered without old backfill',async()=>{
  const now=Date.now();
  const plan={projects:[],tasks:[
    {id:uid('8'),title:'Recent task',createdAt:now-3600000,project:null},
    {id:uid('9'),title:'Ancient task',createdAt:now-10*86400000,project:null}
  ],exportsProjects:[],exportsTasks:[]};
  const p=run('alfGraphOnlyNewEntities',plan,now-1000);
  assert.equal(p.tasks.length,1);
  assert.equal(p.tasks[0].title,'Recent task');
});
test('brand-new SP project without optional created timestamp is synced after one-token baseline',()=>{
  const plan={projects:[],tasks:[],exportsTasks:[],exportsProjects:[
    {spId:'old-project',title:'Old pre-connection project',createdAt:null},
    {spId:'new-project',title:'New after connection',createdAt:null}
  ]};
  const p=run('alfGraphOnlyNewEntities',plan,Date.now()-1000,{
    spProjectIdsBefore:new Set(['old-project'])});
  assert.equal(p.exportsProjects.length,1);
  assert.equal(p.exportsProjects[0].spId,'new-project');
});
test('Notion incremental timestamp probe only reads original sources with pinned work filter',async()=>{
  const x=sample();const f=fixture(x);
  f.api.getSecret=async k=>k==='alf-notion-token'?'ntn_FAKE_ONLY':null;
  f.saved.set('alf-mapping-v2',JSON.stringify(mapping()));
  f.api.request=async(uri,opts)=>{
    f.events.push(['notion',uri,opts.method,opts.body]);
    return {results:[{id:child,last_edited_time:'2026-11-19T13:10:00.000Z'}],
      has_more:false};
  };
  const sig=await run('alfGraphQuickProbe',f.api,{now:1763558500000});
  assert.equal(typeof sig,'string');
  assert.equal(f.events.length,3);
  const boardProbe=f.events.find(e=>e[1].endsWith('/'+board+'/query'));
  assert.ok(boardProbe);
  assert.equal(boardProbe[3].filter.and[0].timestamp,'last_edited_time');
  assert.equal(boardProbe[3].filter.and[1].or[0].property,'نوع الصفحة');
  assert.equal(boardProbe[3].page_size,25);
});
function trackedTimeFixture({notionActual=0,spMs=90000}={}){
  const x=sample();
  x.tasks=[run('alfGraphItem',row(child,'Child A',['مهمة'],small),
    mapping())];
  const dashed=child.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    '$1-$2-$3-$4-$5');
  x.spActive=[{id:'sp-linked-time',title:'Child A',
    projectId:'INBOX_PROJECT',notes:'alf-notion-page-id:'+dashed,
    isDone:false,subTaskIds:[],timeSpent:spMs}];
  const f=fixture(x),page=row(child,'Child A',['مهمة'],small);
  page.properties['الوقت الفعلي'].number=notionActual;
  f.api.getSecret=async k=>k==='alf-auto-graph-local-enabled-v1'?
    'enabled':null;
  let patches=0;
  f.api.request=async(uri,opts)=>{
    f.events.push(['notion',uri,opts.method,opts.body]);
    if(uri.endsWith('/pages/'+child) && opts.method==='GET')return page;
    if(uri.endsWith('/pages/'+child) && opts.method==='PATCH'){
      patches++;
      page.properties['الوقت الفعلي'].number=
        opts.body.properties['actualProp-id'].number;
      return {...page};
    }
    throw new Error('Unexpected tracked-time endpoint');
  };
  const plan={links:{tasks:new Map([[child,'sp-linked-time']])}};
  return {f,x,page,plan,get patches(){return patches;}};
}
test('automatic time sync writes real SP seconds into original Notion actual hours, idempotently',async()=>{
  const x=trackedTimeFixture({spMs:90000});
  const first=await run('alfGraphSyncTrackedTime',x.f.api,x.x,x.plan,
    {minPushGapMs:0});
  assert.equal(first.anchored,1);
  assert.equal(first.written,1);
  assert.equal(x.page.properties['الوقت الفعلي'].number,0.025);
  assert.equal(x.patches,1);
  const repeated=await run('alfGraphSyncTrackedTime',x.f.api,x.x,x.plan,
    {minPushGapMs:0});
  assert.equal(repeated.written,0);
  assert.equal(repeated.unchanged,1);
  assert.equal(x.patches,1);
  x.x.spActive[0].timeSpent=180000;
  x.f.tasks[0].timeSpent=180000;
  const next=await run('alfGraphSyncTrackedTime',x.f.api,x.x,x.plan,
    {minPushGapMs:0});
  assert.equal(next.written,1);
  assert.equal(x.page.properties['الوقت الفعلي'].number,0.05);
  assert.equal(x.patches,2);
});
test('historical Notion actual time is preserved and new SP time is added as a delta',async()=>{
  const x=trackedTimeFixture({notionActual:2,spMs:1800000});
  const first=await run('alfGraphSyncTrackedTime',x.f.api,x.x,x.plan,
    {minPushGapMs:0});
  assert.equal(first.anchored,1);
  assert.equal(first.written,0);
  assert.equal(x.page.properties['الوقت الفعلي'].number,2);
  x.x.spActive[0].timeSpent+=300000;
  x.f.tasks[0].timeSpent+=300000;
  const next=await run('alfGraphSyncTrackedTime',x.f.api,x.x,x.plan,
    {minPushGapMs:0});
  assert.equal(next.written,1);
  assert.equal(x.page.properties['الوقت الفعلي'].number,2.083333);
});
test('manual Notion correction beats timer increments; no overwriting',async()=>{
  const x=trackedTimeFixture({spMs:90000});
  await run('alfGraphSyncTrackedTime',x.f.api,x.x,x.plan,
    {minPushGapMs:0});
  x.page.properties['الوقت الفعلي'].number=8;
  x.x.spActive[0].timeSpent=180000;
  x.f.tasks[0].timeSpent=180000;
  const result=await run('alfGraphSyncTrackedTime',x.f.api,x.x,x.plan,
    {minPushGapMs:0});
  assert.equal(result.conflicts,1);
  assert.equal(result.written,0);
  assert.equal(x.page.properties['الوقت الفعلي'].number,8);
  assert.equal(x.patches,1);
});
test('unknown Notion tracked-time PATCH outcome never causes a blind second time update',async()=>{
  const x=trackedTimeFixture({spMs:90000});
  const request=x.f.api.request;
  x.f.api.request=async(uri,opts)=>{
    const reply=await request(uri,opts);
    if(opts.method==='PATCH')throw new Error('Notion replied after connection dropped');
    return reply;
  };
  const first=await run('alfGraphSyncTrackedTime',x.f.api,x.x,x.plan,
    {minPushGapMs:0});
  assert.equal(first.errors,1);
  assert.equal(x.patches,1);
  assert.equal(x.page.properties['الوقت الفعلي'].number,0.025);
  const again=await run('alfGraphSyncTrackedTime',x.f.api,x.x,x.plan,
    {minPushGapMs:0});
  assert.equal(again.conflicts,1);
  assert.equal(again.written,0);
  assert.equal(x.patches,1,'a lost response cannot double-count work time');
});
test('older scoped time writer takes precedence over graph automatic time',async()=>{
  const x=trackedTimeFixture({spMs:90000});
  x.f.api.getSecret=async k=>k==='alf-auto-time-local-enabled-v1'?
    'enabled':k==='alf-auto-graph-local-enabled-v1'?'enabled':null;
  const result=await run('alfGraphSyncTrackedTime',x.f.api,x.x,x.plan);
  assert.equal(result.legacyOwner,true);
  assert.equal(result.written,0);
  assert.equal(x.patches,0);
});
test('automatic graph refuses enabled-but-unbaselined state with no data mutation',async()=>{
  const x=sample();const f=fixture(x);
  f.api.getSecret=async k=>k==='alf-auto-graph-local-enabled-v1'?'enabled':null;
  f.api.setSecret=async()=>{};
  const res=await run('alfCreateAutoGraphSync',f.api,
    {inventory:async()=>x}).runOnce();
  assert.equal(res.enabled,true);
  assert.equal(res.errors,1);
  assert.equal(f.events.length,0);
});
test('independent same-title SP and Notion tasks in one project are conflicts, not duplicates',async()=>{
  const x=sample();
  x.spProjects=[{id:'sp-existing',title:'Verified small project'}];
  x.spActive=[{id:'sp-unlinked',title:'Bundle A',
    projectId:'sp-existing',notes:'',isDone:false,subTaskIds:[]}];
  const f=fixture(x);
  const p=await run('alfGraphPlan',f.api,x);
  assert.equal(p.tasks.some(t=>t.id===bundle),false);
  assert.equal(p.exportsTasks.some(t=>t.spId==='sp-unlinked'),false);
  assert.ok(p.skipped.conflicts>=2);
});
function pomodoroJournalFixture(){
  const x=sample();
  x.tasks=[x.tasks[1]];
  const dashed=child.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    '$1-$2-$3-$4-$5');
  x.spActive=[{id:'linked-sp-task',title:'Child A',projectId:'some-project',
    notes:'Personal note\nalf-notion-page-id:'+dashed,
    isDone:false,subTaskIds:[]}];
  const f=fixture(x);
  const session={schemaVersion:1,sessionId:'pomo-session-1',
    taskId:'linked-sp-task',mode:'Pomodoro',
    automatic:true,manual:false,observedCompletion:true,
    verifiedCompletedPomodoro:true,source:'live-sp-action-hook',
    startedAt:1763500000000,endedAt:1763501500000};
  f.saved.set('alf-focus-observed-v1-'+session.sessionId,JSON.stringify(session));
  f.api.listSyncedDataKeys=async prefix=>[...f.saved.keys()].filter(
    key=>key.startsWith(prefix));
  const plan={links:{tasks:new Map([[child,'linked-sp-task']])}};
  const remoteBlocks=[];
  f.api.request=async(uri,opts)=>{
    f.events.push(['notion',uri,opts.method,opts.body]);
    if(uri.endsWith('/pages/'+child)&&opts.method==='GET')
      return row(child,'Child A',['مهمة'],small,bundle);
    if(uri.includes('/blocks/'+child+'/children')&&opts.method==='GET')
      return {object:'list',results:remoteBlocks,has_more:false,next_cursor:null};
    if(uri.endsWith('/blocks/'+child+'/children')&&opts.method==='PATCH'){
      const sent=opts.body.children[0];
      const line=sent.paragraph.rich_text[0].text.content;
      const block={object:'block',type:'paragraph',
        paragraph:{rich_text:[{type:'text',plain_text:line}]}};
      remoteBlocks.push(block);
      return {object:'list',results:[block],has_more:false};
    }
    throw new Error('Unexpected Notion Pomodoro test endpoint');
  };
  return {x,f,session,plan,remoteBlocks};
}
test('verified completed focus session appends once to existing Notion page without editing task content',async()=>{
  const o=pomodoroJournalFixture();
  const first=await run('alfGraphApplyPomodoro',o.f.api,o.x,o.plan);
  assert.equal(first.written,1);
  assert.equal(first.linked,1);
  const writes=o.f.events.filter(e=>e[0]==='notion'&&e[2]==='PATCH');
  assert.equal(writes.length,1);
  assert.equal(writes[0][1].endsWith('/blocks/'+child+'/children'),true);
  const body=writes[0][3];
  assert.equal(body.children.length,1);
  assert.equal(body.children[0].type,'paragraph');
  assert.match(body.children[0].paragraph.rich_text[0].text.content,
    /ALF-POMODORO-SESSION-V1:pomo-session-1/);
  assert.equal(o.f.events.some(e=>e[1]?.includes('/pages/')&&e[2]==='PATCH'),false);
  const again=await run('alfGraphApplyPomodoro',o.f.api,o.x,o.plan);
  assert.equal(again.written,0);
  assert.equal(again.alreadyPresent,1);
  assert.equal(o.f.events.filter(e=>e[0]==='notion'&&e[2]==='PATCH').length,1);
});
test('unknown Notion block append outcome is journalled before request and never retried',async()=>{
  const o=pomodoroJournalFixture();
  const request=o.f.api.request;
  let attempts=0;
  o.f.api.request=async(uri,opts)=>{
    if(uri.includes('/blocks/')&&opts.method==='PATCH'){
      attempts++;
      throw new Error('network lost after Notion may have appended');
    }
    return request(uri,opts);
  };
  const first=await run('alfGraphApplyPomodoro',o.f.api,o.x,o.plan);
  assert.equal(first.written,0);
  assert.equal(first.pending,1);
  const intent=JSON.parse(o.f.saved.get('alf-pomo-block-v1-pomo-session-1'));
  assert.equal(intent.status,'attempted');
  const again=await run('alfGraphApplyPomodoro',o.f.api,o.x,o.plan);
  assert.equal(again.written,0);
  assert.equal(again.pending,1);
  assert.equal(attempts,1);
});
test('a remotely existing Pomodoro marker is reconciled without duplicate append',async()=>{
  const o=pomodoroJournalFixture();
  o.remoteBlocks.push({object:'block',type:'paragraph',
    paragraph:{rich_text:[{plain_text:
      '✅ Existing completed session | ALF-POMODORO-SESSION-V1:pomo-session-1'}]}});
  const result=await run('alfGraphApplyPomodoro',o.f.api,o.x,o.plan);
  assert.equal(result.alreadyPresent,1);
  assert.equal(result.written,0);
  assert.equal(o.f.events.filter(e=>e[0]==='notion'&&e[2]==='PATCH').length,0);
  const entry=JSON.parse(o.f.saved.get('alf-pomo-block-v1-pomo-session-1'));
  assert.equal(entry.status,'committed');
});
test('manual, unverified or unlinked focus completions can never create Notion page blocks',async()=>{
  const o=pomodoroJournalFixture();
  o.f.saved.set('alf-focus-observed-v1-pomo-session-1',
    JSON.stringify({...o.session,manual:true}));
  const bad=await run('alfGraphApplyPomodoro',o.f.api,o.x,o.plan);
  assert.equal(bad.written,0);
  assert.equal(o.f.events.filter(e=>e[0]==='notion').length,0);
  o.f.saved.set('alf-focus-observed-v1-pomo-session-1',
    JSON.stringify({...o.session,manual:false,taskId:'wrong-task'}));
  const unlinked=await run('alfGraphApplyPomodoro',o.f.api,o.x,o.plan);
  assert.equal(unlinked.written,0);
  assert.equal(o.f.events.filter(e=>e[0]==='notion').length,0);
});
