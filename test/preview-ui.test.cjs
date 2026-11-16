'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const host = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');

function mount(customRows, habitRows) {
  const els = new Map();
  const requests = [];
  const stores = [];
  const secretWrites = [];
  const stored = new Map();
  const imports = [];
  const updates = [];
  const existingTasks = [{id:'sp1',title:'Existing SP task'}];
  let secret = null;
  let logicalDay='2026-11-16';
  function element(id) {
    if (!els.has(id)) {
      els.set(id, {
        id, value: '', textContent: '', hidden: false, disabled: false,
        style: {}, children: [], events: {}, checked:false,
        setAttribute(name,value) { this[name] = value; },
        addEventListener(name, fn) { this.events[name] = fn; },
        replaceChildren() { this.children = []; },
        appendChild(child) { this.children.push(child); return child; }
      });
    }
    return els.get(id);
  }
  const habitSchema = {
    'العادة': {type:'title'},
    'التكرار': {type:'select'}
  };
  const habitId='212b4a624b7d8050a6aa000b01b292b8';
  const counters = {
    a:{id:'a',title:'Read 20m',type:'ClickCounter',isEnabled:true,countOnDay:{'2026-11-16':3}},
    b:{id:'b',title:'Practice',type:'StopWatch',isEnabled:true,countOnDay:{'2026-11-16':600000}}
  };
  const schema = {
    'المصدر': { type: 'title' },
    'نوع الصفحة': { type: 'multi_select' },
    'يوم التنفيذ': { type: 'date' },
    'الوقت المخطط له': { type: 'number' },
    'Status': { type: 'status' },
    'الحزمة الأب': { type: 'relation' },
    'Priority': { type: 'select' },
    'الوقت الفعلي': { type: 'number' },
    'قاعدة العادات': {type:'relation'},
    'Habit Count': {type:'number'}
  };
  const api = {
    onReady(fn) { fn(); },
    async getSecret() { return secret; },
    async setSecret(k,v) {secretWrites.push([k,v]); secret=v;},
    async deleteSecret() {secret=null;},
    async loadSyncedData(k) {return stored.get(k) || null;},
    async listSyncedDataKeys(prefix) {return [...stored.keys()].filter(k=>k.startsWith(prefix));},
    async persistDataSynced(v,k) { stores.push({data:v,key:k}); stored.set(k,v); },
    async getTasks() { return existingTasks; },
    async getArchivedTasks() { return []; },
    async getAllProjects() {return [{id:'projectX',title:'Sandbox Project'}];},
    async getAppState(){return {simpleCounters:counters};},
    async getDayContext(){return {todayStr:logicalDay,startOfNextDayDiffMs:0};},
    async addTask(task) {
      imports.push(task);
      const id='created'+imports.length;
      existingTasks.push({id, ...task});
      return id;
    },
    async updateTask(id,fields) {updates.push({id,fields});},
    async request(url, opts) {
      requests.push({url,opts});
      assert.equal(new URL(url).host, 'api.notion.com');
      assert.ok(opts.headers['Notion-Version']);
      if (opts.method==='GET' && url.includes('/data_sources/'))
        return {properties:url.endsWith(habitId)?habitSchema:schema};
      if (opts.method==='GET' && url.includes('/pages/')) {
        const id=url.split('/').pop();
        const page=(customRows||[]).find(p=>p.id===id);
        if (!page) throw new Error('Mock Notion page missing');
        return {...page,parent:{type:'data_source_id',data_source_id:'212b4a624b7d806989b9000b73ac11c8'}};
      }
      if (opts.method==='PATCH') {
        assert.ok(url.includes('/pages/'),'Writeback can update existing pages only');
        const id=url.split('/').pop();
        const page=(customRows||[]).find(p=>p.id===id);
        if (!page) throw new Error('Mock Notion page missing');
        const entries=Object.entries(opts.body.properties||{});
        assert.equal(entries.length,1,'Writeback must update only one property');
        const [idOrName,field]=entries[0];
        const name=Object.keys(page.properties).find(n=>n===idOrName ||
          (page.properties[n] && page.properties[n].id===idOrName));
        assert.ok(name==='الوقت الفعلي'||name==='Habit Count'||name==='Actual Time',
          'Patch only an approved existing numeric field or its stable ID');
        assert.ok(typeof field.number==='number');
        page.properties[name]={...page.properties[name],type:'number',number:field.number};
        return page;
      }
      if (opts.method==='POST' && url.endsWith(habitId+'/query'))
        return {results:habitRows||[],has_more:false,next_cursor:null};
      if (opts.method==='POST') return {results: customRows || [
        {object:'page',id:'n1',properties:{
          'المصدر':{title:[{plain_text:'Sample task'}]},
          'نوع الصفحة':{type:'multi_select',multi_select:[{name:'مهمة'}]},
          'يوم التنفيذ':{date:{start:'2026-11-16'}},
          'الوقت المخطط له':{number:2},
          'Status':{status:{name:'Not started'}}
        }},
        {object:'page',id:'n2',properties:{
          'المصدر':{title:[{plain_text:'Excluded knowledge'}]},
          'نوع الصفحة':{type:'multi_select',multi_select:[{name:'تعلم'}]}
        }}
      ],has_more:false,next_cursor:null};
      throw new Error('Unexpected method');
    }
  };
  const document = {
    getElementById:element,
    querySelectorAll(selector) {
      if (selector==='.rowSelector')
        return element('results').children.flatMap(
          row=>row.children.flatMap(cell=>cell.children||[])
        ).filter(child=>child.className==='rowSelector');
      if (selector==='.habitCounterSelect')
        return element('habitRows').children.flatMap(
          row=>row.children.flatMap(cell=>cell.children||[])
        ).filter(child=>child.className==='habitCounterSelect');
      throw new Error('Unexpected selector '+selector);
    },
    createElement(tag) {
      return {tag, textContent:'',children:[],checked:false,dataset:{},
        setAttribute(name,value){this[name]=value;},
        appendChild(x){this.children.push(x);return x;}};
    }
  };
  const script = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(script, 'inline plugin code exists');
  new vm.Script(script[1], {filename:'alf-preview-inline.js'}).runInNewContext({
    PluginAPI:api,window:{PluginAPI:api},document,setTimeout,
    URL,console
  });
  return {els:element,requests,stores,secretWrites,api,imports,updates,existingTasks,
    habitId,counters,schema,habitSchema,setLogicalDay(day){logicalDay=day;}};
}

