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
  const secrets = new Map();
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
    'Habit Count': {type:'number'},
    'Observed Pomodoros (partial)': {type:'number',id:'obs-pomo-id'}
  };
  const api = {
    onReady(fn) { fn(); },
    async getSecret(k) { return secrets.get(k) || null; },
    async setSecret(k,v) {secretWrites.push([k,v]); secrets.set(k,v);},
    async deleteSecret(k) {secrets.delete(k);},
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
    async updateTask(id,fields,options) {
      updates.push({id,fields,options});
      const task=existingTasks.find(t=>t.id===id);
      if(!task)throw new Error('SP task not found');
      Object.assign(task,fields);
    },
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
        assert.ok(name==='الوقت الفعلي'||name==='Habit Count'||name==='Actual Time'||
          name==='Observed Pomodoros (partial)'||name==='Daily Count',
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
    sampleRows:customRows||[],habitRows:habitRows||[],habitId,counters,schema,habitSchema,
    setLogicalDay(day){logicalDay=day;}};
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
  assert.ok(host.includes('alfCreateAutoPlanSync('), 'auto planning is separately opt-in');
  assert.ok(host.includes("ALF_AUTO_PLAN_FLAG"), 'local-only enable flag exists');
  assert.ok(host.includes("method:'GET'"), 'background Notion access is read-only');
  assert.ok(!host.includes("method:'PATCH'"), 'background never PATCHes Notion');
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
  // Notion schema and page properties have stable IDs (Notion's official API).
  for(const [name,prop] of Object.entries(env.schema))
    prop.id=prop.id||'board-field-'+Object.keys(env.schema).indexOf(name);
  for(const row of env.sampleRows)
    for(const [name,prop] of Object.entries(row.properties))
      if(env.schema[name])prop.id=env.schema[name].id;
  await env.els('pinHabitProps').events.click();
  assert.match(env.els('notice').textContent,/Pinned 4 existing habit field IDs/);
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
  assert.deepEqual(Object.keys(patch[0].opts.body.properties),[env.schema['Habit Count'].id]);
  assert.equal(patch[0].opts.body.properties[env.schema['Habit Count'].id].number,3);
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

function observedTestPage() {
  return {object:'page',id:'pomotask-1',properties:{
    'المصدر':{type:'title',title:[{plain_text:'Observed work'}]},
    'نوع الصفحة':{type:'multi_select',multi_select:[{name:'مهمة'}]},
    'الوقت المخطط له':{type:'number',number:2},
    'Observed Pomodoros (partial)':{type:'number',number:0},
    'Status':{type:'status',status:{name:'In progress'}}
  }};
}
async function setupObserved(env,rows) {
  await new Promise(resolve=>setImmediate(resolve));
  configure(env);
  env.els('observedPomoProp').value='Observed Pomodoros (partial)';
  for(const [name,p] of Object.entries(env.schema))
    p.id=p.id||'test-stable-'+Object.keys(env.schema).indexOf(name);
  for(const [name,p] of Object.entries(rows[0].properties))
    p.id=env.schema[name].id;
  env.els('token').value='ntn_TEST_PRIVATE_TOKEN';
  await env.els('save').events.click();
  await env.els('pinProps').events.click();
  assert.match(env.els('notice').textContent,/Pinned 6 stable/);
  await env.els('previewBtn').events.click();
  assert.equal(env.els('results').children.length,1);
  env.els('targetSpProject').value='projectX';
  env.els('authorizeImport').checked=true;
  env.els('results').children[0].children[0].children[0].checked=true;
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,1);
  return env.existingTasks.at(-1).id;
}
async function addObservedSession(env,spId,suffix,overrides={}) {
  const record={schemaVersion:1,sessionId:suffix,taskId:spId,
    source:'live-sp-action-hook',mode:'Pomodoro',observedCompletion:true,
    automatic:true,manual:false,verifiedCompletedPomodoro:true,
    startedAt:100000,endedAt:1600000,...overrides};
  await env.api.persistDataSynced(JSON.stringify(record),
    'alf-focus-observed-v1-'+suffix);
}
test('observed Pomodoro writeback is a reviewed opt-in and only writes pinned existing Number field',async()=>{
  const rows=[observedTestPage()],env=mount(rows);
  const spId=await setupObserved(env,rows);
  await addObservedSession(env,spId,'p1');
  await addObservedSession(env,spId,'p1'); // same session ID replay: one count
  await addObservedSession(env,spId,'p2');
  await addObservedSession(env,spId,'manual',{automatic:false,manual:true,
    verifiedCompletedPomodoro:false});
  await addObservedSession(env,spId,'flow',{mode:'Flowtime',
    verifiedCompletedPomodoro:false});
  await env.els('previewObservedPomoBtn').events.click();
  assert.match(env.els('observedPomoPlan').textContent,/0 → 2 unique observed automatic Pomodoros/);
  assert.match(env.els('observedPomoPlan').textContent,/PARTIAL OBSERVER MINIMUM/);
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
  await env.els('pushObservedPomoBtn').events.click();
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
  assert.match(env.els('notice').textContent,/Explicitly authorize/);
  env.els('authorizeObservedPomo').checked=true;
  await env.els('pushObservedPomoBtn').events.click();
  const writes=env.requests.filter(x=>x.opts.method==='PATCH');
  assert.equal(writes.length,1);
  assert.deepEqual(Object.keys(writes[0].opts.body.properties),
    [env.schema['Observed Pomodoros (partial)'].id]);
  assert.equal(writes[0].opts.body.properties[env.schema['Observed Pomodoros (partial)'].id].number,2);
  assert.equal(rows[0].properties['Observed Pomodoros (partial)'].number,2);
  assert.equal(env.els('authorizeObservedPomo').checked,false);
  await env.els('pushObservedPomoBtn').events.click(); // cannot replay
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,1);
  // Re-preview does not reduce a higher existing observed minimum.
  await env.els('previewObservedPomoBtn').events.click();
  assert.match(env.els('observedPomoPlan').textContent,/0 reviewed, monotonic updates/);
});

