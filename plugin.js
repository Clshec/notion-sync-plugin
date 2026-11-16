// Alf Notion Super Productivity — action-observed focus sessions (alpha).
// No Notion writes, no timer control, no background polling.
// Only sessions whose start AND completion were seen with an unambiguous
// task and mode are recorded. No historical backfill is possible.
// Original MIT copyright remains in LICENSE (Alessio Lovato).
'use strict';

const ALF_FOCUS_KEY_PREFIX = 'alf-focus-observed-v1-';
const ALF_FOCUS_MODES = ['Pomodoro', 'Flowtime', 'Countdown'];
const ALF_ACTIONS = {
  mode: '[FocusMode] Set Mode',
  start: '[FocusMode] Start Session',
  complete: '[FocusMode] Complete Session',
  cancel: '[FocusMode] Cancel Session',
  endFlowtime: '[FocusMode] End Flowtime Session'
};

function alfValidMode(value) {
  return ALF_FOCUS_MODES.indexOf(value) !== -1;
}

function alfInitialFocusMode() {
  try {
    // The host stores its most recently selected focus mode under this key.
    // Do not infer a mode if the host lacks this local setting.
    const cached = localStorage.getItem('FOCUS_MODE_MODE');
    return alfValidMode(cached) ? cached : null;
  } catch (_) {
    return null;
  }
}

function alfGenerateFocusId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older JS runtimes. Not proof against duplicate remote
  // actions; store one record per observed session and do not replay action.
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

function alfCreateFocusObserver(api, options) {
  const opts = options || {};
  const time = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const generate = typeof opts.id === 'function' ? opts.id : alfGenerateFocusId;

  let mode = alfValidMode(opts.initialMode) ? opts.initialMode : null;
  let trackedTaskId = null;
  let active = null;
  let rejectedSessions = 0;

  function current() {
    return { mode, trackedTaskId, active, rejectedSessions };
  }

  function onCurrentTaskChange(change) {
    trackedTaskId = change && change.current && typeof change.current.id === 'string'
      ? change.current.id
      : null;
    // A focus session with a changing tracked task is ambiguous. Never attach
    // a session's end to a different task than its observed start.
    if (active && active.taskId !== trackedTaskId) {
      active = null;
      rejectedSessions++;
    }
  }

  async function onAction(payload) {
    const action = payload && payload.action;
    if (!action || typeof action.type !== 'string') return null;
    switch (action.type) {
      case ALF_ACTIONS.mode:
        if (active) {
          active = null;
          rejectedSessions++;
        }
        mode = alfValidMode(action.mode) ? action.mode : null;
        return null;

      case ALF_ACTIONS.start: {
        // Never claim to observe a session that began before this plugin
        // activated. A replacement start invalidates the previous observer.
        if (active) rejectedSessions++;
        active = null;
        const taskId = typeof action.taskId === 'string' && action.taskId.trim()
          ? action.taskId
          : trackedTaskId;
        if (!alfValidMode(mode) || !taskId) {
          rejectedSessions++;
          return null;
        }
        active = {
          sessionId: generate(),
          taskId,
          mode,
          startedAt: time()
        };
        return null;
      }

      case ALF_ACTIONS.cancel:
        if (active) rejectedSessions++;
        active = null;
        return null;

      case ALF_ACTIONS.complete: {
        if (!active) return null;
        const started = active;
        active = null;
        const endedAt = time();
        if (endedAt < started.startedAt) {
          rejectedSessions++;
          return null;
        }
        const manual = action.isManual === true;
        // The only counted completed Pomodoro is one with an explicit
        // automatic completion action, never a manual or unknown ending.
        const verifiedCompletedPomodoro =
          started.mode === 'Pomodoro' && action.isManual === false;
        const duration = typeof action.completedDuration === 'number' &&
          Number.isFinite(action.completedDuration) &&
          action.completedDuration >= 0
          ? action.completedDuration
          : null;
        const record = {
          schemaVersion: 1,
          sessionId: started.sessionId,
          taskId: started.taskId,
          mode: started.mode,
          startedAt: started.startedAt,
          endedAt,
          observedCompletion: true,
          automatic: action.isManual === false,
          manual,
          verifiedCompletedPomodoro,
          completedDurationMs: duration,
          durationSource: duration !== null ? 'focus-action' : 'unavailable',
          source: 'live-sp-action-hook'
        };
        // Keyed, one record per session; does not write to Notion. The host's
        // Supersync may replicate these records, so do not increment totals
        // on remote dataChanged: counts must be derived from unique IDs.
        await api.persistDataSynced(
          JSON.stringify(record),
          ALF_FOCUS_KEY_PREFIX + record.sessionId
        );
        return record;
      }

      default:
        return null;
    }
  }

  return { current, onCurrentTaskChange, onAction };
}

if (typeof PluginAPI !== 'undefined') {
  PluginAPI.registerHeaderButton({
    label: 'Alf Notion',
    icon: 'view_list',
    onClick: () => PluginAPI.showIndexHtmlAsView()
  });

  const alfFocusObserver = alfCreateFocusObserver(PluginAPI, {
    initialMode: alfInitialFocusMode()
  });

  // Read the payload type: CurrentTaskChangePayload {current, previous}.
  PluginAPI.registerHook(
    PluginAPI.Hooks.CURRENT_TASK_CHANGE,
    (payload) => alfFocusObserver.onCurrentTaskChange(payload)
  );

  // This hook receives all app actions: immediately filter on action.type.
  // No raw action contents or personal task names are logged/stored.
  PluginAPI.registerHook(
    PluginAPI.Hooks.ACTION,
    (payload) => alfFocusObserver.onAction(payload)
  );
}


// Opt-in one-way Notion planning pull, v0.14. The local enable flag lives in
// SP's per-device secret store and is NEVER copied by SuperSync. It is not a
// password; this storage is used because the official plugin API provides no
// other per-device persistence primitive. Notion tokens stay local separately.
//
// Only individually seeded Notion-page/SP-task baseline IDs are eligible.
// No import, no Notion writes, no timer control or automatic bidirectional sync.