function configure(env) {
  env.els('taskSource').value='212b4a624b7d806989b9000b73ac11c8';
  env.els('titleProp').value='المصدر';
  env.els('typeProp').value='نوع الصفحة';
  env.els('typeValues').value='مهمة, حزمة';
  env.els('executionProp').value='يوم التنفيذ';
  env.els('estimateProp').value='الوقت المخطط له';
  env.els('statusProp').value='Status';
  env.els('unit').value='hours';
}

test('manifest declares only Notion HTTP host and per-device secret API', () => {
  assert.ok(manifest.permissions.includes('http'));
  assert.deepEqual(manifest.allowedHosts, ['api.notion.com']);
  assert.ok(manifest.permissions.includes('getSecret'));
  assert.ok(manifest.permissions.includes('setSecret'));
  assert.equal(manifest.id, 'alf-notion-super-productivity');
  assert.ok(host.includes('PluginAPI.Hooks.ACTION'), 'live focus events use host API');
  assert.ok(host.includes('PluginAPI.Hooks.CURRENT_TASK_CHANGE'), 'task identity hook enabled');
  assert.ok(!host.includes('PluginAPI.request('), 'host background code never calls Notion API');
  assert.ok(!host.includes('updateTask('), 'no SP writes');
  assert.ok(!host.includes('fetch('), 'no unguarded network calls');
});

test('saves token to local secret, never to synced plugin data', async () => {
  const env = mount();
  await new Promise(resolve => setImmediate(resolve));
  configure(env);
  env.els('token').value='ntn_TEST_PRIVATE_TOKEN';
  await env.els('save').events.click();
  assert.equal(env.secretWrites.length,1);
  assert.equal(env.secretWrites[0][1],'ntn_TEST_PRIVATE_TOKEN');
  assert.equal(env.stores.length,1);
  assert.equal(env.stores[0].key,'alf-mapping-v2');
  assert.ok(!env.stores[0].data.includes('ntn_TEST_PRIVATE_TOKEN'));
  assert.equal(env.els('token').value,'');
});