test('observer ledger changes after staging refuse stale Pomodoro writeback',async()=>{
  const rows=[observedTestPage()],env=mount(rows);
  const spId=await setupObserved(env,rows);
  await addObservedSession(env,spId,'p1');
  await env.els('previewObservedPomoBtn').events.click();
  await addObservedSession(env,spId,'p2');
  env.els('authorizeObservedPomo').checked=true;
  await env.els('pushObservedPomoBtn').events.click();
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
  assert.match(env.els('observedPomoReport').textContent,/Observer ledger changed/);
});

test('Notion manual higher count after staging is never overwritten by incomplete observer',async()=>{
  const rows=[observedTestPage()],env=mount(rows);
  const spId=await setupObserved(env,rows);
  await addObservedSession(env,spId,'p1');
  await env.els('previewObservedPomoBtn').events.click();
  rows[0].properties['Observed Pomodoros (partial)'].number=8;
  env.els('authorizeObservedPomo').checked=true;
  await env.els('pushObservedPomoBtn').events.click();
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
  assert.equal(rows[0].properties['Observed Pomodoros (partial)'].number,8);
  assert.match(env.els('observedPomoReport').textContent,/Notion count changed/);
});

test('unknown Pomodoro observations cannot be treated as zero and never write',async()=>{
  const rows=[observedTestPage()],env=mount(rows);
  await setupObserved(env,rows);
  await env.els('previewObservedPomoBtn').events.click();
  assert.match(env.els('observedPomoPlan').textContent,/No verified observer records/);
  env.els('authorizeObservedPomo').checked=true;
  await env.els('pushObservedPomoBtn').events.click();
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
});

test('truncated observer key inventory refuses writeback staging',async()=>{
  const rows=[observedTestPage()],env=mount(rows);
  await setupObserved(env,rows);
  env.api.listSyncedDataKeys=async()=>Array(2001).fill('alf-focus-observed-v1-foo');
  await env.els('previewObservedPomoBtn').events.click();
  assert.match(env.els('notice').textContent,/More than 2000 observer keys/);
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
});

test('deleting pinned observer Number property prevents any write',async()=>{
  const rows=[observedTestPage()],env=mount(rows);
  const spId=await setupObserved(env,rows);
  await addObservedSession(env,spId,'p1');
  await env.els('previewObservedPomoBtn').events.click();
  env.schema['Observed Pomodoros (partial)']={type:'number',id:'new-replacement-id'};
  env.els('authorizeObservedPomo').checked=true;
  await env.els('pushObservedPomoBtn').events.click();
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
  assert.match(env.els('notice').textContent,/Notion source or pinned property changed/);
});


function planningTestPage() {
  return {object:'page',id:'plan-n1',properties:{
    'المصدر':{type:'title',title:[{plain_text:'Original task plan'}]},
    'نوع الصفحة':{type:'multi_select',multi_select:[{name:'مهمة'}]},
    'يوم التنفيذ':{type:'date',date:{start:'2026-11-16'}},
    'الوقت المخطط له':{type:'number',number:1},
    'Status':{type:'status',status:{name:'In progress'}}
  }};
}
async function setupPlanRefresh(env,rows) {
  await new Promise(resolve=>setImmediate(resolve));
  configure(env);
  env.els('token').value='ntn_FAKE_PLAN_TOKEN';
  await env.els('save').events.click();
  await env.els('previewBtn').events.click();
  env.els('targetSpProject').value='projectX';
  env.els('authorizeImport').checked=true;
  env.els('results').children[0].children[0].children[0].checked=true;
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,1);
  const task=env.existingTasks.at(-1);
  task.timeSpent=42*60000;
  rows[0].properties['المصدر'].title=[{plain_text:'Notion updated plan #tag'}];
  rows[0].properties['الوقت المخطط له'].number=2;
  rows[0].properties['يوم التنفيذ'].date={start:'2026-11-17'};
  await env.els('previewBtn').events.click();
  env.els('results').children[0].children[0].children[0].checked=true;
  return task;
}
test('Notion plan refresh stages title, estimate and due day, then needs separate consent',async()=>{
  const rows=[planningTestPage()],env=mount(rows);
  const task=await setupPlanRefresh(env,rows);
  await env.els('stagePlanBtn').events.click();
  assert.match(env.els('planRefreshDiff').textContent,/1 linked SP task planning updates/);
  assert.match(env.els('planRefreshDiff').textContent,/title/);
  assert.match(env.els('planRefreshDiff').textContent,/timeEstimate/);
  assert.match(env.els('planRefreshDiff').textContent,/dueDay/);
  assert.equal(env.updates.length,0);
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  await env.els('commitPlanBtn').events.click();
  assert.equal(env.updates.length,0);
  assert.match(env.els('notice').textContent,/Explicitly authorize/);
  env.els('authorizePlanRefresh').checked=true;
  await env.els('commitPlanBtn').events.click();
  assert.equal(env.updates.length,1);
  assert.equal(env.updates[0].options.isIgnoreShortSyntax,true);
  assert.deepEqual(Object.keys(env.updates[0].fields).sort(),
    ['title','timeEstimate','dueDay'].sort());
  assert.equal(task.title,'Notion updated plan #tag');
  assert.equal(task.timeEstimate,7200000);
  assert.equal(task.dueDay,'2026-11-17');
  assert.equal(task.timeSpent,42*60000,'execution actual time is not overwritten');
  assert.equal(task.isDone,false,'SP execution status remains SP-owned');
  assert.equal(task.projectId,'projectX');
  assert.equal(task.notes,'alf-notion-page-id:plan-n1');
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  assert.equal(env.els('authorizePlanRefresh').checked,false);
  await env.els('commitPlanBtn').events.click();
  assert.equal(env.updates.length,1,'no replays without restaging');
  await env.els('stagePlanBtn').events.click();
  assert.match(env.els('planRefreshDiff').textContent,/0 linked SP task planning updates/);
});