// All three opt-in engines share ONE Notion request lane per plugin runtime.
// Notion documents an average 3 requests/second per integration; a 450ms
// interval stays below that under normal load. It does not coordinate with
// other devices or manual Notion requests from the iframe.
const ALF_NOTION_REQUEST_MIN_GAP_MS=450;
let alfNotionRequestLane=Promise.resolve();
let alfNotionLastStartedAt=0;
function alfExplicitRateLimit(error) {
  if(!error)return false;
  const code=Number(error.status || error.statusCode ||
    (error.response&&error.response.status) ||
    (error.error&&error.error.status));
  return code===429 || error.code==='rate_limited' ||
    /(?:\b429\b|rate.?limit)/i.test(String(error.message||''));
}
async function alfNotionDelay(ms) {
  if(ms>0 && typeof setTimeout==='function')
    await new Promise(resolve=>setTimeout(resolve,ms));
}
function alfQueuedNotionRequest(api,url,options) {
  // Never retry a timeout/unknown server outcome, especially a PATCH:
  // an ambiguous success is resolved by the persisted numeric baseline.
  const run=async()=>{
    let retried=false;
    for(;;){
      await alfNotionDelay(Math.max(0,
        alfNotionLastStartedAt+ALF_NOTION_REQUEST_MIN_GAP_MS-Date.now()));
      alfNotionLastStartedAt=Date.now();
      try {return await api.request(url,options);}
      catch(error){
        if(retried||!alfExplicitRateLimit(error))throw error;
        // 429 explicitly means Notion rejected the request. One bounded
        // re-attempt only, never a blind retry for a lost write response.
        retried=true;
        const retryAfter=Number(error.retryAfter ||
          (error.response&&error.response.headers&&error.response.headers['retry-after']));
        await alfNotionDelay(Number.isFinite(retryAfter)&&retryAfter>0?
          Math.min(5000,Math.ceil(retryAfter*1000)):1200);
      }
    }
  };
  const result=alfNotionRequestLane.then(run);
  alfNotionRequestLane=result.then(()=>undefined,()=>undefined);
  return result;
}

const ALF_AUTO_STATUS_KEY='alf-auto-status-local-v1-';
async function alfStoreAutoStatus(api,flow,stats) {
  if(typeof api.setSecret!=='function')return;
  // Local-only diagnostic aggregates. Never expose page/task IDs, titles,
  // Notion tokens, request details or full synced data in these records.
  const numeric={};
  for(const key of ['processed','updated','written','anchored','skipped',
    'unchanged','conflicts','errors']) {
    if(Number.isSafeInteger(stats&&stats[key])&&stats[key]>=0)
      numeric[key]=stats[key];
  }
  const record={version:1,checkedAt:Date.now(),
    outcome:numeric.errors>0?'errors':numeric.conflicts>0?'conflicts':'ok',
    counts:numeric};
  await api.setSecret(ALF_AUTO_STATUS_KEY+flow,JSON.stringify(record));
}

const ALF_AUTO_PLAN_FLAG = 'alf-auto-plan-local-enabled-v1';
const ALF_AUTO_PLAN_BASELINE_PREFIX = 'alf-plan-anchor-v1-';
const ALF_AUTO_PLAN_MAPPING_KEY = 'alf-mapping-v2';
const ALF_AUTO_PLAN_LINK_PREFIX = 'alf-page-link-';
const ALF_AUTO_PLAN_CHECK_MS = 10 * 60 * 1000;
const ALF_AUTO_PLAN_TASKS_PER_CYCLE = 8;