test('preview queries only Notion data source, filters knowledge and never writes', async () => {
  const env=mount();
  await new Promise(resolve => setImmediate(resolve));
  configure(env);
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('previewBtn').events.click();
  assert.equal(env.requests.length,2);
  assert.equal(env.requests[0].opts.method,'GET');
  assert.equal(env.requests[1].opts.method,'POST');
  assert.equal(env.els('results').children.length,1);
  assert.equal(env.els('results').children[0].children[1].textContent,'Sample task');
  assert.match(env.els('summary').textContent,/2 Notion pages/);
  assert.match(env.els('summary').textContent,/1 matched/);
  assert.match(env.els('summary').textContent,/Local SP active tasks: 1/);
});

test('preview refuses missing allowlist to avoid importing unrelated pages', async () => {
  const env=mount();
  await new Promise(resolve => setImmediate(resolve));
  configure(env);
  env.els('typeValues').value='';
  await env.els('previewBtn').events.click();
  assert.equal(env.requests.length,0);
  assert.match(env.els('notice').textContent,/item type/);
});

test('disconnect forgets local token but keeps synced mapping', async () => {
  const env=mount();
  await new Promise(resolve => setImmediate(resolve));
  configure(env);
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('disconnect').events.click();
  assert.equal(await env.api.getSecret(),null);
  assert.equal(env.stores.length,1);
});


test('manual task import requires explicit authorization and a destination project', async () => {
  const env=mount();
  await new Promise(resolve => setImmediate(resolve));
  configure(env);
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('previewBtn').events.click();
  env.els('results').children[0].children[0].children[0].checked=true;
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,0);
  assert.match(env.els('notice').textContent,/authorization/);
  env.els('authorizeImport').checked=true;
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,0);
  assert.match(env.els('notice').textContent,/project/);
});

test('manual import creates only checked task, with time and due day; repeated import is idempotent', async () => {
  const env=mount();
  await new Promise(resolve => setImmediate(resolve));
  configure(env);
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('previewBtn').events.click();
  env.els('targetSpProject').value='projectX';
  env.els('authorizeImport').checked=true;
  env.els('results').children[0].children[0].children[0].checked=true;
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,1);
  assert.equal(env.imports[0].title,'Sample task');
  assert.equal(env.imports[0].timeEstimate,7200000);
  assert.equal(env.imports[0].dueDay,'2026-11-16');
  assert.equal(env.imports[0].projectId,'projectX');
  assert.equal(env.imports[0].isIgnoreShortSyntax,true);
  assert.match(env.imports[0].notes,/alf-notion-page-id:n1/);
  assert.ok(env.stores.some(s=>s.key==='alf-page-link-n1'));
  // Explicit authorization required on every call, including repeat imports.
  env.els('authorizeImport').checked=true;
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,1);
  assert.match(env.els('importReport').textContent,/skipped 1/);
  assert.equal(env.requests.length,2,'No Notion write or additional network request');
});

test('bundle is created as parent task before dependent subtask, never as a folder', async () => {
  const rows=[
    {object:'page',id:'child',properties:{
      'المصدر':{title:[{plain_text:'Subtask'}]},
      'نوع الصفحة':{type:'multi_select',multi_select:[{name:'مهمة'}]},
      'الحزمة الأب':{relation:[{id:'bundle'}]}
    }},
    {object:'page',id:'bundle',properties:{
      'المصدر':{title:[{plain_text:'Bundle parent'}]},
      'نوع الصفحة':{type:'multi_select',multi_select:[{name:'حزمة'}]}
    }}
  ];
  const env=mount(rows);
  await new Promise(resolve => setImmediate(resolve));
  configure(env);
  env.els('parentProp').value='الحزمة الأب';
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('previewBtn').events.click();
  env.els('targetSpProject').value='projectX';
  env.els('authorizeImport').checked=true;
  env.els('results').children.forEach(row=>{row.children[0].children[0].checked=true;});
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,2);
  assert.equal(env.imports[0].title,'Bundle parent');
  assert.equal(env.imports[1].title,'Subtask');
  assert.equal(env.imports[1].parentId,'created1');
  assert.ok(!('parentId' in env.imports[0]));
  assert.match(env.els('importReport').textContent,/Created 2/);
});