test('Notion changes after staging block SP changes',async()=>{
  const rows=[planningTestPage()],env=mount(rows);
  await setupPlanRefresh(env,rows);
  await env.els('stagePlanBtn').events.click();
  rows[0].properties['الوقت المخطط له'].number=3;
  env.els('authorizePlanRefresh').checked=true;
  await env.els('commitPlanBtn').events.click();
  assert.equal(env.updates.length,0);
  assert.match(env.els('planRefreshReport').textContent,/Notion plan changed after review/);
});
test('SP local title edits after staging are preserved and conflict is reported',async()=>{
  const rows=[planningTestPage()],env=mount(rows);
  const task=await setupPlanRefresh(env,rows);
  await env.els('stagePlanBtn').events.click();
  task.title='Local offline edit';
  env.els('authorizePlanRefresh').checked=true;
  await env.els('commitPlanBtn').events.click();
  assert.equal(env.updates.length,0);
  assert.equal(task.title,'Local offline edit');
  assert.match(env.els('planRefreshReport').textContent,/SP field edited after review/);
});
test('Notion blank estimated time and empty due date do not clear SP planning fields',async()=>{
  const rows=[planningTestPage()],env=mount(rows);
  const task=await setupPlanRefresh(env,rows);
  rows[0].properties['الوقت المخطط له'].number=null;
  rows[0].properties['يوم التنفيذ'].date=null;
  task.title='Notion updated plan #tag';
  await env.els('previewBtn').events.click();
  env.els('results').children[0].children[0].children[0].checked=true;
  await env.els('stagePlanBtn').events.click();
  assert.match(env.els('planRefreshDiff').textContent,/0 linked SP task planning updates/);
  assert.equal(task.timeEstimate,3600000);
  assert.equal(task.dueDay,'2026-11-16');
  assert.equal(env.updates.length,0);
});
test('completed and recurring SP tasks never get Notion planning updates',async()=>{
  const rows=[planningTestPage()],env=mount(rows);
  const task=await setupPlanRefresh(env,rows);
  task.isDone=true;
  await env.els('stagePlanBtn').events.click();
  assert.match(env.els('planRefreshDiff').textContent,/0 linked SP task planning updates/);
  task.isDone=false;task.repeatCfgId='repeat-1';
  await env.els('stagePlanBtn').events.click();
  assert.match(env.els('planRefreshDiff').textContent,/0 linked SP task planning updates/);
  assert.equal(env.updates.length,0);
});
test('Notion timed execution date updates SP timestamp and clears obsolete date-only field',async()=>{
  const rows=[planningTestPage()],env=mount(rows);
  const task=await setupPlanRefresh(env,rows);
  rows[0].properties['يوم التنفيذ'].date={start:'2026-11-17T17:30:00+02:00'};
  await env.els('previewBtn').events.click();
  env.els('results').children[0].children[0].children[0].checked=true;
  await env.els('stagePlanBtn').events.click();
  env.els('authorizePlanRefresh').checked=true;
  await env.els('commitPlanBtn').events.click();
  assert.equal(env.updates.length,1);
  assert.equal(task.dueDay,null);
  assert.equal(task.dueWithTime,Date.parse('2026-11-17T15:30:00Z'));
});
test('subtask identity changes after staging block Notion plan writeback to wrong SP task',async()=>{
  const rows=[planningTestPage()],env=mount(rows);
  const task=await setupPlanRefresh(env,rows);
  await env.els('stagePlanBtn').events.click();
  task.parentId='new-parent-task';
  env.els('authorizePlanRefresh').checked=true;
  await env.els('commitPlanBtn').events.click();
  assert.equal(env.updates.length,0);
  assert.match(env.els('planRefreshReport').textContent,/Task identity\/status changed/);
});
test('changed mapping or selected tasks require restaging Notion plan refresh',async()=>{
  const rows=[planningTestPage()],env=mount(rows);
  await setupPlanRefresh(env,rows);
  await env.els('stagePlanBtn').events.click();
  env.els('unit').value='minutes';
  env.els('authorizePlanRefresh').checked=true;
  await env.els('commitPlanBtn').events.click();
  assert.equal(env.updates.length,0);
  assert.match(env.els('notice').textContent,/Notion mapping changed/);
});


