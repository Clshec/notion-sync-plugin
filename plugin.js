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
    return api.request('https://api.notion.com/v1'+path, {
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
      await runOnce();
    } catch (_) {
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
  return {runOnce,start,stop};
}

if (typeof PluginAPI !== 'undefined' && typeof PluginAPI.onReady==='function') {
  const alfAutomaticPlan=alfCreateAutoPlanSync(PluginAPI);
  PluginAPI.onReady(()=>alfAutomaticPlan.start());
  if(typeof PluginAPI.onUnload==='function')
    PluginAPI.onUnload(()=>alfAutomaticPlan.stop());
}