test('subtask whose parent bundle is absent must not be detached', async () => {
  const rows=[{object:'page',id:'child',properties:{
    'المصدر':{title:[{plain_text:'Subtask'}]},
    'نوع الصفحة':{type:'multi_select',multi_select:[{name:'مهمة'}]},
    'الحزمة الأب':{relation:[{id:'missing-bundle'}]}
  }}];
  const env=mount(rows);
  await new Promise(resolve => setImmediate(resolve));
  configure(env);
  env.els('parentProp').value='الحزمة الأب';
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('previewBtn').events.click();
  env.els('targetSpProject').value='projectX';
  env.els('authorizeImport').checked=true;
  env.els('results').children[0].children[0].children[0].checked=true;
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,0);
  assert.match(env.els('importReport').textContent,/import its parent bundle first/);
});

test('changing mapping after preview blocks the import until re-previewed', async () => {
  const env=mount();
  await new Promise(resolve => setImmediate(resolve));
  configure(env);
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('previewBtn').events.click();
  env.els('targetSpProject').value='projectX';
  env.els('authorizeImport').checked=true;
  env.els('results').children[0].children[0].children[0].checked=true;
  env.els('unit').value='minutes';
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,0);
  assert.match(env.els('notice').textContent,/Refresh read-only preview/);
});


test('import maps configured Done status and priority safely', async () => {
  const rows=[{object:'page',id:'done-task',properties:{
    'المصدر':{title:[{plain_text:'Finished test'}]},
    'نوع الصفحة':{type:'multi_select',multi_select:[{name:'مهمة'}]},
    'Status':{status:{name:'Done'}},
    'Priority':{type:'select',select:{name:'High'}}
  }}];
  const env=mount(rows);
  await new Promise(resolve=>setImmediate(resolve));
  configure(env);
  env.els('completedValues').value='Done, Completed';
  env.els('priorityProp').value='Priority';
  env.els('priorityHigh').value='High';
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('previewBtn').events.click();
  env.els('targetSpProject').value='projectX';
  env.els('authorizeImport').checked=true;
  env.els('results').children[0].children[0].children[0].checked=true;
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,1);
  assert.equal(env.imports[0].isDone,true);
  assert.equal(env.updates.length,1);
  assert.equal(env.updates[0].fields.priority,3);
});


function actualTestPage() {
  return {object:'page',id:'tracked-item',properties:{
    'المصدر':{type:'title',title:[{plain_text:'Tracked task'}]},
    'نوع الصفحة':{type:'multi_select',multi_select:[{name:'مهمة'}]},
    'الوقت الفعلي':{type:'number',number:0.5},
    'Status':{status:{name:'In progress'}}
  }};
}

async function setupActual(env) {
  await new Promise(resolve=>setImmediate(resolve));
  configure(env);
  env.els('actualProp').value='الوقت الفعلي';
  env.els('token').value='ntn_TEST_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('previewBtn').events.click();
  env.els('targetSpProject').value='projectX';
  env.els('authorizeImport').checked=true;
  env.els('results').children[0].children[0].children[0].checked=true;
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,1);
  const task=env.existingTasks.find(t=>t.id==='created1');
  task.timeSpent=5400000;
  return task;
}

test('actual time review makes no Notion writes until separate authorization',async()=>{
  const rows=[actualTestPage()];
  const env=mount(rows);
  await setupActual(env);
  await env.els('planTimeBtn').events.click();
  assert.match(env.els('timePlan').textContent,/0.5 → 1.5 hours/);
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  await env.els('pushTimeBtn').events.click();
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  assert.match(env.els('notice').textContent,/authorize Notion time writes/);
});