test('Notion habit definitions survive English property renames with stable pins',async()=>{
  const defs=[{object:'page',id:'habit-renamed-1',properties:{
    'العادة':{type:'title',title:[{plain_text:'Real habit'}]},
    'التكرار':{type:'select',select:{name:'Daily'}}
  }}],env=mount(null,defs);
  await new Promise(resolve=>setImmediate(resolve));
  env.els('habitSource').value=env.habitId;
  env.els('habitTitleProp').value='العادة';
  env.els('habitCadenceProp').value='التكرار';
  env.els('token').value='ntn_FAKE_SECRET_TOKEN';
  for(const [name,p] of Object.entries(env.habitSchema)) p.id='habit-property-'+name;
  for(const row of defs)for(const [name,p] of Object.entries(row.properties))
    p.id=env.habitSchema[name].id;
  await env.els('save').events.click();
  await env.els('pinHabitProps').events.click();
  assert.match(env.els('notice').textContent,/Pinned 2 existing habit field IDs/);
  for(const [from,to] of [['العادة','Habit Title'],['التكرار','Frequency']]){
    env.habitSchema[to]=env.habitSchema[from];delete env.habitSchema[from];
    defs[0].properties[to]=defs[0].properties[from];delete defs[0].properties[from];
  }
  // An unrelated new same-name field must not replace an existing pinned ID.
  env.habitSchema['العادة']={id:'new-title-id',type:'title'};
  defs[0].properties['العادة']={id:'new-title-id',type:'title',
    title:[{plain_text:'Wrong habit'}]};
  await env.els('previewHabits').events.click();
  assert.equal(env.els('habitRows').children.length,1);
  assert.equal(env.els('habitRows').children[0].children[0].textContent,'Real habit');
  assert.equal(env.els('habitRows').children[0].children[1].textContent,'Daily');
  env.els('habitRows').children[0].children[2].children[0].value='a';
  await env.els('saveHabitMappings').events.click();
  assert.equal(env.stores.filter(x=>x.key==='alf-habit-definition-link-v1-habit-renamed-1').length,1);
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
});

test('renamed habit occurrence type, day, relation, and Number retain the exact PATCH target',async()=>{
  const rows=[habitOccurrence()],env=mount(rows);
  await setupHabitDay(env);
  const renamed=[
    ['نوع الصفحة','Item Type'],
    ['يوم التنفيذ','Work Day'],
    ['قاعدة العادات','Habit Definition'],
    ['Habit Count','Daily Count']
  ];
  for(const [from,to] of renamed) {
    env.schema[to]=env.schema[from];delete env.schema[from];
    rows[0].properties[to]=rows[0].properties[from];delete rows[0].properties[from];
  }
  // Reusing the old label must never redirect to an unrelated Number property.
  env.schema['Habit Count']={id:'replacement-count-id',type:'number'};
  rows[0].properties['Habit Count']={id:'replacement-count-id',type:'number',number:40};
  await env.els('previewHabitDay').events.click();
  assert.match(env.els('habitDayPlan').textContent,/1 → 3 count/);
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  const q=env.requests.find(r=>r.opts.method==='POST' && r.opts.body.filter);
  assert.equal(q.opts.body.filter.and[0].property,env.schema['Item Type'].id);
  assert.equal(q.opts.body.filter.and[1].property,env.schema['Work Day'].id);
  env.els('authorizeHabitDay').checked=true;
  await env.els('pushHabitDay').events.click();
  const writes=env.requests.filter(r=>r.opts.method==='PATCH');
  assert.equal(writes.length,1);
  assert.deepEqual(Object.keys(writes[0].opts.body.properties),[env.schema['Daily Count'].id]);
  assert.equal(rows[0].properties['Daily Count'].number,3);
  assert.equal(rows[0].properties['Habit Count'].number,40);
});

test('replaced pinned habit-day count field fails closed even if old label returns',async()=>{
  const rows=[habitOccurrence()],env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  env.schema['Habit Count']={type:'number',id:'replacement-counter-field'};
  env.els('authorizeHabitDay').checked=true;
  await env.els('pushHabitDay').events.click();
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  assert.match(env.els('notice').textContent,/Missing or incompatible existing Notion occurrence property/);
});

test('changing mapped habit field after pin refuses stale writeback until repinned',async()=>{
  const rows=[habitOccurrence()],env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  env.els('habitOccCountProp').value='Habit Count 2';
  env.els('authorizeHabitDay').checked=true;
  await env.els('pushHabitDay').events.click();
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  assert.match(env.els('notice').textContent,/Habit mapping changed/);
});

test('mutated SP habit-to-counter ID link since preview refuses habit-day write',async()=>{
  const rows=[habitOccurrence()],env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  await env.api.persistDataSynced(JSON.stringify({
    version:1,notionId:'habit-original-1',spCounterId:'b',notionSourceId:env.habitId
  }),'alf-habit-definition-link-v1-habit-original-1');
  env.els('authorizeHabitDay').checked=true;
  await env.els('pushHabitDay').events.click();
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  assert.match(env.els('habitDayReport').textContent,/Habit counter link changed since preview/);
});

test('habit-day writeback refuses unpinned property mapping without Notion writes',async()=>{
  const rows=[habitOccurrence()],env=mount(rows);
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
  await env.els('previewHabitDay').events.click();
  assert.match(env.els('notice').textContent,/Pin stable occurrence property IDs/);
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
});


test('habit-day writeback skips duplicate occurrence created after preview',async()=>{
  const rows=[habitOccurrence()],env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  assert.match(env.els('habitDayPlan').textContent,/1 eligible existing occurrence updates/);
  // A second device creates the same habit/day occurrence between review and PATCH.
  const late=habitOccurrence('habit-original-1','late-duplicate',0);
  for(const [name,prop] of Object.entries(late.properties))
    if(env.schema[name]) prop.id=env.schema[name].id;
  rows.push(late);
  env.els('authorizeHabitDay').checked=true;
  await env.els('pushHabitDay').events.click();
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  assert.equal(rows[0].properties['Habit Count'].number,1);
  assert.equal(rows[1].properties['Habit Count'].number,0);
  assert.match(env.els('habitDayReport').textContent,/occurrence added\/removed\/duplicated since preview/);
  assert.equal(env.requests.filter(r=>r.opts.method==='POST').length,2,
    'commit must query current full day inventory, not trust preview cache');
});

