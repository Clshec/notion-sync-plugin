'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const plugin = fs.readFileSync(path.join(__dirname, '..', 'plugin.js'), 'utf8');

function mount(initialMode) {
  const hooks = new Map(), written=[];
  let tick = 1000, id = 0;
  const keys = {
    ACTION:'action',
    CURRENT_TASK_CHANGE:'currentTaskChange'
  };
  const api = {
    Hooks:keys,
    registerHeaderButton(){},
    showIndexHtmlAsView(){},
    registerHook(name,fn){hooks.set(name,fn);},
    async persistDataSynced(content,key){
      written.push({key, value:JSON.parse(content)});
    }
  };
  const context = {
    PluginAPI:api,
    localStorage:{
      getItem(name){return name === 'FOCUS_MODE_MODE' ? initialMode : null;}
    },
    Date:{now(){tick+=1000;return tick;}},
    Math:{random(){id++;return id/1000;}},
    console
  };
  vm.createContext(context);
  vm.runInContext(plugin,context,{filename:'plugin.js'});
  async function action(type, data={}) {
    const fn=hooks.get(keys.ACTION);
    assert.equal(typeof fn,'function');
    return fn({action:{type,...data}});
  }
  function track(id) {
    hooks.get(keys.CURRENT_TASK_CHANGE)({
      current:id ? {id} : null, previous:null
    });
  }
  return {action,track,written,hooks,context};
}

const START='[FocusMode] Start Session';
const COMPLETE='[FocusMode] Complete Session';
const MODE='[FocusMode] Set Mode';
const CANCEL='[FocusMode] Cancel Session';

test('only explicit automatic Pomodoro completion produces verified Pomodoro', async()=>{
  const h=mount('Pomodoro');
  h.track('task42');
  await h.action(START);
  await h.action(COMPLETE,{isManual:false});
  assert.equal(h.written.length,1);
  assert.equal(h.written[0].value.taskId,'task42');
  assert.equal(h.written[0].value.mode,'Pomodoro');
  assert.equal(h.written[0].value.verifiedCompletedPomodoro,true);
  assert.equal(h.written[0].value.completedDurationMs,null);
  assert.equal(h.written[0].value.durationSource,'unavailable');
  assert.ok(h.written[0].key.startsWith('alf-focus-observed-v1-'));
});

test('manual ending does not count as completed Pomodoro',async()=>{
  const h=mount('Pomodoro');
  h.track('a');
  await h.action(START);
  await h.action(COMPLETE,{isManual:true,completedDuration:60000});
  assert.equal(h.written[0].value.verifiedCompletedPomodoro,false);
  assert.equal(h.written[0].value.completedDurationMs,60000);
});

test('Flowtime and Countdown endings retain modes but do not produce Pomodoro count',async()=>{
  const h=mount('Flowtime');
  h.track('a');
  await h.action(START);
  await h.action(COMPLETE,{isManual:true});
  await h.action(MODE,{mode:'Countdown'});
  await h.action(START);
  await h.action(COMPLETE,{isManual:false});
  assert.equal(h.written.length,2);
  assert.equal(h.written[0].value.mode,'Flowtime');
  assert.equal(h.written[1].value.mode,'Countdown');
  assert.ok(h.written.every(x=>!x.value.verifiedCompletedPomodoro));
});

test('starting without a known mode or task never writes a guess',async()=>{
  const h=mount(null);
  await h.action(START,{taskId:'a'});
  await h.action(COMPLETE,{isManual:false});
  await h.action(MODE,{mode:'Pomodoro'});
  await h.action(START);
  await h.action(COMPLETE,{isManual:false});
  assert.equal(h.written.length,0);
});

test('cancelled and interrupted task context are not recorded',async()=>{
  const h=mount('Pomodoro');
  h.track('a');
  await h.action(START);
  await h.action(CANCEL);
  await h.action(COMPLETE,{isManual:false});
  await h.action(START);
  h.track('b');
  await h.action(COMPLETE,{isManual:false});
  assert.equal(h.written.length,0);
});

test('one completion action cannot double-count a session; each new start has a distinct ID',async()=>{
  const h=mount('Pomodoro');
  h.track('a');
  await h.action(START);
  await h.action(COMPLETE,{isManual:false});
  await h.action(COMPLETE,{isManual:false});
  await h.action(START);
  await h.action(COMPLETE,{isManual:false});
  assert.equal(h.written.length,2);
  assert.notEqual(h.written[0].key,h.written[1].key);
});

test('unknown actions do not trigger side effects; no timers or Notion calls',async()=>{
  const h=mount('Pomodoro');
  h.track('a');
  await h.action('[Metric] Log Focus Session',{day:'2026-11-16',duration:1500000});
  await h.action('[Other] Tick',{title:'Sensitive'});
  assert.equal(h.written.length,0);
});

test('changing mode during session invalidates ambiguous completion',async()=>{
  const h=mount('Pomodoro');
  h.track('a');
  await h.action(START);
  await h.action(MODE,{mode:'Flowtime'});
  await h.action(COMPLETE,{isManual:false});
  assert.equal(h.written.length,0);
});