test('actual work time is written only to mapped Number property of correct page',async()=>{
  const rows=[actualTestPage()];
  const env=mount(rows);
  await setupActual(env);
  await env.els('planTimeBtn').events.click();
  env.els('authorizeTime').checked=true;
  await env.els('pushTimeBtn').events.click();
  const patch=env.requests.filter(r=>r.opts.method==='PATCH');
  assert.equal(patch.length,1);
  assert.deepEqual(Object.keys(patch[0].opts.body.properties),['الوقت الفعلي']);
  assert.equal(patch[0].opts.body.properties['الوقت الفعلي'].number,1.5);
  assert.equal(rows[0].properties['الوقت الفعلي'].number,1.5);
  assert.match(env.els('timeReport').textContent,/written to 1/);
  assert.equal(env.els('authorizeTime').checked,false);
});

test('Notion time changed after preview produces conflict, never overwrites correction',async()=>{
  const rows=[actualTestPage()];
  const env=mount(rows);
  await setupActual(env);
  await env.els('planTimeBtn').events.click();
  rows[0].properties['الوقت الفعلي'].number=0.75;
  env.els('authorizeTime').checked=true;
  await env.els('pushTimeBtn').events.click();
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  assert.match(env.els('timeReport').textContent,/changed since preview/);
});

test('time changed in SP after preview forces restaging rather than stale write',async()=>{
  const rows=[actualTestPage()];
  const env=mount(rows);
  const task=await setupActual(env);
  await env.els('planTimeBtn').events.click();
  task.timeSpent=7200000;
  env.els('authorizeTime').checked=true;
  await env.els('pushTimeBtn').events.click();
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  assert.match(env.els('timeReport').textContent,/SP tracking changed/);
});

test('parent task rollup is excluded from actual-time writeback',async()=>{
  const rows=[actualTestPage()];
  const env=mount(rows);
  const task=await setupActual(env);
  task.subTaskIds=['child1'];
  await env.els('planTimeBtn').events.click();
  assert.match(env.els('timePlan').textContent,/0 eligible time updates/);
  env.els('authorizeTime').checked=true;
  await env.els('pushTimeBtn').events.click();
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
});


test('Notion habit definitions are previewed against existing SP counters with no writes',async()=>{
  const defs=[
    {object:'page',id:'habit-notion-1',properties:{
      'العادة':{type:'title',title:[{plain_text:'Read daily'}]},
      'التكرار':{type:'select',select:{name:'Daily'}}
    }},
    {object:'page',id:'habit-notion-2',properties:{
      'العادة':{type:'title',title:[{plain_text:'Workout'}]},
      'التكرار':{type:'select',select:{name:'Weekly'}}
    }}
  ];
  const env=mount(null,defs);
  await new Promise(resolve=>setImmediate(resolve));
  env.els('habitSource').value=env.habitId;
  env.els('habitTitleProp').value='العادة';
  env.els('habitCadenceProp').value='التكرار';
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('previewHabits').events.click();
  assert.equal(env.els('habitRows').children.length,2);
  assert.equal(env.els('habitRows').children[0].children[0].textContent,'Read daily');
  assert.match(env.els('habitReport').textContent,/2 existing Notion habit definitions/);
  assert.equal(env.stores.filter(x=>x.key.startsWith('alf-habit-definition-link-v1-')).length,0);
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
});

test('explicit habit mapping persists only the IDs and never creates a Notion occurrence',async()=>{
  const defs=[{object:'page',id:'habit-notion-1',properties:{
    'العادة':{type:'title',title:[{plain_text:'Read daily'}]}
  }}];
  const env=mount(null,defs);
  await new Promise(resolve=>setImmediate(resolve));
  env.els('habitSource').value=env.habitId;
  env.els('habitTitleProp').value='العادة';
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('previewHabits').events.click();
  const select=env.els('habitRows').children[0].children[2].children[0];
  select.value='a';
  await env.els('saveHabitMappings').events.click();
  const links=env.stores.filter(x=>x.key.startsWith('alf-habit-definition-link-v1-'));
  assert.equal(links.length,1);
  const parsed=JSON.parse(links[0].data);
  assert.equal(parsed.notionId,'habit-notion-1');
  assert.equal(parsed.spCounterId,'a');
  assert.equal(parsed.notionSourceId,env.habitId);
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
  assert.equal(env.imports.length,0);
});