test('habit-day writeback skips an occurrence removed since preview',async()=>{
  const rows=[habitOccurrence()],env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  rows.splice(0,1); // the Notion row no longer belongs to the queried day/source
  env.els('authorizeHabitDay').checked=true;
  await env.els('pushHabitDay').events.click();
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  assert.match(env.els('habitDayReport').textContent,/occurrence added\/removed\/duplicated since preview/);
});

test('different habit added after preview does not block unrelated reviewed daily count',async()=>{
  const rows=[habitOccurrence()],env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  const unrelated=habitOccurrence('another-habit','another-occurrence',9);
  for(const [name,prop] of Object.entries(unrelated.properties))
    if(env.schema[name]) prop.id=env.schema[name].id;
  rows.push(unrelated);
  env.els('authorizeHabitDay').checked=true;
  await env.els('pushHabitDay').events.click();
  const writes=env.requests.filter(r=>r.opts.method==='PATCH');
  assert.equal(writes.length,1);
  assert.equal(rows[0].properties['Habit Count'].number,3);
  assert.equal(rows[1].properties['Habit Count'].number,9);
});


function autoPlanPage() {
  return {object:'page',id:'aab4a62b4b7d806989b9000b73ac11c8',properties:{
    'المصدر':{type:'title',title:[{plain_text:'Known linked task'}]},
    'نوع الصفحة':{type:'multi_select',multi_select:[{name:'مهمة'}]},
    'الوقت المخطط له':{type:'number',number:1},
    'يوم التنفيذ':{type:'date',date:{start:'2026-11-16'}}
  }};
}
async function setupAutoPlan(env,rows) {
  await new Promise(resolve=>setImmediate(resolve));
  configure(env);
  for(const [name,p] of Object.entries(env.schema))
    p.id=p.id||'stable-auto-'+Object.keys(env.schema).indexOf(name);
  for(const [name,p] of Object.entries(rows[0].properties))
    p.id=env.schema[name].id;
  env.els('token').value='ntn_AUTO_TEST_SECRET';
  await env.els('save').events.click();
  await env.els('pinProps').events.click();
  await env.els('previewBtn').events.click();
  assert.equal(env.els('results').children.length,1);
  env.els('targetSpProject').value='projectX';
  env.els('authorizeImport').checked=true;
  env.els('results').children[0].children[0].children[0].checked=true;
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,1);
  return env.existingTasks.at(-1);
}
test('automatic Notion plan seeding requires independent consent and never mutates SP or Notion',async()=>{
  const rows=[autoPlanPage()],env=mount(rows);
  const task=await setupAutoPlan(env,rows);
  await env.els('seedAutoPlanBtn').events.click();
  assert.match(env.els('notice').textContent,/Explicitly authorize preparing/);
  assert.equal(env.updates.length,0);
  env.els('authorizeAutoSeed').checked=true;
  await env.els('seedAutoPlanBtn').events.click();
  assert.match(env.els('autoSeedReport').textContent,/1 matching linked task baselines prepared/);
  assert.equal(env.updates.length,0);
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  const anchor=JSON.parse(env.stores.find(x=>x.key==='alf-plan-anchor-v1-'+rows[0].id).data);
  assert.equal(anchor.spId,task.id);
  assert.equal(anchor.expected.timeEstimate,3600000);
  assert.equal(anchor.expected.dueDay,'2026-11-16');
  assert.equal(anchor.expected.title,'Known linked task');
  assert.ok(!env.stores.some(x=>x.data.includes('ntn_AUTO_TEST_SECRET')));
});
test('automatic plan flag is local per device, off by default, and requires explicit consent',async()=>{
  const rows=[autoPlanPage()],env=mount(rows);
  await setupAutoPlan(env,rows);
  await env.els('enableAutoPlanBtn').events.click();
  assert.match(env.els('notice').textContent,/Explicitly authorize automatic/);
  assert.equal(await env.api.getSecret('alf-auto-plan-local-enabled-v1'),null);
  env.els('authorizeAutoLocal').checked=true;
  await env.els('enableAutoPlanBtn').events.click();
  assert.match(env.els('notice').textContent,/Prepare at least one matching/);
  assert.equal(await env.api.getSecret('alf-auto-plan-local-enabled-v1'),null);
  env.els('authorizeAutoSeed').checked=true;
  await env.els('seedAutoPlanBtn').events.click();
  env.els('authorizeAutoLocal').checked=true;
  await env.els('enableAutoPlanBtn').events.click();
  assert.equal(await env.api.getSecret('alf-auto-plan-local-enabled-v1'),'enabled');
  assert.equal(await env.api.getSecret('alf-notion-token'),'ntn_AUTO_TEST_SECRET');
  assert.ok(!env.stores.some(x=>x.data.includes('alf-auto-plan-local-enabled-v1')));
  await env.els('disableAutoPlanBtn').events.click();
  assert.equal(await env.api.getSecret('alf-auto-plan-local-enabled-v1'),null);
  assert.equal(await env.api.getSecret('alf-notion-token'),'ntn_AUTO_TEST_SECRET');
});
test('automatic baselines skip divergent local SP work plans rather than force them',async()=>{
  const rows=[autoPlanPage()],env=mount(rows);
  const task=await setupAutoPlan(env,rows);
  task.title='Offline edited title';
  env.els('authorizeAutoSeed').checked=true;
  await env.els('seedAutoPlanBtn').events.click();
  assert.match(env.els('autoSeedReport').textContent,/0 matching linked task baselines/);
  assert.match(env.els('autoSeedReport').textContent,/Notion and SP plans differ/);
  assert.equal(env.stores.filter(x=>x.key.startsWith('alf-plan-anchor-v1-')).length,0);
  assert.equal(task.title,'Offline edited title');
});
test('automatic baselines refuse changed Notion source or allowed task type',async()=>{
  const rows=[autoPlanPage()],env=mount(rows);
  await setupAutoPlan(env,rows);
  rows[0].properties['نوع الصفحة'].multi_select=[{name:'تعلم'}];
  env.els('authorizeAutoSeed').checked=true;
  await env.els('seedAutoPlanBtn').events.click();
  assert.match(env.els('autoSeedReport').textContent,/0 matching linked task baselines/);
  assert.equal(env.stores.filter(x=>x.key.startsWith('alf-plan-anchor-v1-')).length,0);
});

