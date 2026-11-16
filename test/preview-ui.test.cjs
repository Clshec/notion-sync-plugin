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

function mount(customRows) {
  const els = new Map();
  const requests = [];
  const stores = [];
  const secretWrites = [];
  const stored = new Map();
  const imports = [];
  const updates = [];
  const existingTasks = [{id:'sp1',title:'Existing SP task'}];
  let secret = null;
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
  const schema = {
    'المصدر': { type: 'title' },
    'نوع الصفحة': { type: 'multi_select' },
    'يوم التنفيذ': { type: 'date' },
    'الوقت المخطط له': { type: 'number' },
    'Status': { type: 'status' },
    'الحزمة الأب': { type: 'relation' }
  };
  const api = {
    onReady(fn) { fn(); },
    async getSecret() { return secret; },
    async setSecret(k,v) {secretWrites.push([k,v]); secret=v;},
    async deleteSecret() {secret=null;},
    async loadSyncedData(k) {return stored.get(k) || null;},
    async persistDataSynced(v,k) { stores.push({data:v,key:k}); stored.set(k,v); },
    async getTasks() { return existingTasks; },
    async getArchivedTasks() { return []; },
    async getAllProjects() {return [{id:'projectX',title:'Sandbox Project'}];},
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
      if (opts.method==='GET') return {properties:schema};
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
      if (selector!=='.rowSelector') throw new Error('Unexpected selector '+selector);
      return element('results').children.flatMap(
        row=>row.children.flatMap(cell=>cell.children||[])
      ).filter(child=>child.className==='rowSelector');
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
  return {els:element,requests,stores,secretWrites,api,imports,updates,existingTasks};
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
  assert.ok(!host.includes('registerHook('), 'no background hooks in preview');
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