test('habit mapping prevents one SP counter being linked twice in same preview',async()=>{
  const defs=['h1','h2'].map(id=>({object:'page',id,properties:{
    'العادة':{type:'title',title:[{plain_text:id}]}
  }}));
  const env=mount(null,defs);
  await new Promise(resolve=>setImmediate(resolve));
  env.els('habitSource').value=env.habitId;
  env.els('habitTitleProp').value='العادة';
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('previewHabits').events.click();
  env.els('habitRows').children.forEach(row=>{row.children[2].children[0].value='a';});
  await env.els('saveHabitMappings').events.click();
  assert.equal(env.stores.filter(x=>x.key.startsWith('alf-habit-definition-link-v1-')).length,0);
  assert.match(env.els('notice').textContent,/multiple Notion/);
});


function habitOccurrence(habitId='habit-original-1',id='habit-occ-1',value=1) {
  return {object:'page',id,properties:{
    'المصدر':{type:'title',title:[{plain_text:'Today habit entry'}]},
    'نوع الصفحة':{type:'multi_select',multi_select:[{name:'عادة'}]},
    'قاعدة العادات':{type:'relation',relation:[{id:habitId}]},
    'يوم التنفيذ':{type:'date',date:{start:'2026-11-16'}},
    'Habit Count':{type:'number',number:value}
  }};
}
async function setupHabitDay(env,habitId='habit-original-1') {
  await new Promise(resolve=>setImmediate(resolve));
  configure(env);
  env.els('habitSource').value=env.habitId;
  env.els('habitOccTypeProp').value='نوع الصفحة';
  env.els('habitOccTypeValue').value='عادة';
  env.els('habitOccRelationProp').value='قاعدة العادات';
  env.els('habitOccDayProp').value='يوم التنفيذ';
  env.els('habitOccCountProp').value='Habit Count';
  env.els('habitOccUnit').value='count';
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.api.persistDataSynced(JSON.stringify({
    version:1,notionId:habitId,spCounterId:'a',notionSourceId:env.habitId
  }), 'alf-habit-definition-link-v1-'+habitId);
}

test('habit-day preview uses SP logical day and does not write',async()=>{
  const rows=[habitOccurrence()];
  const env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  assert.match(env.els('habitDayPlan').textContent,/Logical day: 2026-11-16/);
  assert.match(env.els('habitDayPlan').textContent,/1 → 3 count/);
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
});

test('habit-day write requires independent explicit confirmation and patches only existing Number',async()=>{
  const rows=[habitOccurrence()];
  const env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  await env.els('pushHabitDay').events.click();
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  env.els('authorizeHabitDay').checked=true;
  await env.els('pushHabitDay').events.click();
  const patch=env.requests.filter(r=>r.opts.method==='PATCH');
  assert.equal(patch.length,1);
  assert.deepEqual(Object.keys(patch[0].opts.body.properties),['Habit Count']);
  assert.equal(patch[0].opts.body.properties['Habit Count'].number,3);
  assert.equal(rows[0].properties['Habit Count'].number,3);
  assert.equal(env.els('authorizeHabitDay').checked,false);
});

test('habit-day conflict protects Notion manual correction after staging',async()=>{
  const rows=[habitOccurrence()];
  const env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  rows[0].properties['Habit Count'].number=2;
  env.els('authorizeHabitDay').checked=true;
  await env.els('pushHabitDay').events.click();
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  assert.match(env.els('habitDayReport').textContent,/count changed since preview/);
});

test('duplicate Notion habit/day occurrence rows are skipped rather than randomly updated',async()=>{
  const rows=[habitOccurrence(),habitOccurrence('habit-original-1','habit-occ-2')];
  const env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  assert.match(env.els('habitDayPlan').textContent,/0 eligible existing occurrence updates/);
  env.els('authorizeHabitDay').checked=true;
  await env.els('pushHabitDay').events.click();
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
});