function autoTimeExamplePage() {
  return {object:'page',id:'work-time-n1',properties:{
    'المصدر':{type:'title',title:[{plain_text:'Tracked test task'}]},
    'نوع الصفحة':{type:'multi_select',multi_select:[{name:'مهمة'}]},
    'الوقت الفعلي':{type:'number',number:2},
    'الوقت المخطط له':{type:'number',number:1}
  }};
}
async function setupAutoTimeUi(env,rows) {
  await new Promise(resolve=>setImmediate(resolve));
  configure(env);
  env.els('actualProp').value='الوقت الفعلي';
  for(const [name,p] of Object.entries(env.schema))
    p.id=p.id||'stable-work-'+Object.keys(env.schema).indexOf(name);
  for(const [name,p] of Object.entries(rows[0].properties))p.id=env.schema[name].id;
  env.els('token').value='ntn_TEST_TIME_TOKEN';
  await env.els('save').events.click();
  await env.els('pinProps').events.click();
  await env.els('previewBtn').events.click();
  env.els('targetSpProject').value='projectX';
  env.els('authorizeImport').checked=true;
  env.els('results').children[0].children[0].children[0].checked=true;
  await env.els('importBtn').events.click();
  const task=env.existingTasks.at(-1);
  task.timeSpent=7200000;
  await env.els('previewBtn').events.click();
  env.els('results').children[0].children[0].children[0].checked=true;
  return task;
}
test('opt-in work-time export prepares linked exact-matching Number baseline only',async()=>{
  const rows=[autoTimeExamplePage()],env=mount(rows);
  const task=await setupAutoTimeUi(env,rows);
  await env.els('seedAutoTimeBtn').events.click();
  assert.match(env.els('notice').textContent,/Explicitly authorize/);
  assert.equal(env.stores.filter(x=>x.key.startsWith('alf-time-anchor-v1-')).length,0);
  env.els('authorizeAutoTimeSeed').checked=true;
  await env.els('seedAutoTimeBtn').events.click();
  assert.match(env.els('autoTimeSeedReport').textContent,/1 matching time baselines prepared/);
  const result=env.stores.filter(x=>x.key.startsWith('alf-time-anchor-v1-'));
  assert.equal(result.length,1);
  const anchor=JSON.parse(result[0].data);
  assert.equal(anchor.notionId,rows[0].id);
  assert.equal(anchor.spId,task.id);
  assert.equal(anchor.expectedSpMs,7200000);
  assert.equal(anchor.expectedNotion,2);
  assert.equal(JSON.parse(anchor.spec).actualId,env.schema['الوقت الفعلي'].id);
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
});
test('work-time export cannot enable without local consent and at least one seeded match',async()=>{
  const rows=[autoTimeExamplePage()],env=mount(rows);
  await setupAutoTimeUi(env,rows);
  await env.els('enableAutoTimeBtn').events.click();
  assert.match(env.els('notice').textContent,/Explicitly authorize ongoing/);
  assert.equal(await env.api.getSecret('alf-auto-time-local-enabled-v1'),null);
  env.els('authorizeAutoTimeLocal').checked=true;
  await env.els('enableAutoTimeBtn').events.click();
  assert.match(env.els('notice').textContent,/Prepare at least one reviewed/);
  env.els('authorizeAutoTimeSeed').checked=true;
  await env.els('seedAutoTimeBtn').events.click();
  env.els('authorizeAutoTimeLocal').checked=true;
  await env.els('enableAutoTimeBtn').events.click();
  assert.equal(await env.api.getSecret('alf-auto-time-local-enabled-v1'),'enabled');
  assert.equal(await env.api.getSecret('alf-notion-token'),'ntn_TEST_TIME_TOKEN');
  assert.equal(env.stores.filter(x=>x.key==='alf-auto-time-local-enabled-v1').length,0);
  await env.els('disableAutoTimeBtn').events.click();
  assert.equal(await env.api.getSecret('alf-auto-time-local-enabled-v1'),null);
});
test('mismatched or parent task SP tracked time never seeds an automated Notion export',async()=>{
  const rows=[autoTimeExamplePage()],env=mount(rows);
  const task=await setupAutoTimeUi(env,rows);
  task.timeSpent=3600000;
  env.els('authorizeAutoTimeSeed').checked=true;
  await env.els('seedAutoTimeBtn').events.click();
  assert.match(env.els('autoTimeSeedReport').textContent,/0 matching time baselines/);
  task.timeSpent=7200000;
  task.subTaskIds=['subtask'];
  env.els('authorizeAutoTimeSeed').checked=true;
  await env.els('seedAutoTimeBtn').events.click();
  assert.match(env.els('autoTimeSeedReport').textContent,/0 matching time baselines/);
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
});

