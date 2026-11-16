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

function mount() {
  const els = new Map();
  const requests = [];
  const stores = [];
  const secretWrites = [];
  let secret = null;
  function element(id) {
    if (!els.has(id)) {
      els.set(id, {
        id, value: '', textContent: '', hidden: false, disabled: false,
        style: {}, children: [], events: {},
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
    'Status': { type: 'status' }
  };
  const api = {
    onReady(fn) { fn(); },
    async getSecret() { return secret; },
    async setSecret(k,v) {secretWrites.push([k,v]); secret=v;},
    async deleteSecret() {secret=null;},
    async loadSyncedData() {return null;},
    async persistDataSynced(v,k) { stores.push({data:v,key:k}); },
    async getTasks() { return [{id:'sp1',title:'Existing SP task'}]; },
    async request(url, opts) {
      requests.push({url,opts});
      assert.equal(new URL(url).host, 'api.notion.com');
      assert.ok(opts.headers['Notion-Version']);
      if (opts.method==='GET') return {properties:schema};
      if (opts.method==='POST') return {results: [
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
    createElement(tag) {
      return {tag, textContent:'',children:[],
        appendChild(x){this.children.push(x);return x;}};
    }
  };
  const script = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(script, 'inline plugin code exists');
  new vm.Script(script[1], {filename:'alf-preview-inline.js'}).runInNewContext({
    PluginAPI:api,window:{PluginAPI:api},document,setTimeout,
    URL,console
  });
  return {els:element,requests,stores,secretWrites,api};
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
  assert.equal(env.els('results').children[0].children[0].textContent,'Sample task');
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