test('SP logical day rollover between preview and write blocks all writes',async()=>{
  const rows=[habitOccurrence()];
  const env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  env.setLogicalDay('2026-11-17');
  env.els('authorizeHabitDay').checked=true;
  await env.els('pushHabitDay').events.click();
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  assert.match(env.els('notice').textContent,/logical day changed/);
});

test('StopWatch requires explicit minutes/hours and never writes raw ms as count',async()=>{
  const rows=[habitOccurrence()];
  const env=mount(rows);
  await setupHabitDay(env);
  // Modify existing mapping to stopwatch counter b.
  await env.api.persistDataSynced(JSON.stringify({
    version:1,notionId:'habit-original-1',spCounterId:'b',notionSourceId:env.habitId
  }), 'alf-habit-definition-link-v1-habit-original-1');
  env.els('habitOccUnit').value='minutes';
  await env.els('previewHabitDay').events.click();
  assert.match(env.els('habitDayPlan').textContent,/1 → 10 minutes/);
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
});


test('pin task field IDs then rename Notion property labels without losing preview/import/time writeback',async()=>{
  const rows=[{object:'page',id:'rename1',properties:{
    'المصدر':{type:'title',title:[{plain_text:'Original task'}]},
    'نوع الصفحة':{type:'multi_select',multi_select:[{name:'مهمة'}]},
    'يوم التنفيذ':{type:'date',date:{start:'2026-11-16'}},
    'الوقت المخطط له':{type:'number',number:2},
    'الوقت الفعلي':{type:'number',number:0},
    'Status':{type:'status',status:{name:'In progress'}}
  }}];
  const env=mount(rows);
  await new Promise(resolve=>setImmediate(resolve));
  configure(env);
  env.els('actualProp').value='الوقت الفعلي';
  for(const [name,p] of Object.entries(env.schema))
    p.id='stable-'+Object.keys(env.schema).indexOf(name);
  for(const [name,p] of Object.entries(rows[0].properties))
    p.id=env.schema[name].id;
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('pinProps').events.click();
  assert.match(env.els('notice').textContent,/Pinned 6 stable/);
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
  assert.equal(env.requests.filter(x=>x.opts.method==='POST').length,0);
  const pinned=JSON.parse(env.stores.at(-1).data);
  assert.equal(pinned.taskPropertyBindings.titleProp.input,'المصدر');
  assert.equal(pinned.taskPropertyBindings.titleProp.id,env.schema['المصدر'].id);
  assert.equal(pinned.taskPropertyBindings.actualProp.id,env.schema['الوقت الفعلي'].id);
  assert.ok(!env.stores.some(x=>x.data.includes('ntn_FAKE_PRIVATE_TOKEN')));

  // Rename several existing properties, keeping their Notion IDs intact.
  for(const [from,to] of [
    ['المصدر','Title'],['نوع الصفحة','Item Type'],
    ['يوم التنفيذ','Execution Day'],['الوقت المخطط له','Planned Time'],
    ['الوقت الفعلي','Actual Time']
  ]) {
    env.schema[to]=env.schema[from];delete env.schema[from];
    rows[0].properties[to]=rows[0].properties[from];delete rows[0].properties[from];
  }
  // Even reusing an old property name must not hijack its pinned stable ID.
  env.schema['المصدر']={type:'title',id:'different-title-id'};
  rows[0].properties['المصدر']={type:'title',id:'different-title-id',
    title:[{plain_text:'Wrong task'}]};
  await env.els('previewBtn').events.click();
  assert.equal(env.els('results').children.length,1);
  assert.equal(env.els('results').children[0].children[1].textContent,'Original task');

  // The selected original Notion page should still generate the correct task.
  env.els('targetSpProject').value='projectX';
  env.els('authorizeImport').checked=true;
  env.els('results').children[0].children[0].children[0].checked=true;
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,1);
  assert.equal(env.imports[0].title,'Original task');
  assert.equal(env.imports[0].timeEstimate,7200000);

  // Time writeback uses the *property ID* and never creates a new field.
  env.existingTasks.at(-1).timeSpent=3600000;
  await env.els('planTimeBtn').events.click();
  assert.match(env.els('timePlan').textContent,/1 eligible time updates/);
  env.els('authorizeTime').checked=true;
  await env.els('pushTimeBtn').events.click();
  const writes=env.requests.filter(x=>x.opts.method==='PATCH');
  assert.equal(writes.length,1);
  assert.deepEqual(Object.keys(writes[0].opts.body.properties),
    [env.schema['Actual Time'].id]);
  assert.equal(rows[0].properties['Actual Time'].number,1);
});