test('automatic habit-day export requires separate consent and a current pinned preview',async()=>{
  const rows=[habitOccurrence('habit-original-1','habit-occ-1',0)],env=mount(rows);
  await setupHabitDay(env);
  await env.els('enableAutoHabitsBtn').events.click();
  assert.match(env.els('notice').textContent,/Explicitly authorize ongoing/);
  assert.equal(await env.api.getSecret('alf-auto-habit-local-enabled-v1'),null);
  env.els('authorizeAutoHabitsLocal').checked=true;
  await env.els('enableAutoHabitsBtn').events.click();
  assert.match(env.els('notice').textContent,/Preview current existing habit-day rows/);
  await env.els('previewHabitDay').events.click();
  env.els('authorizeAutoHabitsLocal').checked=true;
  await env.els('enableAutoHabitsBtn').events.click();
  assert.equal(await env.api.getSecret('alf-auto-habit-local-enabled-v1'),'enabled');
  const approvals=env.stores.filter(x=>x.key.startsWith('alf-habit-auto-allow-v1-'));
  assert.equal(approvals.length,1,'only explicitly reviewed habit definition approved');
  const permission=JSON.parse(approvals[0].data);
  assert.equal(permission.habitId,'habit-original-1');
  assert.equal(permission.counterId,'a');
  assert.equal(permission.sourceId,'212b4a624b7d806989b9000b73ac11c8');
  assert.equal(JSON.parse(permission.spec).unit,'count');
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0,
    'enabling automatic habits must not write to Notion');
  assert.equal(env.stores.filter(x=>x.key==='alf-auto-habit-local-enabled-v1').length,0,
    'enabled flag must never go to SuperSync');
  await env.els('disableAutoHabitsBtn').events.click();
  assert.equal(await env.api.getSecret('alf-auto-habit-local-enabled-v1'),null);
});

test('changing SP logical day after habit preview refuses enabling auto habit export',async()=>{
  const rows=[habitOccurrence('habit-original-1','habit-occ-1',0)],env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  env.setLogicalDay('2026-11-17');
  env.els('authorizeAutoHabitsLocal').checked=true;
  await env.els('enableAutoHabitsBtn').events.click();
  assert.equal(await env.api.getSecret('alf-auto-habit-local-enabled-v1'),null);
  assert.match(env.els('notice').textContent,/SP logical day changed/);
});

test('habit auto enable refuses changed mapping since reviewed habit-day page query',async()=>{
  const rows=[habitOccurrence()],env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  env.els('habitOccUnit').value='hours';
  env.els('authorizeAutoHabitsLocal').checked=true;
  await env.els('enableAutoHabitsBtn').events.click();
  assert.equal(await env.api.getSecret('alf-auto-habit-local-enabled-v1'),null);
  assert.match(env.els('notice').textContent,/Preview current existing habit-day rows/);
});


test('automatic synchronization diagnostics read only local flags and last run counters',async()=>{
  const env=mount();
  await new Promise(resolve=>setImmediate(resolve));
  await env.api.setSecret('alf-auto-plan-local-enabled-v1','enabled');
  await env.api.setSecret('alf-auto-status-local-v1-planning',JSON.stringify({
    version:1,checkedAt:Date.parse('2026-11-16T18:00:00Z'),
    outcome:'conflicts',counts:{processed:8,updated:2,conflicts:1,errors:0}
  }));
  await env.api.setSecret('alf-auto-status-local-v1-habits',JSON.stringify({
    version:1,checkedAt:Date.parse('2026-11-16T18:05:00Z'),
    outcome:'ok',counts:{processed:3,written:2,errors:0}
  }));
  await env.els('refreshAutoStatusBtn').events.click();
  const report=env.els('autoStatusReport').textContent;
  assert.match(report,/Planning \(Notion → SP\): ENABLED/);
  assert.match(report,/processed=8/);
  assert.match(report,/conflicts=1/);
  assert.match(report,/Actual time \(SP → Notion\): DISABLED/);
  assert.match(report,/Habits \(SP → Notion\): DISABLED/);
  assert.match(report,/written=2/);
  assert.equal(env.requests.length,0,'diagnostic UI never queries or PATCHes Notion');
  assert.equal(env.updates.length,0,'diagnostics never change SP tasks');
});