function alfAutoUuid(value) {
  return String(value || '').replace(/-/g, '').toLowerCase();
}
function alfAutoEqual(a, b) {
  return (a == null ? null : a) === (b == null ? null : b);
}
function alfAutoPlanSpec(c) {
  if (!c || c.version !== 2) throw new Error('Unsupported Alf mapping format');
  const sourceId = alfAutoUuid(c.taskSource);
  if (!/^[0-9a-f]{32}$/.test(sourceId)) throw new Error('Missing Notion task data source');
  const allowed = String(c.typeValues || '').split(',').map(x => x.trim()).filter(Boolean).sort();
  if (!c.titleProp || !c.typeProp || !allowed.length)
    throw new Error('Configure Notion task title and type mapping');
  if (!['minutes', 'hours'].includes(c.unit))
    throw new Error('Notion estimate unit must be explicit');
  const ids = {}, input = {};
  for (const key of ['titleProp', 'typeProp', 'estimateProp', 'executionProp']) {
    input[key] = c[key] || '';
    const b = c.taskPropertyBindings && c.taskPropertyBindings[key];
    ids[key] = b && b.input === input[key] && b.sourceId === sourceId &&
      typeof b.id === 'string' ? b.id : '';
    if (input[key] && !ids[key])
      throw new Error('Stable task property ID required for automatic planning: ' + key);
  }
  return {sourceId, input, ids, unit:c.unit, allowed};
}
function alfAutoProp(schemaOrPage, id) {
  if (!id) return null;
  const props = schemaOrPage && (schemaOrPage.properties || schemaOrPage) || {};
  const matches = Object.keys(props).filter(name => props[name] && props[name].id === id);
  return matches.length === 1 ? props[matches[0]] : null;
}
function alfAutoValidateSchema(schema, spec) {
  const expected = {titleProp:['title'], typeProp:['select','multi_select'],
    estimateProp:['number'], executionProp:['date']};
  for (const key of Object.keys(expected)) {
    if (!spec.input[key]) continue;
    const field = alfAutoProp(schema, spec.ids[key]);
    if (!field || !expected[key].includes(field.type))
      throw new Error('Pinned Notion property unavailable or wrong type: ' + key);
  }
}
function alfAutoNotionPlan(page, spec) {
  const titleProp = alfAutoProp(page, spec.ids.titleProp);
  const title = titleProp && Array.isArray(titleProp.title)
    ? titleProp.title.map(x => x.plain_text || (x.text && x.text.content) || '').join('')
    : '';
  if (!title.trim()) throw new Error('Missing Notion task title');
  const result = {title};
  if (spec.input.estimateProp) {
    const field = alfAutoProp(page, spec.ids.estimateProp);
    if (!field || field.type !== 'number') throw new Error('Invalid Notion estimate property');
    if (field.number !== null && field.number !== undefined) {
      const n = field.number;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0)
        throw new Error('Invalid Notion time estimate');
      const ms = Math.round(n * (spec.unit === 'minutes' ? 60000 : 3600000));
      if (!Number.isSafeInteger(ms)) throw new Error('Estimate exceeds safe range');
      result.timeEstimate = ms;
    }
  }
  if (spec.input.executionProp) {
    const field = alfAutoProp(page, spec.ids.executionProp);
    if (!field || field.type !== 'date') throw new Error('Invalid Notion execution property');
    if (field.date && field.date.start) {
      if (field.date.end) throw new Error('Notion date ranges have no auto-sync policy');
      const day = String(field.date.start);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        const parsed = new Date(day + 'T00:00:00.000Z');
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== day)
          throw new Error('Invalid Notion calendar date');
        result.dueDay = day;
        result.dueWithTime = null;
      } else {
        if (!/(Z|[+-]\d{2}:\d{2})$/i.test(day))
          throw new Error('Notion timestamp must carry an explicit timezone offset');
        const ms = Date.parse(day);
        if (!Number.isFinite(ms)) throw new Error('Invalid Notion timestamp');
        result.dueDay = null;
        result.dueWithTime = ms;
      }
    }
  }
  return result;
}
function alfAutoAllowedType(page, spec) {
  const field = alfAutoProp(page, spec.ids.typeProp);
  if (!field) return false;
  const values = field.type === 'multi_select'
    ? (field.multi_select || []).map(x => x.name)
    : field.type === 'select' && field.select ? [field.select.name] : [];
  return values.some(value => spec.allowed.includes(value));
}
function alfAutoCurrentPlan(task) {
  return {title:task.title,
    timeEstimate:typeof task.timeEstimate === 'number' ? task.timeEstimate : null,
    dueDay:task.dueDay ?? null, dueWithTime:task.dueWithTime ?? null};
}
function alfAutoTaskMatches(task,anchor) {
  if(!task || task.id !== anchor.spId || task.isDone === true || task.repeatCfgId ||
    (task.projectId ?? null) !== anchor.projectId ||
    (task.parentId ?? null) !== anchor.parentId ||
    typeof task.notes !== 'string') return false;
  return task.notes.split(/\s+/).includes('alf-notion-page-id:'+anchor.notionId);
}
function alfCreateAutoPlanSync(api, options) {
  const opts=options || {}, maxBatch=opts.maxBatch || ALF_AUTO_PLAN_TASKS_PER_CYCLE;
  let cursor=0, busy=false, lastRun=0, interval=null;
  async function notion(token, path) {
    return alfQueuedNotionRequest(api,'https://api.notion.com/v1'+path, {
      method:'GET',
      headers:{'Authorization':'Bearer '+token,'Notion-Version':'2026-03-11',
        'Content-Type':'application/json'},
      timeout:30000,responseType:'json'
    });
  }
  async function runOnce() {
    const stats={enabled:false,processed:0,updated:0,skipped:0,conflicts:0,errors:0};
    if(typeof api.getSecret!=='function' ||
       await api.getSecret(ALF_AUTO_PLAN_FLAG)!=='enabled') return stats;
    stats.enabled=true;
    if(typeof api.request!=='function' || typeof api.getTasks!=='function' ||
       typeof api.getArchivedTasks!=='function' ||
       typeof api.loadSyncedData!=='function' ||
       typeof api.listSyncedDataKeys!=='function' ||
       typeof api.updateTask!=='function' ||
       typeof api.persistDataSynced!=='function') {
      stats.errors++;return stats;
    }
    const token=await api.getSecret('alf-notion-token');
    if(!token){stats.errors++;return stats;}
    let spec,allKeys,source;
    try {
      const raw=await api.loadSyncedData(ALF_AUTO_PLAN_MAPPING_KEY);
      spec=alfAutoPlanSpec(raw?JSON.parse(raw):null);
      allKeys=await api.listSyncedDataKeys(ALF_AUTO_PLAN_BASELINE_PREFIX);
      if(!Array.isArray(allKeys))throw new Error('Invalid Notion planning anchor inventory');
      allKeys=allKeys.filter(k=>typeof k==='string'&&k.startsWith(ALF_AUTO_PLAN_BASELINE_PREFIX)).sort();
      if(!allKeys.length)return stats;
      source=await notion(token,'/data_sources/'+encodeURIComponent(spec.sourceId));
      alfAutoValidateSchema(source&&source.properties||{},spec);
    } catch (_) {stats.errors++;return stats;}
    const active=await api.getTasks() || [];
    const archived=await api.getArchivedTasks() || [];
    // Round-robin anchored tasks, bounded per cycle to avoid rate-limit bursts.
    const count=Math.min(maxBatch,allKeys.length);
    for (let i=0;i<count;i++) {
      const key=allKeys[(cursor+i)%allKeys.length];
      stats.processed++;
      try {
        const raw=await api.loadSyncedData(key);
        if(!raw){stats.skipped++;continue;}
        const anchor=JSON.parse(raw);
        if(!anchor || anchor.version!==1 ||
          !/^[0-9a-f]{32}$/.test(alfAutoUuid(anchor.notionId)) ||
          key!==ALF_AUTO_PLAN_BASELINE_PREFIX+anchor.notionId ||
          anchor.sourceId!==spec.sourceId ||
          anchor.spec!==JSON.stringify(spec) ||
          !anchor.expected || typeof anchor.expected.title!=='string') {
          stats.skipped++;continue;
        }
        const candidates=[...active,...archived].filter(t=>
          t&&typeof t.notes==='string'&&
          t.notes.split(/\s+/).includes('alf-notion-page-id:'+anchor.notionId));
        if(candidates.length!==1 || !active.some(t=>t.id===anchor.spId) ||
           !alfAutoTaskMatches(candidates[0],anchor)) {
          stats.conflicts++;continue;
        }
        const linkRaw=await api.loadSyncedData(ALF_AUTO_PLAN_LINK_PREFIX+anchor.notionId);
        const link=linkRaw?JSON.parse(linkRaw):null;
        if(!link||link.notionId!==anchor.notionId||link.spId!==anchor.spId) {
          stats.conflicts++;continue;
        }
        const page=await notion(token,'/pages/'+encodeURIComponent(anchor.notionId));
        if(!page || page.object!=='page' || page.in_trash ||
          alfAutoUuid(page.id)!==alfAutoUuid(anchor.notionId) ||
          alfAutoUuid(page.parent&&page.parent.data_source_id)!==spec.sourceId ||
          !alfAutoAllowedType(page,spec)) {
          stats.conflicts++;continue;
        }
        const desired=alfAutoNotionPlan(page,spec),task=candidates[0];
        const current=alfAutoCurrentPlan(task),update={};
        let conflict=false;
        for(const name of ['title','timeEstimate','dueDay','dueWithTime']) {
          const before=anchor.expected[name] ?? null,local=current[name]??null;
          const expected=Object.prototype.hasOwnProperty.call(desired,name)
            ? desired[name] : before;
          if(!alfAutoEqual(local,before) && !alfAutoEqual(local,expected)) {
            conflict=true;break;
          }
          if(Object.prototype.hasOwnProperty.call(desired,name) &&
             !alfAutoEqual(local,expected))update[name]=expected;
        }
        if(conflict){stats.conflicts++;continue;}
        if(Object.keys(update).length) {
          // Recheck SP state and link immediately before any local update.
          const nowTasks=await api.getTasks()||[];
          const latest=nowTasks.find(t=>t&&t.id===anchor.spId);
          const latestPlan=latest&&alfAutoCurrentPlan(latest);
          const currentNames=['title','timeEstimate','dueDay','dueWithTime'];
          if(!alfAutoTaskMatches(latest,anchor) ||
            currentNames.some(k=>!alfAutoEqual(latestPlan[k],current[k])) ||
            (await api.loadSyncedData(ALF_AUTO_PLAN_LINK_PREFIX+anchor.notionId))!==linkRaw ||
            (await api.loadSyncedData(key))!==raw) {
            stats.conflicts++;continue;
          }
          // Disabling the device during an in-flight GET must cancel any
          // not-yet-started local write; it is not a distributed transaction.
          if(await api.getSecret(ALF_AUTO_PLAN_FLAG)!=='enabled') {
            stats.conflicts++;continue;
          }
          // No timeSpent, status, tag, notes, project, parent or Notion writes.
          await api.updateTask(anchor.spId,update,{isIgnoreShortSyntax:true});
          stats.updated++;
        } else {stats.skipped++;}
        const expected=Object.assign({},current,update);
        if(JSON.stringify(expected)!==JSON.stringify(anchor.expected)) {
          const next=Object.assign({},anchor,{expected});
          // If SP write succeeded but anchor persistence fails, next cycle
          // detects a local mismatch and safely refuses replay until re-seeded.
          await api.persistDataSynced(JSON.stringify(next),key);
        }
      } catch (_) {stats.errors++;}
    }
    cursor=(cursor+count)%allKeys.length;
    if(stats.updated && api.log && typeof api.log.info==='function')
      api.log.info('[Alf] Opt-in Notion planning refreshed '+stats.updated+' linked SP tasks');
    return stats;
  }
  async function heartbeat() {
    if(busy)return;
    const now=Date.now();
    if(lastRun && now-lastRun < ALF_AUTO_PLAN_CHECK_MS)return;
    busy=true;
    try {
      // Disabled devices do not open Notion connections or change SP tasks.
      if(await api.getSecret(ALF_AUTO_PLAN_FLAG)!=='enabled')return;
      lastRun=now;
      const stats=await runOnce();
      await alfStoreAutoStatus(api,'planning',stats);
    } catch (_) {
      try {await alfStoreAutoStatus(api,'planning',{errors:1});}catch(_){}
      if(api.log&&typeof api.log.warn==='function')
        api.log.warn('[Alf] Opt-in Notion planning check skipped');
    } finally {busy=false;}
  }
  function start() {
    if(interval!==null || typeof setInterval!=='function')return;
    interval=setInterval(()=>{void heartbeat();},60000);
    void heartbeat(); // enabled devices check once on app/plugin startup
  }
  function stop() {
    if(interval!==null && typeof clearInterval==='function')clearInterval(interval);
    interval=null;
  }
  return {runOnce,start,stop,heartbeat};
}