test('removed pinned property ID fails closed instead of silently mapping to same-name property',async()=>{
  const env=mount();
  await new Promise(resolve=>setImmediate(resolve));
  configure(env);
  for(const [name,p] of Object.entries(env.schema))
    p.id='field-'+Object.keys(env.schema).indexOf(name);
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('pinProps').events.click();
  // Notion page schema replaces the old field with a new one of identical name.
  env.schema['المصدر']={type:'title',id:'different-title-id'};
  await env.els('previewBtn').events.click();
  assert.match(env.els('notice').textContent,/Fix mapping/);
  assert.equal(env.requests.filter(x=>x.opts.method==='POST').length,0);
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
});

test('Pomodoro plan derives target from existing Notion estimate, never from completed sessions',async()=>{
  const env=mount();
  await new Promise(resolve=>setImmediate(resolve));
  configure(env);
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('previewBtn').events.click();
  assert.equal(env.els('pomodoroWorkMinutes').value,'25');
  assert.equal(env.els('results').children[0].children[8].textContent,'5');
  assert.match(env.els('results').children[0].children[9].textContent,/compare after linking/);
  assert.ok(!env.requests.some(x=>x.opts.method==='PATCH'));
  env.els('pomodoroWorkMinutes').value='50';
  await env.els('previewBtn').events.click();
  assert.equal(env.els('results').children[0].children[8].textContent,'3');
  assert.match(env.els('summary').textContent,/Work interval: 50m/);
});

test('invalid Pomodoro work interval refuses preview before any Notion query',async()=>{
  const env=mount();
  await new Promise(resolve=>setImmediate(resolve));
  configure(env);
  env.els('pomodoroWorkMinutes').value='0';
  await env.els('previewBtn').events.click();
  assert.match(env.els('notice').textContent,/Pomodoro work interval/);
  assert.equal(env.requests.length,0);
});

test('verified observed sessions compare to linked Notion plan without fabricating history or writing',async()=>{
  const env=mount();
  await new Promise(resolve=>setImmediate(resolve));
  configure(env);
  env.els('token').value='ntn_FAKE_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('previewBtn').events.click();
  env.els('targetSpProject').value='projectX';
  env.els('authorizeImport').checked=true;
  env.els('results').children[0].children[0].children[0].checked=true;
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,1);
  const spTaskId=env.existingTasks.at(-1).id;
  const obs=[
    {sessionId:'p1',taskId:spTaskId,mode:'Pomodoro',
      observedCompletion:true,automatic:true,verifiedCompletedPomodoro:true},
    {sessionId:'p2',taskId:spTaskId,mode:'Pomodoro',
      observedCompletion:true,automatic:false,verifiedCompletedPomodoro:false},
    {sessionId:'f1',taskId:spTaskId,mode:'Flowtime',
      observedCompletion:true,automatic:false,verifiedCompletedPomodoro:false},
    {sessionId:'c1',taskId:spTaskId,mode:'Countdown',
      observedCompletion:true,automatic:false,verifiedCompletedPomodoro:false}
  ];
  for(const row of obs) await env.api.persistDataSynced(
    JSON.stringify({schemaVersion:1,...row}), 'alf-focus-observed-v1-'+row.sessionId);
  await env.els('loadSessions').events.click();
  const cells=env.els('results').children[0].children;
  assert.equal(cells[8].textContent,'5','the plan remains defined by Notion estimate');
  assert.match(cells[9].textContent,/1 P · 1 F · 1 C observed/);
  assert.match(cells[9].textContent,/history incomplete/);
  assert.match(env.els('focusReport').textContent,/Verified automatically completed Pomodoros: 1/);
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0,
    'reading focus observations must never write to Notion');
});