test('no reviewed safe habit definition means auto export remains disabled',async()=>{
  const rows=[habitOccurrence('habit-original-1','habit-occ-1',1)],env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  assert.match(env.els('habitDayPlan').textContent,/0 individually linked habits eligible/);
  env.els('authorizeAutoHabitsLocal').checked=true;
  await env.els('enableAutoHabitsBtn').events.click();
  assert.equal(await env.api.getSecret('alf-auto-habit-local-enabled-v1'),null);
  assert.match(env.els('notice').textContent,/No safe individually linked habits/);
  assert.equal(env.stores.filter(x=>x.key.startsWith('alf-habit-auto-allow-v1-')).length,0);
});
test('auto consent excludes duplicate and unrelated existing habit-day records',async()=>{
  const rows=[
    habitOccurrence('habit-original-1','habit-occ-1',0),
    habitOccurrence('unlinked-habit','unlinked-occ',0),
    habitOccurrence('unlinked-habit','unlinked-duplicate',0)
  ],env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  assert.match(env.els('habitDayPlan').textContent,/1 individually linked habits eligible/);
  env.els('authorizeAutoHabitsLocal').checked=true;
  await env.els('enableAutoHabitsBtn').events.click();
  assert.equal(await env.api.getSecret('alf-auto-habit-local-enabled-v1'),'enabled');
  const approved=env.stores.filter(x=>x.key.startsWith('alf-habit-auto-allow-v1-'));
  assert.equal(approved.length,1);
  assert.equal(JSON.parse(approved[0].data).habitId,'habit-original-1');
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
});
test('changed Notion occurrence after preview refuses automatic habit consent',async()=>{
  const rows=[habitOccurrence('habit-original-1','habit-occ-1',0)],env=mount(rows);
  await setupHabitDay(env);
  await env.els('previewHabitDay').events.click();
  rows[0].properties['Habit Count'].number=2;
  env.els('authorizeAutoHabitsLocal').checked=true;
  await env.els('enableAutoHabitsBtn').events.click();
  assert.equal(await env.api.getSecret('alf-auto-habit-local-enabled-v1'),null);
  assert.equal(env.stores.filter(x=>x.key.startsWith('alf-habit-auto-allow-v1-')).length,0);
  assert.match(env.els('notice').textContent,/Existing Notion habit count changed after preview/);
});


test('SP task-note prefix is never mistaken for the exact original Notion page marker',async()=>{
  const rows=[planningTestPage()],env=mount(rows);
  const task=await setupPlanRefresh(env,rows);
  task.notes='my notes alf-notion-page-id:'+rows[0].id+'-not-the-page';
  await env.els('stagePlanBtn').events.click();
  assert.match(env.els('planRefreshDiff').textContent,/0 linked SP task planning updates/);
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  assert.equal(env.updates.length,0);
});
test('a task marker without an independent saved ID link cannot authorize SP plan mutation',async()=>{
  const rows=[planningTestPage()],env=mount(rows);
  const task=await setupPlanRefresh(env,rows);
  const linkKey='alf-page-link-'+rows[0].id;
  await env.api.persistDataSynced('',linkKey);
  await env.els('stagePlanBtn').events.click();
  assert.match(env.els('planRefreshDiff').textContent,/0 linked SP task planning updates/);
  assert.equal(env.updates.length,0);
  // Explicit manual importer may reconcile that exact marker without
  // creating a second task, then future reviewed plans work normally.
  env.els('authorizeImport').checked=true;
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,1,'idempotent relink must not duplicate task');
  assert.equal(JSON.parse(await env.api.loadSyncedData(linkKey)).spId,task.id);
  await env.els('stagePlanBtn').events.click();
  assert.match(env.els('planRefreshDiff').textContent,/1 linked SP task planning updates/);
});


test('manual habit-day preview and writeback refuse missing pagination cursor',async()=>{
  const rows=[habitOccurrence('habit-original-1','habit-occ-1',0)],env=mount(rows);
  await setupHabitDay(env);
  const real=env.api.request;
  env.api.request=async(url,opts)=>{
    const data=await real(url,opts);
    if(opts.method==='POST'&&url.includes('/query'))
      return {...data,has_more:true,next_cursor:null};
    return data;
  };
  await env.els('previewHabitDay').events.click();
  assert.match(env.els('notice').textContent,/pagination cursor missing/);
  env.els('authorizeHabitDay').checked=true;
  await env.els('pushHabitDay').events.click();
  assert.equal(env.requests.filter(r=>r.opts.method==='PATCH').length,0);
  assert.equal(await env.api.getSecret('alf-auto-habit-local-enabled-v1'),null);
});


test('v0.23 plugin intro discloses three optional automations and never claims all syncing is manual',()=>{
  assert.ok(html.includes('EXPERIMENTAL · AUTO SYNC OFF BY DEFAULT'));
  assert.ok(html.includes('Three narrowly scoped automatic modes are available'));
  assert.ok(html.includes('disabled by default'));
  assert.ok(!html.includes('No automatic sync, database creation or SuperSync modification.'));
  assert.ok(html.includes('No Notion database, property or day-record creation'));
  assert.ok(html.includes('separate device-local opt-in'),
    'footer and intro both state narrowly scoped auto behavior');
  assert.equal(manifest.version,'0.23.0');
});


test('manual SP planning rejects one task claiming two different Notion pages',async()=>{
  const rows=[planningTestPage()],env=mount(rows);
  const task=await setupPlanRefresh(env,rows);
  task.notes+=' alf-notion-page-id:other-independent-page';
  await env.els('stagePlanBtn').events.click();
  assert.match(env.els('planRefreshDiff').textContent,/0 linked SP task planning updates/);
  assert.equal(env.updates.length,0);
  assert.equal(env.requests.filter(x=>x.opts.method==='PATCH').length,0);
});
test('manual importer refuses to adopt ambiguous multi-page task markers',async()=>{
  const rows=[planningTestPage()],env=mount(rows);
  const task=await setupPlanRefresh(env,rows);
  task.notes+=' alf-notion-page-id:another-page-id';
  const linkKey='alf-page-link-'+rows[0].id;
  await env.api.persistDataSynced('',linkKey);
  env.els('authorizeImport').checked=true;
  await env.els('importBtn').events.click();
  assert.equal(env.imports.length,1,'do not create a duplicate SP task');
  assert.equal(await env.api.loadSyncedData(linkKey),null,
    'ambiguous marker cannot be automatically relinked');
  assert.match(env.els('importReport').textContent,/multiple Notion pages/);
});