const ALF_AUTO_TIME_FLAG='alf-auto-time-local-enabled-v1';
const ALF_AUTO_TIME_ANCHOR_PREFIX='alf-time-anchor-v1-';
const ALF_AUTO_TIME_TASKS_PER_CYCLE=5;
function alfAutoTimeSpec(c) {
  if(!c || c.version!==2)throw new Error('Invalid Notion mapping configuration');
  const sourceId=alfAutoUuid(c.taskSource);
  if(!/^[a-f0-9]{32}$/.test(sourceId))throw new Error('Invalid Notion data source ID');
  const allowed=String(c.typeValues||'').split(',').map(x=>x.trim()).filter(Boolean).sort();
  if(!c.typeProp || !c.actualProp || !allowed.length)
    throw new Error('Select mapped existing Notion task type and actual-time property');
  if(!['minutes','hours'].includes(c.unit))throw new Error('Invalid time unit');
  function pinned(key) {
    const b=c.taskPropertyBindings&&c.taskPropertyBindings[key];
    return b && b.sourceId===sourceId && b.input===c[key] &&
      typeof b.id==='string' && b.id?b.id:'';
  }
  const typeId=pinned('typeProp'),actualId=pinned('actualProp');
  if(!typeId || !actualId)throw new Error('Pin existing task type and actual-time property IDs');
  return {sourceId,typeId,actualId,unit:c.unit,allowed};
}
function alfAutoTimeValue(ms,unit) {
  if(!Number.isSafeInteger(ms)||ms<=0)return null;
  const value=Math.round((ms/(unit==='minutes'?60000:3600000))*1000000)/1000000;
  return Number.isFinite(value)&&value>0?value:null;
}
function alfAutoTimeTask(task,anchor) {
  if(!task || task.id!==anchor.spId ||
     (task.projectId??null)!==anchor.projectId ||
     (task.parentId??null)!==anchor.parentId ||
     (Array.isArray(task.subTaskIds)&&task.subTaskIds.length>0) ||
     typeof task.notes!=='string')return false;
  return task.notes.split(/\s+/).includes('alf-notion-page-id:'+anchor.notionId);
}
function alfAutoTimePage(page,spec,notionId) {
  if(!page || page.object!=='page' || page.in_trash ||
     alfAutoUuid(page.id)!==alfAutoUuid(notionId) ||
     alfAutoUuid(page.parent&&page.parent.data_source_id)!==spec.sourceId)return null;
  const t=alfAutoProp(page,spec.typeId);
  const typeValues=t&&t.type==='multi_select'?
    (t.multi_select||[]).map(x=>x.name):
    t&&t.type==='select'&&t.select?[t.select.name]:[];
  if(!typeValues.some(x=>spec.allowed.includes(x)))return null;
  const actual=alfAutoProp(page,spec.actualId);
  if(!actual||actual.type!=='number')return null;
  return actual.number;
}
function alfCreateAutoTimeSync(api,options) {
  const opts=options||{},maxBatch=opts.maxBatch||ALF_AUTO_TIME_TASKS_PER_CYCLE;
  let busy=false,cursor=0,lastRun=0,interval=null;
  async function notion(token,path,method,body) {
    const options={method:method||'GET',
      headers:{'Authorization':'Bearer '+token,'Notion-Version':'2026-03-11',
        'Content-Type':'application/json'},
      timeout:30000,responseType:'json'};
    if(body!==undefined)options.body=body;
    return alfQueuedNotionRequest(api,'https://api.notion.com/v1'+path,options);
  }
  async function runOnce() {
    const stats={enabled:false,processed:0,written:0,unchanged:0,conflicts:0,errors:0};
    if(typeof api.getSecret!=='function' ||
       await api.getSecret(ALF_AUTO_TIME_FLAG)!=='enabled')return stats;
    stats.enabled=true;
    if(['request','getTasks','getArchivedTasks','loadSyncedData',
        'listSyncedDataKeys','persistDataSynced'].some(k=>typeof api[k]!=='function')) {
      stats.errors++;return stats;
    }
    const token=await api.getSecret('alf-notion-token');
    if(!token){stats.errors++;return stats;}
    let spec,keys;
    try {
      const raw=await api.loadSyncedData(ALF_AUTO_PLAN_MAPPING_KEY);
      spec=alfAutoTimeSpec(raw?JSON.parse(raw):null);
      keys=await api.listSyncedDataKeys(ALF_AUTO_TIME_ANCHOR_PREFIX);
      if(!Array.isArray(keys))throw new Error('Missing synced time anchor index');
      keys=keys.filter(k=>typeof k==='string' && k.startsWith(ALF_AUTO_TIME_ANCHOR_PREFIX)).sort();
      if(!keys.length)return stats;
      const schema=await notion(token,'/data_sources/'+encodeURIComponent(spec.sourceId));
      const a=alfAutoProp(schema&&schema.properties||{},spec.actualId);
      const t=alfAutoProp(schema&&schema.properties||{},spec.typeId);
      if(!a||a.type!=='number'||!t||!['select','multi_select'].includes(t.type))
        throw new Error('Pinned Notion properties replaced or removed');
    }catch(_){stats.errors++;return stats;}
    const active=await api.getTasks()||[],archived=await api.getArchivedTasks()||[];
    const all=[...active,...archived],count=Math.min(maxBatch,keys.length);
    for(let i=0;i<count;i++){
      const key=keys[(cursor+i)%keys.length];stats.processed++;
      try{
        const raw=await api.loadSyncedData(key);
        if(!raw){stats.conflicts++;continue;}
        const anchor=JSON.parse(raw);
        if(!anchor||anchor.version!==1||
           key!==ALF_AUTO_TIME_ANCHOR_PREFIX+anchor.notionId||
           !/^[a-f0-9]{32}$/.test(alfAutoUuid(anchor.notionId))||
           anchor.sourceId!==spec.sourceId||anchor.spec!==JSON.stringify(spec)||
           !Number.isSafeInteger(anchor.expectedSpMs)||anchor.expectedSpMs<=0||
           typeof anchor.expectedNotion!=='number'||!Number.isFinite(anchor.expectedNotion)||
           anchor.expectedNotion<=0){
          stats.conflicts++;continue;
        }
        const matches=all.filter(t=>t&&typeof t.notes==='string'&&
          t.notes.split(/\s+/).includes('alf-notion-page-id:'+anchor.notionId));
        if(matches.length!==1 || !alfAutoTimeTask(matches[0],anchor)){
          stats.conflicts++;continue;
        }
        const task=matches[0],ms=task.timeSpent;
        const nextValue=alfAutoTimeValue(ms,spec.unit);
        if(!nextValue || ms<anchor.expectedSpMs ||
          nextValue<anchor.expectedNotion) {
          stats.conflicts++;continue;
        }
        if(ms===anchor.expectedSpMs) {stats.unchanged++;continue;}
        if(nextValue<=anchor.expectedNotion) {stats.unchanged++;continue;}
        const linkRaw=await api.loadSyncedData(ALF_AUTO_PLAN_LINK_PREFIX+anchor.notionId);
        const link=linkRaw?JSON.parse(linkRaw):null;
        if(!link||link.notionId!==anchor.notionId||link.spId!==anchor.spId){
          stats.conflicts++;continue;
        }
        const path='/pages/'+encodeURIComponent(anchor.notionId);
        const page=await notion(token,path);
        const before=alfAutoTimePage(page,spec,anchor.notionId);
        if(typeof before!=='number' || !Number.isFinite(before) ||
           Math.abs(before-anchor.expectedNotion)>0.000001) {
          stats.conflicts++;continue;
        }
        const tasksNow=[...(await api.getTasks()||[]),...(await api.getArchivedTasks()||[])];
        const same=tasksNow.filter(t=>t&&typeof t.notes==='string'&&
          t.notes.split(/\s+/).includes('alf-notion-page-id:'+anchor.notionId));
        if(same.length!==1 || !alfAutoTimeTask(same[0],anchor) ||
           same[0].timeSpent!==ms ||
           (await api.loadSyncedData(ALF_AUTO_PLAN_LINK_PREFIX+anchor.notionId))!==linkRaw ||
           (await api.loadSyncedData(key))!==raw ||
           (await api.getSecret(ALF_AUTO_TIME_FLAG))!=='enabled') {
          stats.conflicts++;continue;
        }
        // Re-read Notion immediately before PATCH to reduce, not eliminate,
        // the GET/PATCH race. A changed manual correction always wins.
        const latest=await notion(token,path);
        const latestValue=alfAutoTimePage(latest,spec,anchor.notionId);
        if(typeof latestValue!=='number' || !Number.isFinite(latestValue) ||
           Math.abs(latestValue-anchor.expectedNotion)>0.000001){
          stats.conflicts++;continue;
        }
        const patch={properties:{}};
        patch.properties[spec.actualId]={number:nextValue};
        const result=await notion(token,path,'PATCH',patch);
        if(!result||result.object!=='page' ||
           alfAutoUuid(result.id)!==alfAutoUuid(anchor.notionId))
          throw new Error('Notion did not confirm the Number update');
        stats.written++;
        // If this persist fails, a later cycle sees an unknown Notion value
        // and stops; an explicit new matching baseline resolves ambiguity.
        const next=Object.assign({},anchor,{expectedNotion:nextValue,expectedSpMs:ms});
        await api.persistDataSynced(JSON.stringify(next),key);
      }catch(_){stats.errors++;}
    }
    cursor=(cursor+count)%keys.length;
    return stats;
  }
  async function heartbeat() {
    if(busy)return;
    const now=Date.now();
    if(lastRun&&now-lastRun<ALF_AUTO_PLAN_CHECK_MS)return;
    busy=true;
    try{
      if(await api.getSecret(ALF_AUTO_TIME_FLAG)!=='enabled')return;
      lastRun=now;
      const stats=await runOnce();
      await alfStoreAutoStatus(api,'time',stats);
    }catch(_){
      try {await alfStoreAutoStatus(api,'time',{errors:1});}catch(_){}
      if(api.log&&typeof api.log.warn==='function')
        api.log.warn('[Alf] Automatic work-time export skipped (sandbox alpha)');
    }finally{busy=false;}
  }
  function start() {
    if(interval!==null||typeof setInterval!=='function')return;
    interval=setInterval(()=>{void heartbeat();},60000);
    void heartbeat();
  }
  function stop() {
    if(interval!==null&&typeof clearInterval==='function')clearInterval(interval);
    interval=null;
  }
  return {runOnce,start,stop,heartbeat};
}


const ALF_AUTO_HABIT_FLAG='alf-auto-habit-local-enabled-v1';
const ALF_AUTO_HABIT_PREFIX='alf-habit-auto-anchor-v1-';
const ALF_AUTO_HABIT_LINK_PREFIX='alf-habit-definition-link-v1-';
const ALF_AUTO_HABIT_APPROVAL_PREFIX='alf-habit-auto-allow-v1-';
const ALF_AUTO_HABIT_PER_CYCLE=3;
function alfAutoHabitSpec(c) {
  if(!c||c.version!==2)throw new Error('Invalid Notion mapping');
  const sourceId=alfAutoUuid(c.taskSource),habitSourceId=alfAutoUuid(c.habitSource);
  if(!/^[a-f0-9]{32}$/.test(sourceId)||!/^[a-f0-9]{32}$/.test(habitSourceId))
    throw new Error('Missing existing task/habit data source IDs');
  if(!['count','minutes','hours'].includes(c.habitOccUnit)||!c.habitOccTypeValue)
    throw new Error('Missing explicit existing habit type or unit');
  const fields={
    habitOccTypeProp:'typeId',habitOccRelationProp:'relationId',
    habitOccDayProp:'dayId',habitOccCountProp:'countId'
  },ids={};
  for(const [input,output] of Object.entries(fields)) {
    const group=c.habitPropertyBindings&&c.habitPropertyBindings.occurrences;
    const b=group&&group[input];
    if(!c[input]||!b||b.input!==c[input]||alfAutoUuid(b.sourceId)!==sourceId||
       typeof b.id!=='string'||!b.id)
      throw new Error('Stable pinned Notion habit occurrence field required: '+input);
    ids[output]=b.id;
  }
  return {sourceId,habitSourceId,ids,
    typeValue:c.habitOccTypeValue,unit:c.habitOccUnit};
}
function alfAutoHabitCompatible(counter,day,unit) {
  if(!counter || counter.isEnabled===false || !counter.countOnDay)return null;
  const raw=counter.countOnDay[day];
  if(!Number.isSafeInteger(raw)||raw<=0)return null;
  if(unit==='count'){
    if(counter.type!=='ClickCounter')return null;
    return {raw,value:raw};
  }
  if(counter.type!=='StopWatch')return null;
  const divisor=unit==='minutes'?60000:3600000;
  const value=Math.round((raw/divisor)*1000000)/1000000;
  return Number.isFinite(value)&&value>0?{raw,value}:null;
}
function alfAutoHabitPageInfo(page,spec,day) {
  if(!page||page.object!=='page'||page.in_trash)return null;
  const kind=alfAutoProp(page,spec.ids.typeId);
  const names=kind&&kind.type==='multi_select'?
    (kind.multi_select||[]).map(x=>x.name):
    kind&&kind.type==='select'&&kind.select?[kind.select.name]:[];
  if(!names.includes(spec.typeValue))return null;
  const date=alfAutoProp(page,spec.ids.dayId);
  if(!date||date.type!=='date'||!date.date||date.date.start!==day||date.date.end)
    return null;
  const rel=alfAutoProp(page,spec.ids.relationId);
  if(!rel||rel.type!=='relation'||!Array.isArray(rel.relation)||
     rel.relation.length!==1||rel.has_more===true||
     !rel.relation[0]||!rel.relation[0].id)return null;
  const number=alfAutoProp(page,spec.ids.countId);
  if(!number||number.type!=='number'||!(number.number===null||
     (typeof number.number==='number'&&Number.isFinite(number.number)&&number.number>=0)))
    return null;
  return {habitId:rel.relation[0].id,before:number.number};
}
function alfAutoHabitSameNumber(a,b) {
  return a===b||(typeof a==='number'&&typeof b==='number'&&
    Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<0.000001);
}
function alfCreateAutoHabitSync(api,options) {
  const opts=options||{},limit=opts.maxBatch||ALF_AUTO_HABIT_PER_CYCLE;
  let cursor=0,busy=false,lastRun=0,interval=null;
  async function notion(token,path,method,body){
    const req={method:method||'GET',
      headers:{'Authorization':'Bearer '+token,'Notion-Version':'2026-03-11',
        'Content-Type':'application/json'},
      timeout:30000,responseType:'json'};
    if(body!==undefined)req.body=body;
    return alfQueuedNotionRequest(api,'https://api.notion.com/v1'+path,req);
  }
  async function queryDay(token,spec,day,kind) {
    const t={property:spec.ids.typeId};
    t[kind]={};
    t[kind][kind==='select'?'equals':'contains']=spec.typeValue;
    const filter={and:[t,{property:spec.ids.dayId,date:{equals:day}}]};
    const pages=[];let cursor=null,truncated=false;
    do {
      const body={filter,page_size:Math.min(100,300-pages.length)};
      if(cursor)body.start_cursor=cursor;
      const data=await notion(token,'/data_sources/'+encodeURIComponent(spec.sourceId)+'/query','POST',body);
      if(!data||!Array.isArray(data.results))throw new Error('Invalid Notion habit-day query');
      if(data.has_more && (typeof data.next_cursor!=='string'||!data.next_cursor))
        throw new Error('Incomplete Notion habit-day query: has_more without next cursor');
      pages.push(...data.results);
      cursor=data.has_more?data.next_cursor:null;
      if(pages.length>=300){truncated=!!cursor;break;}
    }while(cursor);
    if(truncated)throw new Error('Truncated existing Notion habit-day inventory');
    return pages;
  }
  function groupCurrent(pages,spec,day){
    const grouped=new Map();
    for(const page of pages) {
      const info=alfAutoHabitPageInfo(page,spec,day);
      if(!info)continue;
      const k=alfAutoUuid(info.habitId);
      if(!grouped.has(k))grouped.set(k,[]);
      grouped.get(k).push({page,info});
    }
    return grouped;
  }
  async function runOnce() {
    const stats={enabled:false,day:null,processed:0,written:0,anchored:0,
      unchanged:0,conflicts:0,errors:0};
    if(typeof api.getSecret!=='function'||
       await api.getSecret(ALF_AUTO_HABIT_FLAG)!=='enabled')return stats;
    stats.enabled=true;
    if(['request','getAppState','getDayContext','loadSyncedData',
      'persistDataSynced','listSyncedDataKeys'].some(k=>typeof api[k]!=='function')){
      stats.errors++;return stats;
    }
    const token=await api.getSecret('alf-notion-token');
    if(!token){stats.errors++;return stats;}
    let spec,kind,day,allPages,linksById,duplicateCounters;
    try {
      const configRaw=await api.loadSyncedData(ALF_AUTO_PLAN_MAPPING_KEY);
      spec=alfAutoHabitSpec(configRaw?JSON.parse(configRaw):null);
      const ctx=await api.getDayContext();
      day=ctx&&ctx.todayStr;
      if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))
        throw new Error('SP logical day unavailable');
      stats.day=day;
      const schema=await notion(token,'/data_sources/'+encodeURIComponent(spec.sourceId));
      const expected={typeId:['select','multi_select'],relationId:['relation'],
        dayId:['date'],countId:['number']};
      for(const [k,allowed] of Object.entries(expected)) {
        const p=alfAutoProp(schema&&schema.properties||{},spec.ids[k]);
        if(!p||!allowed.includes(p.type))throw new Error('Notion habit property ID changed');
        if(k==='typeId')kind=p.type;
      }
      const keys=await api.listSyncedDataKeys(ALF_AUTO_HABIT_LINK_PREFIX);
      if(!Array.isArray(keys))throw new Error('Invalid habit mapping list');
      linksById=new Map();duplicateCounters=new Set();
      const counterOwners=new Map();
      for(const key of keys) {
        if(typeof key!=='string'||!key.startsWith(ALF_AUTO_HABIT_LINK_PREFIX))continue;
        const raw=await api.loadSyncedData(key);
        if(!raw)continue;
        try {
          const link=JSON.parse(raw);
          if(!link||link.version!==1||typeof link.spCounterId!=='string'||
             !link.spCounterId||typeof link.notionId!=='string'||
             key!==ALF_AUTO_HABIT_LINK_PREFIX+link.notionId||
             alfAutoUuid(link.notionSourceId)!==spec.habitSourceId)continue;
          const id=alfAutoUuid(link.notionId);
          if(linksById.has(id)) {linksById.set(id,null);continue;}
          linksById.set(id,{link,raw,key});
          const prior=counterOwners.get(link.spCounterId);
          if(prior&&prior!==id)duplicateCounters.add(link.spCounterId);
          counterOwners.set(link.spCounterId,id);
        }catch(_){/* invalid link ignored, no write */}
      }
      allPages=await queryDay(token,spec,day,kind);
    }catch(_){stats.errors++;return stats;}
    const initialGroups=groupCurrent(allPages,spec,day),items=[...initialGroups.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
    if(!items.length)return stats;
    const state=await api.getAppState(),counters=state&&state.simpleCounters||{};
    const count=Math.min(limit,items.length);
    for(let i=0;i<count;i++){
      const [habitKey,group]=items[(cursor+i)%items.length];
      stats.processed++;
      if(group.length!==1){stats.conflicts++;continue;}
      const {page,info}=group[0],ref=linksById.get(habitKey);
      if(!ref||duplicateCounters.has(ref.link.spCounterId)){stats.conflicts++;continue;}
      // A linked definition is NOT itself permission for unattended writes.
      // No v0.18 auto-enabled device gets legacy implicit blanket approval.
      const approvalKey=ALF_AUTO_HABIT_APPROVAL_PREFIX+info.habitId;
      const approvalRaw=await api.loadSyncedData(approvalKey);
      let approval=null;
      try{approval=approvalRaw?JSON.parse(approvalRaw):null;}catch(_){}
      if(!approval || approval.version!==1 || approval.habitId!==info.habitId ||
         approval.counterId!==ref.link.spCounterId ||
         approval.sourceId!==spec.sourceId ||
         approval.habitSourceId!==spec.habitSourceId ||
         approval.spec!==JSON.stringify(spec)) {
        stats.conflicts++;continue;
      }
      const countData=alfAutoHabitCompatible(counters[ref.link.spCounterId],day,spec.unit);
      if(!countData){stats.unchanged++;continue;}
      try {
        const anchorKey=ALF_AUTO_HABIT_PREFIX+page.id;
        const rawAnchor=await api.loadSyncedData(anchorKey);
        const anchor=rawAnchor?JSON.parse(rawAnchor):null;
        const before=info.before;
        if(anchor) {
          if(anchor.version!==1||anchor.pageId!==page.id ||
             alfAutoUuid(anchor.habitId)!==habitKey ||
             anchor.counterId!==ref.link.spCounterId||
             anchor.sourceId!==spec.sourceId||
             anchor.spec!==JSON.stringify(spec)||anchor.day!==day ||
             !alfAutoHabitSameNumber(anchor.expectedNumber,before) ||
             !Number.isSafeInteger(anchor.expectedRaw)||countData.raw<anchor.expectedRaw) {
            stats.conflicts++;continue;
          }
        } else if(!(before===null||before===0||
          alfAutoHabitSameNumber(before,countData.value))) {
          // No adopted baseline for this existing positive Notion count.
          // Never silently overwrite manual/historical progress.
          stats.conflicts++;continue;
        }
        if(before!==null && before>countData.value+0.000001){
          stats.conflicts++;continue;
        }
        const needsWrite=before===null || countData.value>before+0.000001;
        if(!needsWrite) {
          if(!anchor){
            const next={version:1,pageId:page.id,habitId:info.habitId,
              counterId:ref.link.spCounterId,sourceId:spec.sourceId,
              spec:JSON.stringify(spec),day,expectedNumber:before,
              expectedRaw:countData.raw};
            await api.persistDataSynced(JSON.stringify(next),anchorKey);
            stats.anchored++;
          } else {stats.unchanged++;}
          continue;
        }
        // Re-read whole day to avoid silently PATCHing a duplicate created
        // after initial preview on this or another device.
        const freshRows=await queryDay(token,spec,day,kind);
        const freshGroup=groupCurrent(freshRows,spec,day).get(habitKey)||[];
        if(freshGroup.length!==1||freshGroup[0].page.id!==page.id){
          stats.conflicts++;continue;
        }
        const latest=await notion(token,'/pages/'+encodeURIComponent(page.id));
        if(!latest||alfAutoUuid(latest.id)!==alfAutoUuid(page.id)||
           alfAutoUuid(latest.parent&&latest.parent.data_source_id)!==spec.sourceId){
          stats.conflicts++;continue;
        }
        const pageInfo=alfAutoHabitPageInfo(latest,spec,day);
        if(!pageInfo || alfAutoUuid(pageInfo.habitId)!==habitKey ||
           !alfAutoHabitSameNumber(pageInfo.before,before)){
          stats.conflicts++;continue;
        }
        const newState=await api.getAppState();
        const latestCount=alfAutoHabitCompatible(newState&&newState.simpleCounters&&
          newState.simpleCounters[ref.link.spCounterId],day,spec.unit);
        if(!latestCount||latestCount.raw!==countData.raw ||
           await api.loadSyncedData(ref.key)!==ref.raw ||
           await api.loadSyncedData(approvalKey)!==approvalRaw ||
           await api.loadSyncedData(anchorKey)!==rawAnchor ||
           await api.getSecret(ALF_AUTO_HABIT_FLAG)!=='enabled'){
          stats.conflicts++;continue;
        }
        const patch={properties:{}};
        patch.properties[spec.ids.countId]={number:countData.value};
        const response=await notion(token,'/pages/'+encodeURIComponent(page.id),'PATCH',patch);
        if(!response||response.object!=='page'||
           alfAutoUuid(response.id)!==alfAutoUuid(page.id))
          throw new Error('Notion habit-day update not confirmed');
        stats.written++;
        const next={version:1,pageId:page.id,habitId:info.habitId,
          counterId:ref.link.spCounterId,sourceId:spec.sourceId,
          spec:JSON.stringify(spec),day,
          expectedNumber:countData.value,expectedRaw:countData.raw};
        await api.persistDataSynced(JSON.stringify(next),anchorKey);
      }catch(_){stats.errors++;}
    }
    cursor=(cursor+count)%items.length;
    return stats;
  }
  async function heartbeat() {
    if(busy)return;
    const now=Date.now();
    if(lastRun&&now-lastRun<ALF_AUTO_PLAN_CHECK_MS)return;
    busy=true;
    try {
      if(await api.getSecret(ALF_AUTO_HABIT_FLAG)!=='enabled')return;
      lastRun=now;
      const stats=await runOnce();
      await alfStoreAutoStatus(api,'habits',stats);
    }catch(_) {
      try {await alfStoreAutoStatus(api,'habits',{errors:1});}catch(_){}
      if(api.log&&typeof api.log.warn==='function')
        api.log.warn('[Alf] Automatic existing habit-day export skipped');
    }finally{busy=false;}
  }
  function start() {
    if(interval!==null||typeof setInterval!=='function')return;
    interval=setInterval(()=>{void heartbeat();},60000);
    void heartbeat();
  }
  function stop(){
    if(interval!==null&&typeof clearInterval==='function')clearInterval(interval);
    interval=null;
  }
  return {runOnce,start,stop,heartbeat};
}

if (typeof PluginAPI !== 'undefined' && typeof PluginAPI.onReady==='function') {
  const alfAutomaticPlan=alfCreateAutoPlanSync(PluginAPI);
  const alfAutomaticTime=alfCreateAutoTimeSync(PluginAPI);
  const alfAutomaticHabits=alfCreateAutoHabitSync(PluginAPI);
  PluginAPI.onReady(()=>{
    alfAutomaticPlan.start();
    alfAutomaticTime.start();
    alfAutomaticHabits.start();
  });
  if(typeof PluginAPI.onUnload==='function')
    PluginAPI.onUnload(()=>{
      alfAutomaticPlan.stop();
      alfAutomaticTime.stop();
      alfAutomaticHabits.stop();
    });
}
