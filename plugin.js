// Alf Notion Super Productivity — action-observed focus sessions (alpha).
// No Notion writes, no timer control, no background polling.
// Only sessions whose start AND completion were seen with an unambiguous
// task and mode are recorded. No historical backfill is possible.
// Original MIT copyright remains in LICENSE (Alessio Lovato).
'use strict';

// SP 20.0.0 deliberately filters setSecret/getSecret/deleteSecret out of the
// iframe API. This small same-plugin message bridge invokes the OFFICIAL
// host-side PluginAPI instead. The credential never enters synced metadata,
// and saved token values are never returned to the iframe.
const ALF_HOST_RPC_CHANNEL = 'alf-notion-host-rpc-v1';
const ALF_OWN_IFRAME_MARKER =
  '<meta name="alf-plugin-owner" content="alf-notion-super-productivity">';
const ALF_LOCAL_RPC_KEY_RE =
  /^alf-(?:notion-token|auto-plan-local-enabled-v1|auto-time-local-enabled-v1|auto-habit-local-enabled-v1|auto-habit-local-scope-v1|auto-graph-local-enabled-v1|auto-graph-cutover-v1|auto-graph-parent-v1|auto-pomo-log-local-enabled-v1|auto-status-local-v1-(?:planning|time|habits|graph))$/;

function alfHostRpcOwnsSource(source, doc) {
  if (!source || !doc || typeof doc.querySelectorAll !== 'function') return false;
  return Array.from(doc.querySelectorAll('iframe')).some((frame) =>
    frame.contentWindow === source &&
    typeof frame.srcdoc === 'string' &&
    frame.srcdoc.includes(ALF_OWN_IFRAME_MARKER));
}

function alfHostNotionMethodAllowed(path, method, body) {
  if (typeof path !== 'string' || path.length > 180) return false;
  const source = /^\/data_sources\/[a-f0-9-]{32,36}$/i.test(path);
  const dayQuery = /^\/data_sources\/[a-f0-9-]{32,36}\/query$/i.test(path);
  const page = /^\/pages\/[a-f0-9-]{32,36}$/i.test(path);
  if (method === 'GET') return (source || page) && body === undefined;
  if (method === 'POST') {
    if (path === '/search') {
      return !!body && typeof body === 'object' &&
        Object.keys(body).every((key) =>
          ['page_size','start_cursor','filter'].includes(key)) &&
        body.filter && body.filter.property === 'object' &&
        body.filter.value === 'data_source' &&
        Object.keys(body.filter).length === 2 &&
        Number.isSafeInteger(body.page_size) &&
        body.page_size >= 1 && body.page_size <= 100 &&
        (body.start_cursor === undefined ||
          (typeof body.start_cursor === 'string' &&
           body.start_cursor.length > 0 && body.start_cursor.length <= 200));
    }
    return dayQuery && body && typeof body === 'object';
  }
  if (method !== 'PATCH' || !page || !body || typeof body !== 'object') return false;
  // Alf only updates exactly one existing Number or Status/Select property
  // after a separate reviewed UI action, never arbitrary Notion page content.
  const props = body.properties;
  if (!props || typeof props !== 'object' || Object.keys(props).length !== 1 ||
      Object.keys(body).some((key) => key !== 'properties')) return false;
  const value = props[Object.keys(props)[0]];
  return !!value && typeof value === 'object' && (
    (Object.keys(value).length === 1 && typeof value.number === 'number' &&
      Number.isFinite(value.number)) ||
    (Object.keys(value).length === 1 && value.status &&
      typeof value.status.name === 'string') ||
    (Object.keys(value).length === 1 && value.select &&
      typeof value.select.name === 'string')
  );
}

// Reserved, deterministic IDs make a reviewed retry idempotent and keep
// original Notion definition identity separate from the day-row identity.
function alfDailySpCounterId(definitionId) {
  const id=alfNormalizeId(definitionId);
  return id ? 'alfn-'+id : '';
}
function alfHostPinnedPageProperty(page, binding, sourceId) {
  if(!binding || typeof binding.id!=='string' ||
     alfNormalizeId(binding.sourceId)!==sourceId)return null;
  const matches=Object.values(page&&page.properties||{}).filter(
    (p)=>p&&p.id===binding.id);
  return matches.length===1?matches[0]:null;
}
async function alfCreateReviewedDailyCounter(api,args) {
  if(!args || Object.keys(args).sort().join(',')!==
      'day,definitionId,pageId,title' ||
     !/^\d{4}-\d{2}-\d{2}$/.test(args.day||'') ||
     typeof args.title!=='string' || !args.title.trim() ||
     args.title.length>160)throw new Error('Invalid reviewed daily counter request');
  const counterId=alfDailySpCounterId(args.definitionId);
  const pageId=alfNormalizeId(args.pageId);
  if(!counterId||!pageId)throw new Error('Invalid original Notion identity');
  const ctx=await api.getDayContext();
  if(!ctx || ctx.todayStr!==args.day)
    throw new Error('SP logical day changed; review today again');
  const configRaw=await api.loadSyncedData('alf-mapping-v2');
  const config=configRaw?JSON.parse(configRaw):null;
  if(!config||!config.alfProfile ||
     config.alfProfile.name!=='alf-life-os')
    throw new Error('Verified Alf mapping required');
  const sourceId=alfNormalizeId(config.taskSource);
  const occ=config.habitPropertyBindings&&config.habitPropertyBindings.occurrences;
  const task=config.taskPropertyBindings;
  if(!sourceId||!occ||!task)
    throw new Error('Pinned board properties required');
  const token=await api.getSecret('alf-notion-token');
  if(!token)throw new Error('Local Notion token is missing');
  const request=async(path,method='GET',body)=>{
    const opts={method,headers:{Authorization:'Bearer '+token,
      'Notion-Version':'2026-03-11','Content-Type':'application/json'},
      timeout:30000,responseType:'json'};
    if(body!==undefined)opts.body=body;
    return api.request('https://api.notion.com/v1'+path,opts);
  };
  const page=await request('/pages/'+pageId);
  if(!page||page.object!=='page'||page.in_trash ||
     alfNormalizeId(page.id)!==pageId ||
     alfNormalizeId(page.parent&&page.parent.data_source_id)!==sourceId)
    throw new Error('Original daily board page moved or unavailable');
  const title=alfHostPinnedPageProperty(page,task.titleProp,sourceId);
  const type=alfHostPinnedPageProperty(page,occ.habitOccTypeProp,sourceId);
  const day=alfHostPinnedPageProperty(page,occ.habitOccDayProp,sourceId);
  const relation=alfHostPinnedPageProperty(page,occ.habitOccRelationProp,sourceId);
  const originalTitle=title&&title.type==='title' ?
    (title.title||[]).map(t=>t.plain_text||t.text&&t.text.content||'').join('') : '';
  if(originalTitle!==args.title ||
     !type || type.type!=='multi_select' ||
     !(type.multi_select||[]).some(x=>x.name==='عادة') ||
     !day || day.type!=='date'||!day.date ||
     day.date.start!==args.day||day.date.end ||
     !relation||relation.type!=='relation' ||
     !Array.isArray(relation.relation)||relation.relation.length!==1 ||
     alfNormalizeId(relation.relation[0].id)!==alfNormalizeId(args.definitionId))
    throw new Error('Daily board title/type/date/relation changed; review again');
  // All records for this day must be seen. Never choose one page from a
  // truncated inventory, or create against duplicated daily occurrences.
  const filter={and:[
    {property:occ.habitOccTypeProp.id,multi_select:{contains:'عادة'}},
    {property:occ.habitOccDayProp.id,date:{equals:args.day}}
  ]};
  let cursor=null,total=0,matched=0,found=false,sameTitle=0;
  const seenCursors=new Set();
  const normalizedTitle=s=>s.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
  do {
    const body={filter,page_size:100};
    if(cursor)body.start_cursor=cursor;
    const data=await request('/data_sources/'+sourceId+'/query','POST',body);
    if(!data||!Array.isArray(data.results) ||
       data.has_more && (!data.next_cursor||seenCursors.has(data.next_cursor)))
      throw new Error('Incomplete daily board inventory');
    for(const row of data.results){
      total++;
      const rowTitle=alfHostPinnedPageProperty(row,task.titleProp,sourceId);
      const text=rowTitle&&rowTitle.type==='title'
        ?(rowTitle.title||[]).map(t=>t.plain_text||t.text&&t.text.content||'').join('')
        :'';
      if(text&&normalizedTitle(text)===normalizedTitle(args.title))sameTitle++;
      const rel=alfHostPinnedPageProperty(row,occ.habitOccRelationProp,sourceId);
      if(rel&&rel.type==='relation'&&Array.isArray(rel.relation)&&
         rel.relation.some(x=>alfNormalizeId(x.id)===alfNormalizeId(args.definitionId))){
        matched++;
        if(alfNormalizeId(row.id)===pageId)found=true;
      }
    }
    if(total>=300 && data.has_more)
      throw new Error('Daily board inventory truncated');
    cursor=data.has_more?data.next_cursor:null;
    if(cursor)seenCursors.add(cursor);
  }while(cursor);
  if(matched!==1||!found||sameTitle!==1)
    throw new Error('Duplicate/moved/ambiguous daily habit; counter not created');
  const all=await api.getAllSimpleCounters();
  if(!Array.isArray(all))throw new Error('SP counter inventory unavailable');
  if(all.some(x=>x&&x.id!==counterId&&normalizedTitle(x.title||'')===normalizedTitle(args.title)))
    throw new Error('Existing SP counter title already present; use it instead');
  const existing=all.find(x=>x&&x.id===counterId);
  if(existing&&existing.type!=='ClickCounter')
    throw new Error('Reserved counter ID belongs to a different counter type');
  // SP 20's setCounter() creates missing counters via the NON-PERSISTENT
  // upsertSimpleCounter action. That briefly looks successful, but the new
  // counter disappears after op-log hydration / SuperSync restart. Creating
  // one here is DATA LOSS, not a usable sync. Only native Habits UI uses the
  // persistent addSimpleCounter action; it can then be matched by unique name.
  // Never issue a non-persistent create, even with explicit checkbox consent.
  if(!existing)
    throw new Error('SP 20 counter creation is non-persistent; use native Habits and re-preview');
  if(existing.title!==args.title)
    throw new Error('Reserved SP counter title differs; no rename permitted');
  return {counterId,created:false};
}

// Zero-config ALF profile. Names/types/relations are the schema contract,
// NEVER hard-coded tenant data-source IDs. Search sees only shared sources.
const ALF_EXPECTED_SOURCE_TITLES = Object.freeze({
  board:'اللوح',
  habits:'قاعدة العادات',
  upper:'المستويات العليا',
  lower:'المستويات الفرعية'
});
const ALF_TASK_PROFILE_FIELDS = Object.freeze({
  titleProp:['المصدر','title'],
  typeProp:['نوع الصفحة','multi_select'],
  executionProp:['يوم التنفيذ','date'],
  estimateProp:['الوقت المخطط له','number'],
  actualProp:['الوقت الفعلي','number'],
  statusProp:['Status','status'],
  projectProp:['العنصر الفرعي','relation'],
  parentProp:['الحزمة الأب','relation']
});
const ALF_HABIT_DEFINITION_FIELDS = Object.freeze({
  habitTitleProp:['العادة','title'],
  habitCadenceProp:['التكرار','select']
});
const ALF_HABIT_OCCURRENCE_FIELDS = Object.freeze({
  habitOccTypeProp:['نوع الصفحة','multi_select'],
  habitOccRelationProp:['قاعدة العادات','relation'],
  habitOccDayProp:['يوم التنفيذ','date']
});

function alfNormalizeId(id) {
  return typeof id === 'string' &&
    /^[a-f0-9]{8}(?:-?[a-f0-9]{4}){3}-?[a-f0-9]{12}$/i.test(id) ?
    id.replace(/-/g,'').toLowerCase() : '';
}
function alfSourceTitle(source) {
  if (!source || typeof source !== 'object') return '';
  if (typeof source.name === 'string') return source.name.trim();
  if (Array.isArray(source.title)) return source.title.map((part) =>
    typeof part.plain_text === 'string' ? part.plain_text :
      part.text && typeof part.text.content === 'string' ?
        part.text.content : '').join('').trim();
  return '';
}
function alfRequiredField(schema,name,type,role) {
  const field=schema && schema[name];
  if (!field || field.type !== type || typeof field.id !== 'string' || !field.id)
    throw new Error('ALF_DISCOVERY_SCHEMA: '+role+' / '+name);
  return field;
}
function alfAssertRelation(field,target,role) {
  const relation=field.relation||{};
  const bySource=alfNormalizeId(relation.data_source_id);
  if (bySource && bySource !== alfNormalizeId(target.id))
    throw new Error('ALF_DISCOVERY_RELATION: '+role);
  const byDatabase=alfNormalizeId(relation.database_id);
  const parentDatabase=alfNormalizeId(
    target.parent && target.parent.database_id);
  if (byDatabase && parentDatabase && byDatabase !== parentDatabase)
    throw new Error('ALF_DISCOVERY_RELATION: '+role);
}
function alfBindFields(schema,defs,sourceId,role) {
  const values={},bindings={};
  for (const [key,[name,type]] of Object.entries(defs)) {
    const field=alfRequiredField(schema,name,type,role);
    values[key]=name;
    bindings[key]={sourceId,input:name,id:field.id};
  }
  return {values,bindings};
}
function alfAssertOptions(field,required,role) {
  const options=field[field.type] && field[field.type].options;
  if (Array.isArray(options)) for (const value of required) {
    if (!options.some((opt)=>opt && opt.name === value))
      throw new Error('ALF_DISCOVERY_OPTIONS: '+role+' / '+value);
  }
}
function alfBuildProfileFromSources(sources) {
  const ids={}, schemas={};
  for (const [role,title] of Object.entries(ALF_EXPECTED_SOURCE_TITLES)) {
    const source=sources[role];
    if (!source || source.object!=='data_source' ||
        alfSourceTitle(source)!==title || !alfNormalizeId(source.id))
      throw new Error('ALF_DISCOVERY_SCHEMA: '+title+' source mismatch');
    ids[role]=alfNormalizeId(source.id);
    schemas[role]=source.properties||{};
  }
  const board=schemas.board,habits=schemas.habits;
  const tasks=alfBindFields(board,ALF_TASK_PROFILE_FIELDS,ids.board,'اللوح');
  const habitDefinitions=alfBindFields(
    habits,ALF_HABIT_DEFINITION_FIELDS,ids.habits,'قاعدة العادات');
  const occurrences=alfBindFields(
    board,ALF_HABIT_OCCURRENCE_FIELDS,ids.board,'عادات اللوح');
  // Check both project/folder hierarchies without turning knowledge into tasks.
  for (const role of ['upper','lower']) {
    alfRequiredField(schemas[role],'Name','title',ALF_EXPECTED_SOURCE_TITLES[role]);
    alfRequiredField(schemas[role],'النظام' in schemas[role]?'النظام':'النوع  ',
      role==='upper'?'select':'multi_select',ALF_EXPECTED_SOURCE_TITLES[role]);
  }
  alfAssertRelation(board['قاعدة العادات'],sources.habits,'اللوح → قاعدة العادات');
  alfAssertRelation(board['العنصر الفرعي'],sources.lower,'اللوح → المستويات الفرعية');
  alfAssertRelation(board['الحزمة الأب'],sources.board,'الحزمة الأب');
  const back=alfRequiredField(habits,'اللوح','relation','قاعدة العادات');
  alfAssertRelation(back,sources.board,'قاعدة العادات → اللوح');
  const lowerParent=alfRequiredField(
    schemas.lower,'العنصر الأب','relation','المستويات الفرعية');
  alfAssertRelation(lowerParent,sources.upper,'المستويات الفرعية → العليا');
  const upperChildren=alfRequiredField(
    schemas.upper,'العناصر الفرعية','relation','المستويات العليا');
  alfAssertRelation(upperChildren,sources.lower,'المستويات العليا → الفرعية');
  alfAssertOptions(board['نوع الصفحة'],['مهمة','حزمة','عادة'],'نوع الصفحة');
  alfAssertOptions(board['Status'],['Done','Not started','In progress'],'Status');
  const config=Object.assign({
    version:2,taskSource:ids.board,habitSource:ids.habits,
    projectSource:ids.lower,
    typeValues:'مهمة, حزمة',bundleValues:'حزمة',
    completedValues:'Done',
    // Alf current board has NO separate deadline, priority, completed
    // Pomodoro history or numeric habit-day count. Never invent fields.
    deadlineProp:'',priorityProp:'',priorityHigh:'',
    priorityMedium:'',priorityLow:'',observedPomoProp:'',
    habitOccCountProp:'',unit:'hours',pomodoroWorkMinutes:'25',
    habitOccTypeValue:'عادة',
    habitOccUnit:'count',
    habitDoneStatusValue:'Done',
    habitOpenStatusValues:'Not started, In progress',
    taskPropertyBindings:tasks.bindings,
    habitPropertyBindings:{
      definitions:habitDefinitions.bindings,
      occurrences:occurrences.bindings
    },
    alfProfile:{
      name:'alf-life-os',version:1,
      upperSource:ids.upper,lowerSource:ids.lower,
      detectedFrom:'notion-search-and-live-schema',
      writebackEnabled:false
    }
  },tasks.values,habitDefinitions.values,occurrences.values);
  return {
    config,
    names:Object.values(ALF_EXPECTED_SOURCE_TITLES),
    totalFields:Object.keys(tasks.bindings).length+
      Object.keys(habitDefinitions.bindings).length+
      Object.keys(occurrences.bindings).length
  };
}

async function alfDiscoverProfile(api) {
  const token=await api.getSecret('alf-notion-token');
  if (!token) throw new Error('Save a local Notion token first');
  const headers={
    Authorization:'Bearer '+token,'Notion-Version':'2026-03-11',
    'Content-Type':'application/json'
  };
  async function request(path,method,body){
    const opts={method,headers,timeout:30000,responseType:'json'};
    if(body!==undefined)opts.body=body;
    return await api.request('https://api.notion.com/v1'+path,opts);
  }
  const candidates=[],seen=new Set();
  let cursor=null,finished=false;
  for(let page=0;page<5;page++){
    const body={
      page_size:100,filter:{property:'object',value:'data_source'}
    };
    if(cursor)body.start_cursor=cursor;
    const response=await request('/search','POST',body);
    if(!response || !Array.isArray(response.results))
      throw new Error('ALF_DISCOVERY_RESPONSE: invalid Notion search result');
    for(const item of response.results){
      if(!item || item.object!=='data_source' || !alfNormalizeId(item.id))
        continue;
      const id=alfNormalizeId(item.id);
      if(!seen.has(id)){seen.add(id);candidates.push(item);}
    }
    if(!response.has_more){finished=true;break;}
    if(typeof response.next_cursor!=='string'||!response.next_cursor||
       response.next_cursor===cursor)
      throw new Error('ALF_DISCOVERY_RESPONSE: missing search cursor');
    cursor=response.next_cursor;
  }
  if(!finished)throw new Error('ALF_DISCOVERY_LIMIT: inventory exceeds 500 sources');
  const found={},missing=[];
  for(const [role,title] of Object.entries(ALF_EXPECTED_SOURCE_TITLES)){
    const matches=candidates.filter((item)=>alfSourceTitle(item)===title);
    if(matches.length>1)throw new Error('ALF_DISCOVERY_AMBIGUOUS: '+title);
    if(!matches.length){missing.push(title);continue;}
    const id=alfNormalizeId(matches[0].id);
    const source=await request('/data_sources/'+id,'GET');
    if(!source || alfNormalizeId(source.id)!==id ||
       !source.properties || typeof source.properties!=='object')
      throw new Error('ALF_DISCOVERY_SCHEMA: '+title+' unavailable');
    // Some Notion versions omit a data-source title on Retrieve; Search
    // supplies the unambiguous authoritative name in that case.
    found[role]=Object.assign({},source,{
      title:alfSourceTitle(source) ? source.title : matches[0].title,
      name:alfSourceTitle(source)||alfSourceTitle(matches[0])
    });
  }
  if(missing.length)
    throw new Error('ALF_DISCOVERY_MISSING: '+missing.join('، '));
  return alfBuildProfileFromSources(found);
}

function alfCreateHostRpcHandler(api, doc) {
  const inflightCounters=new Set();
  let graphReview=null;
  return async function onAlfIframeMessage(event) {
    const req = event && event.data;
    if (!req || req.channel !== ALF_HOST_RPC_CHANNEL ||
        req.type !== 'request' || typeof req.id !== 'string' ||
        req.id.length > 120 ||
        !alfHostRpcOwnsSource(event.source, doc)) return;
    const args = req.args && typeof req.args === 'object' ? req.args : {};
    let value, error = null;
    try {
      if (['getSecret', 'setSecret', 'deleteSecret'].includes(req.op)) {
        if (typeof args.key !== 'string' ||
            !ALF_LOCAL_RPC_KEY_RE.test(args.key))
          throw new Error('Unsupported Alf local key');
        if (req.op === 'getSecret') {
          const stored = await api.getSecret(args.key);
          // No saved Notion integration token is ever sent back into HTML.
          value = args.key === 'alf-notion-token' ?
            (stored ? 'configured' : null) : stored;
        } else if (req.op === 'setSecret') {
          if (typeof args.value !== 'string' || !args.value ||
              args.value.length > 8192)
            throw new Error('Invalid local secret value');
          await api.setSecret(args.key, args.value);
          value = true;
        } else {
          await api.deleteSecret(args.key);
          value = true;
        }
      } else if (req.op === 'discover') {
        if (Object.keys(args).length)
          throw new Error('Unsupported Alf discovery options');
        value=await alfDiscoverProfile(api);
      } else if (req.op === 'createDailyCounter') {
        const target=alfDailySpCounterId(args.definitionId);
        if(!target||inflightCounters.has(target))
          throw new Error('Counter import in progress; refresh preview');
        inflightCounters.add(target);
        try {
          value=await alfCreateReviewedDailyCounter(api,args);
        }finally{
          inflightCounters.delete(target);
        }
      } else if (req.op === 'graphPreview') {
        if(Object.keys(args).length)throw new Error('Unsupported graph preview arguments');
        const inventory=await alfGraphInventory(api);
        const plan=await alfGraphPlan(api,inventory);
        graphReview={fingerprint:plan.fingerprint,issuedAt:Date.now(),
          inventory,plan};
        value=alfGraphPublicReview(plan);
      } else if (req.op === 'graphFastProbe') {
        if(Object.keys(args).length)
          throw new Error('Unexpected fast graph probe arguments');
        const began=Date.now();
        const signature=await alfGraphQuickProbe(api);
        value={ok:true,elapsedMs:Date.now()-began,
          incomplete:signature===null};
      } else if (req.op === 'graphApply') {
        if(!['import','export','pomodoro'].includes(args.mode) ||
            !Object.keys(args).every(k=>['fingerprint','mode','upperParentId','spTaskId'].includes(k)) ||
            args.fingerprint!==
            (graphReview&&graphReview.fingerprint) ||
            Date.now()-graphReview.issuedAt>5*60*1000)
          throw new Error('A fresh graph preview is required');
        // Single-use: a failed request must never cause blind replays.
        const reviewed=graphReview;
        graphReview=null;
        const current=await alfGraphInventory(api);
        const fresh=await alfGraphPlan(api,current);
        if(fresh.fingerprint!==reviewed.fingerprint ||
           fresh.signature!==reviewed.plan.signature)
          throw new Error('Graph changed after review; no writes');
        if(args.spTaskId && (args.mode!=='export' ||
            !fresh.exportsTasks.some(t=>t.spId===args.spTaskId)))
          throw new Error('Selected SP task is not in the fresh graph review');
        value=args.mode==='import'?
          await alfGraphApplyLocal(api,current,fresh):
          args.mode==='export'?
            await alfGraphApplyRemote(api,current,fresh,args.upperParentId,
              args.spTaskId?{taskId:args.spTaskId,maxWrites:1}:{}):
            await alfGraphApplyPomodoro(api,current,fresh);
      } else if (req.op === 'notion') {
        const method = args.method || 'GET';
        if (!alfHostNotionMethodAllowed(args.path, method, args.body))
          throw new Error('Notion request outside Alf approved paths');
        const token = await api.getSecret('alf-notion-token');
        if (!token) throw new Error('Save a local Notion token first');
        const opts = {method,headers:{
          Authorization:'Bearer '+token,
          'Notion-Version':'2026-03-11',
          'Content-Type':'application/json'
        },timeout:30000,responseType:'json'};
        if (args.body !== undefined) opts.body = args.body;
        value = await api.request('https://api.notion.com/v1'+args.path,opts);
      } else {
        throw new Error('Unsupported Alf RPC operation');
      }
    } catch (e) {
      const status = Number(e && (e.status || e.statusCode ||
        (e.response && e.response.status)));
      // Never return a raw HTTP error body, Authorization header or token.
      error = Number.isInteger(status) && status >= 400 && status <= 599 ?
        'Notion HTTP '+status+' (verify integration permissions/source)' :
        (String(e && e.message || '').startsWith('Notion request outside') ||
         String(e && e.message || '').startsWith('Save a local Notion') ||
         String(e && e.message || '').startsWith('Unsupported Alf') ||
         String(e && e.message || '').startsWith('Invalid local secret') ||
         String(e && e.message || '').startsWith('ALF_DISCOVERY_') ?
          String(e.message) : 'Alf local operation failed; check Notion/API connectivity');
    }
    try {
      event.source.postMessage({
        channel:ALF_HOST_RPC_CHANNEL,type:'response',id:req.id,
        ok:error===null,value:error===null?value:null,error
      },'*');
    } catch (_) { /* iframe navigated away; no credentials logged */ }
  };
}

function alfStartHostRpcBridge(api) {
  if (typeof window === 'undefined' || typeof document === 'undefined' ||
      typeof window.addEventListener !== 'function') return () => {};
  const handler = alfCreateHostRpcHandler(api,document);
  window.addEventListener('message',handler);
  return () => window.removeEventListener('message',handler);
}

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
  const alfStopHostRpcBridge = alfStartHostRpcBridge(PluginAPI);
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
  // A textual error is NOT proof that the HTTP server rejected a PATCH.
  // A broken connection may mention "rate limit" after Notion committed it.
  // Re-attempt only with explicit, machine-readable HTTP 429 status.
  return code===429;
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
  for(const key of ['processed','updated','written','timeWritten','anchored','skipped',
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
  const spec={sourceId, input, ids, unit:c.unit, allowed};
  if(c.alfProfile && c.alfProfile.name==='alf-life-os')
    spec.excludedHabit=c.habitOccTypeValue||'عادة';
  return spec;
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
  if(spec.excludedHabit && values.includes(spec.excludedHabit))return false;
  return values.some(value => spec.allowed.includes(value));
}
function alfAutoCurrentPlan(task) {
  return {title:task.title,
    timeEstimate:typeof task.timeEstimate === 'number' ? task.timeEstimate : null,
    dueDay:task.dueDay ?? null, dueWithTime:task.dueWithTime ?? null};
}
function alfAutoSingleNotionMarker(task,notionId) {
  if(!task||typeof task.notes!=='string'||typeof notionId!=='string')return false;
  const markers=task.notes.split(/\s+/).filter(t=>t.startsWith('alf-notion-page-id:'));
  return markers.length===1&&markers[0]==='alf-notion-page-id:'+notionId;
}
function alfAutoTaskMatches(task,anchor) {
  if(!task || task.id !== anchor.spId || task.isDone === true || task.repeatCfgId ||
    (task.projectId ?? null) !== anchor.projectId ||
    (task.parentId ?? null) !== anchor.parentId ||
    typeof task.notes !== 'string') return false;
  return alfAutoSingleNotionMarker(task,anchor.notionId);
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
  const observedId=c.observedPomoProp&&pinned('observedPomoProp');
  if(c.observedPomoProp && (c.actualProp===c.observedPomoProp ||
      (observedId&&observedId===actualId)))
    throw new Error('Actual tracked time and observed Pomodoro count cannot share a Notion Number property');
  const spec={sourceId,typeId,actualId,unit:c.unit,allowed};
  if(c.alfProfile && c.alfProfile.name==='alf-life-os')
    spec.excludedHabit=c.habitOccTypeValue||'عادة';
  return spec;
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
  return alfAutoSingleNotionMarker(task,anchor.notionId);
}
function alfAutoTimePage(page,spec,notionId) {
  if(!page || page.object!=='page' || page.in_trash ||
     alfAutoUuid(page.id)!==alfAutoUuid(notionId) ||
     alfAutoUuid(page.parent&&page.parent.data_source_id)!==spec.sourceId)return null;
  const t=alfAutoProp(page,spec.typeId);
  const typeValues=t&&t.type==='multi_select'?
    (t.multi_select||[]).map(x=>x.name):
    t&&t.type==='select'&&t.select?[t.select.name]:[];
  if(spec.excludedHabit && typeValues.includes(spec.excludedHabit))return null;
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
const ALF_AUTO_HABIT_DEVICE_SCOPE_KEY='alf-auto-habit-local-scope-v1';
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
  const actual=c.taskPropertyBindings&&c.taskPropertyBindings.actualProp;
  if(c.actualProp &&
     (c.habitOccCountProp===c.actualProp ||
      (actual && actual.sourceId===sourceId && actual.input===c.actualProp &&
       actual.id===ids.countId)) &&
     (c.habitOccUnit==='count'||c.habitOccUnit!==c.unit))
    throw new Error('Habit Counter cannot overwrite incompatible work-time Number unit');
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
    let spec,kind,day,allPages,linksById,duplicateCounters,scope,scopeRaw;
    try {
      const configRaw=await api.loadSyncedData(ALF_AUTO_PLAN_MAPPING_KEY);
      const config=configRaw?JSON.parse(configRaw):null;
      // Alf's authoritative habit execution source is the dated BOARD row,
      // not a definition. Legacy definition-based unattended writes are unsafe
      // for this profile until a day-record-id based reconciliation is proven.
      if(config&&config.alfProfile&&config.alfProfile.name==='alf-life-os'){
        stats.enabled=false;stats.conflicts++;return stats;
      }
      spec=alfAutoHabitSpec(config);
      // Synced approval history is NOT a device grant. Only the latest
      // local scope explicitly reviewed on THIS device permits a write.
      scopeRaw=await api.getSecret(ALF_AUTO_HABIT_DEVICE_SCOPE_KEY);
      scope=scopeRaw?JSON.parse(scopeRaw):null;
      if(!scope || scope.version!==1 ||
         scope.spec!==JSON.stringify(spec) ||
         !Array.isArray(scope.grants) || !scope.grants.length ||
         scope.grants.some(g=>!g || typeof g.habitId!=='string' ||
           !g.habitId || typeof g.counterId!=='string' || !g.counterId))
        throw new Error('Missing current device-only habit scope; re-review and consent');
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
      if(!scope.grants.some(g=>g.habitId===info.habitId &&
           g.counterId===ref.link.spCounterId)) {
        stats.conflicts++;continue;
      }
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
           await api.getSecret(ALF_AUTO_HABIT_DEVICE_SCOPE_KEY)!==scopeRaw ||
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

// v0.36: original life-OS project/task graph. No data-source migrations.
// The upper project/folder hierarchy remains in Notion. Only verified lower
// projects become SP Projects; board bundles become SP parent tasks and board
// tasks with an original bundle relation become SP subtasks. Knowledge,
// learning and folders never become SP tasks. Pure habits remain counters;
// dated board rows explicitly typed BOTH habit and task are also real tasks.
const ALF_GRAPH_PROJECT_LINK_PREFIX='alf-graph-project-v1-';
const ALF_GRAPH_MAX_ROWS=2500;
const ALF_GRAPH_MAX_WRITES_PER_REVIEW=12;
function alfGraphId(x){return alfNormalizeId(x);}
function alfGraphDashedId(id){
  const n=alfGraphId(id);
  if(!n)return '';
  return n.slice(0,8)+'-'+n.slice(8,12)+'-'+n.slice(12,16)+'-'+
    n.slice(16,20)+'-'+n.slice(20);
}
function alfGraphTitle(p,name) {
  const t=p&&p.properties&&p.properties[name];
  return t&&Array.isArray(t.title) ?
    t.title.map(x=>x.plain_text||(x.text&&x.text.content)||'').join('').trim() : '';
}
function alfGraphRelation(p,name) {
  const x=p&&p.properties&&p.properties[name];
  return x&&x.type==='relation'&&Array.isArray(x.relation)?
    x.relation.map(v=>alfGraphId(v.id)).filter(Boolean):[];
}
function alfGraphKinds(p,name) {
  const x=p&&p.properties&&p.properties[name];
  return x&&x.type==='multi_select'&&Array.isArray(x.multi_select)?
    x.multi_select.map(v=>v.name).filter(v=>typeof v==='string'):[];
}
function alfGraphStatus(p,name) {
  const v=p&&p.properties&&p.properties[name];
  return v&&v.status&&typeof v.status.name==='string'?v.status.name:'';
}
function alfGraphName(x){return String(x||'').trim().replace(/\s+/g,' ').toLowerCase();}
function alfGraphSourceConfig(raw) {
  const c=typeof raw==='string'?JSON.parse(raw):raw;
  if(!c||c.version!==2||!c.alfProfile||c.alfProfile.name!=='alf-life-os')
    throw new Error('Verified Alf one-token profile required for graph synchronization');
  const ids={board:alfGraphId(c.taskSource),
    lower:alfGraphId(c.alfProfile.lowerSource),
    upper:alfGraphId(c.alfProfile.upperSource)};
  if(Object.values(ids).some(v=>!v))
    throw new Error('Verified original project and board data sources required');
  for(const key of Object.keys(ALF_TASK_PROFILE_FIELDS)){
    const binding=c.taskPropertyBindings&&c.taskPropertyBindings[key];
    if(!binding||alfGraphId(binding.sourceId)!==ids.board||
      binding.input!==c[key]||typeof binding.id!=='string'||!binding.id)
      throw new Error('Pinned board property ID missing: '+key);
  }
  return {ids,c};
}
function alfGraphField(page,c,key){
  const binding=c.taskPropertyBindings[key];
  const matches=Object.values(page&&page.properties||{}).filter(
    v=>v&&v.id===binding.id);
  return matches.length===1?matches[0]:null;
}
function alfGraphItem(page,c){
  const title=alfGraphField(page,c,'titleProp');
  const type=alfGraphField(page,c,'typeProp');
  const project=alfGraphField(page,c,'projectProp');
  const parent=alfGraphField(page,c,'parentProp');
  const status=alfGraphField(page,c,'statusProp');
  const estimate=alfGraphField(page,c,'estimateProp');
  const date=alfGraphField(page,c,'executionProp');
  if(!title||title.type!=='title'||!type||type.type!=='multi_select'||
     !project||project.type!=='relation'||!parent||parent.type!=='relation'||
     !status||status.type!=='status'||!estimate||estimate.type!=='number'||
     !date||date.type!=='date')throw new Error('Board pinned schema mismatch');
  const kinds=type.multi_select.map(v=>v.name);
  // A daily board occurrence can legitimately be both a habit and a task.
  // Import its task facet by exact page identity; the independent habit
  // reconciler must still use the same original day occurrence.
  if(!kinds.some(v=>v==='مهمة'||v==='حزمة'))return null;
  const projects=(project.relation||[]).map(v=>alfGraphId(v.id)).filter(Boolean);
  const parents=(parent.relation||[]).map(v=>alfGraphId(v.id)).filter(Boolean);
  const t=(title.title||[]).map(v=>v.plain_text||(v.text&&v.text.content)||'').join('').trim();
  const estimateHours=estimate.number;
  if(!['hours','minutes'].includes(c.unit))
    throw new Error('Unknown original Notion work time unit');
  if(estimateHours!==null&&estimateHours!==undefined&&
     (typeof estimateHours!=='number'||!Number.isFinite(estimateHours)||
      estimateHours<0))throw new Error('Invalid Notion task time estimate');
  const due=date.date&&date.date.start||'';
  return {id:alfGraphId(page.id),title:t,kinds,projects,parents,
    createdAt:Date.parse(page.created_time)||null,
    status:status.status&&status.status.name||'',
    estimateMs:typeof estimateHours==='number'&&Number.isFinite(estimateHours)&&
      estimateHours>=0?Math.round(estimateHours*(c.unit==='hours'?3600000:60000)):null,
    due:/^\d{4}-\d{2}-\d{2}$/.test(due)?due:null};
}
function alfGraphSpecHeaders(token) {
  return {Authorization:'Bearer '+token,'Notion-Version':'2026-03-11',
    'Content-Type':'application/json'};
}
async function alfGraphRequest(api,token,path,method='GET',body) {
  const opts={method,headers:alfGraphSpecHeaders(token),timeout:30000,
    responseType:'json'};
  if(body!==undefined)opts.body=body;
  return await alfQueuedNotionRequest(api,'https://api.notion.com/v1'+path,opts);
}
// Lightweight incremental change detection for Notion. It does NOT replace
// the full authoritative graph scan on a change. The full scan is kept so
// identity resolution, parent relations and duplicate checks remain sound.
// An externally configured verified Notion webhook can later wake the same
// reconciliation loop; this short poll is a local fallback, not a webhook.
async function alfGraphQuickProbe(api,options={}){
  if(typeof api.getSecret!=='function'||typeof api.loadSyncedData!=='function')
    throw new Error('Missing scoped graph probe APIs');
  const token=await api.getSecret('alf-notion-token');
  if(!token)throw new Error('Notion token missing for graph probe');
  const mapping=alfGraphSourceConfig(await api.loadSyncedData('alf-mapping-v2'));
  const now=Number.isFinite(options.now)?options.now:Date.now();
  const since=new Date(now-10*60*1000).toISOString();
  const edited={timestamp:'last_edited_time',
    last_edited_time:{on_or_after:since}};
  const result=[];
  for(const [type,source] of Object.entries(mapping.ids)){
    const filter=type==='board'?{and:[edited,{or:[
      {property:mapping.c.typeProp,multi_select:{contains:'مهمة'}},
      {property:mapping.c.typeProp,multi_select:{contains:'حزمة'}}
    ]}]}:edited;
    const rows=await alfGraphRequest(api,token,'/data_sources/'+source+'/query',
      'POST',{filter,page_size:25,
        sorts:[{timestamp:'last_edited_time',direction:'descending'}]});
    if(!rows||!Array.isArray(rows.results)||rows.results.length>25||
       typeof rows.has_more!=='boolean')
      throw new Error('Incomplete graph change probe response');
    if(rows.has_more)return null; // Force an authoritative scan.
    for(const p of rows.results){
      const id=alfGraphId(p&&p.id);
      if(!id||typeof p.last_edited_time!=='string')
        throw new Error('Unverifiable graph update timestamp');
      result.push([type,id,p.last_edited_time]);
    }
  }
  return JSON.stringify(result.sort((a,b)=>a[0].localeCompare(b[0])||
    a[1].localeCompare(b[1])));
}
async function alfGraphAll(api,token,source,filter,maxRows=ALF_GRAPH_MAX_ROWS) {
  const result=[],seen=new Set();let cursor=null;
  for(let n=0;n<Math.ceil(maxRows/100);n++){
    const body={page_size:Math.min(100,maxRows-result.length)};
    if(filter)body.filter=filter;
    if(cursor)body.start_cursor=cursor;
    const page=await alfGraphRequest(api,token,
      '/data_sources/'+source+'/query','POST',body);
    if(!page||!Array.isArray(page.results)||page.results.length>body.page_size)
      throw new Error('Invalid Notion graph inventory response');
    for(const entry of page.results) {
      const id=alfGraphId(entry&&entry.id);
      if(!id||seen.has(id))throw new Error('Duplicate or invalid graph page ID');
      seen.add(id);result.push(entry);
    }
    if(!page.has_more)return result;
    if(!page.next_cursor||page.next_cursor===cursor||
       typeof page.next_cursor!=='string')
      throw new Error('Invalid Notion graph cursor');
    cursor=page.next_cursor;
  }
  throw new Error('Graph inventory incomplete; refuses partial synchronization');
}
async function alfGraphInventory(api) {
  if(typeof api.getSecret!=='function'||typeof api.loadSyncedData!=='function'||
     typeof api.getAllProjects!=='function'||typeof api.getTasks!=='function'||
     typeof api.getArchivedTasks!=='function'||typeof api.request!=='function')
    throw new Error('SP graph host capabilities missing');
  const [token,raw]=await Promise.all([
    api.getSecret('alf-notion-token'),api.loadSyncedData('alf-mapping-v2')]);
  if(!token)throw new Error('No local Notion token');
  const cfg=alfGraphSourceConfig(raw);
  const ids=cfg.ids;
  const [upperSchema,lowerSchema,boardSchema]=await Promise.all([
    alfGraphRequest(api,token,'/data_sources/'+ids.upper),
    alfGraphRequest(api,token,'/data_sources/'+ids.lower),
    alfGraphRequest(api,token,'/data_sources/'+ids.board)]);
  const need=(source,defs)=>{
    const props=source&&source.properties||{};
    for(const [name,type] of defs){
      if(!props[name]||props[name].type!==type)
        throw new Error('Notion graph source changed: '+name);
    }
  };
  need(upperSchema,[['Name','title'],['النظام','select']]);
  need(lowerSchema,[['Name','title'],['العنصر الأب','relation'],
    ['النوع  ','multi_select']]);
  need(boardSchema,Object.values(ALF_TASK_PROFILE_FIELDS));
  for(const [key] of Object.entries(ALF_TASK_PROFILE_FIELDS)) {
    const match=alfAutoProp(boardSchema,cfg.c.taskPropertyBindings[key].id);
    if(!match||match.type!==ALF_TASK_PROFILE_FIELDS[key][1])
      throw new Error('Original pinned board schema changed');
  }
  const [upper,lower,board,spProjects,spActive,spArchive]=await Promise.all([
    alfGraphAll(api,token,ids.upper),
    alfGraphAll(api,token,ids.lower),
    alfGraphAll(api,token,ids.board,{or:[
      {property:'نوع الصفحة',multi_select:{contains:'مهمة'}},
      {property:'نوع الصفحة',multi_select:{contains:'حزمة'}}
    ]}),api.getAllProjects(),api.getTasks(),api.getArchivedTasks()]);
  if(!Array.isArray(spProjects)||!Array.isArray(spActive)||!Array.isArray(spArchive))
    throw new Error('SP project/task inventories unavailable');
  const upperChoices=upper.filter(p=>
    p&&p.properties&&p.properties['النظام']&&
    p.properties['النظام'].select&&
    p.properties['النظام'].select.name==='مشروع')
    .map(p=>({id:alfGraphId(p.id),name:alfGraphTitle(p,'Name')}))
    .filter(p=>p.id&&p.name);
  const upperProjects=new Set(upperChoices.map(p=>p.id));
  const projectRows=await Promise.all(lower.map(async p=>{
    if(p.in_trash)return null;
    const name=alfGraphTitle(p,'Name');
    const kinds=alfGraphKinds(p,'النوع  ');
    const parents=alfGraphRelation(p,'العنصر الأب');
    const folderParent=alfGraphRelation(p,'المجلد الأب الفرعي');
    if(!name||name.length>160||parents.length>1||folderParent.length||
       kinds.some(k=>['مجلد رئيسي','مجلد فرعي','كورس','دبلومة',
         'فيديو','مصدر مقالات'].includes(k)))return null;
    const validUpper=parents.length===1&&upperProjects.has(parents[0]);
    // SP projects imported without a chosen upper project are stored as
    // *unassigned* small projects in this same original lower database.
    // Only our independently persisted SP identity allows that exception.
    // Never adopt arbitrary unparented Notion notes/folders as projects.
    let knownOrigin=false;
    if(parents.length===0){
      const raw=await api.loadSyncedData(
        ALF_GRAPH_PROJECT_LINK_PREFIX+alfGraphId(p.id));
      if(raw){
        let link;
        try{link=JSON.parse(raw);}catch(_){}
        knownOrigin=!!(link&&link.version===1&&
          link.notionId===alfGraphId(p.id)&&
          typeof link.spId==='string'&&link.spId);
      }
    }
    if(!validUpper&&!knownOrigin)return null;
    return {id:alfGraphId(p.id),name,parent:parents[0]||null,
      createdAt:Date.parse(p.created_time)||null};
  }));
  const projects=projectRows.filter(Boolean);
  const tasks=board.map(p=>p.in_trash?null:alfGraphItem(p,cfg.c)).filter(Boolean);
  if(tasks.some(t=>!t.id))
    throw new Error('Invalid original board task IDs');
  return {ids,c:cfg.c,token,projects,tasks,upperChoices,spProjects,
    spActive,spArchive};
}
function alfGraphMarker(notionId){return 'alf-notion-page-id:'+alfGraphDashedId(notionId);}
function alfGraphTaskLinkKey(nid){
  return ALF_AUTO_PLAN_LINK_PREFIX+alfGraphDashedId(nid);
}
async function alfGraphExistingTaskLink(api,id){
  // v0.35 stored Notion ids in their original hyphenated API form.
  const primary=await api.loadSyncedData(alfGraphTaskLinkKey(id));
  if(primary)return primary;
  return await api.loadSyncedData(ALF_AUTO_PLAN_LINK_PREFIX+alfGraphId(id));
}
function alfGraphTaskClaim(t,id) {
  const notes=typeof (t&&t.notes)==='string'?t.notes:'';
  return notes.split(/\s+/).some(v=>v.startsWith('alf-notion-page-id:')&&
    alfGraphId(v.slice('alf-notion-page-id:'.length))===id);
}
function alfGraphSignature(plan){
  return JSON.stringify({projects:plan.projects,tasks:plan.tasks,
    exportsProjects:plan.exportsProjects,exportsTasks:plan.exportsTasks,
    upperChoices:plan.upperChoices,observedFocus:plan.observedFocus,
    skipped:plan.skipped});
}
function alfGraphFingerprint(signature){
  // Non-secret short review label. The host also compares the exact signature.
  let h=2166136261;
  for(let i=0;i<signature.length;i++){
    h^=signature.charCodeAt(i);h=Math.imul(h,16777619);
  }
  return 'graph-'+(h>>>0).toString(16).padStart(8,'0')+'-'+signature.length;
}
async function alfGraphPlan(api,inventory){
  const {projects,tasks,spProjects,spActive,spArchive}=inventory;
  const projectLinks=new Map(),taskLinks=new Map();
  // Aggregated, non-identifying eligibility diagnostics from actual original
  // source rows. A total skipped count alone hides systemic mapping errors.
  const skipped={projects:0,tasks:0,conflicts:0,reasons:{
    title:0,multiProject:0,unknownProject:0,multiParent:0,
    status:0,estimate:0,oldDone:0,missingLinkedTask:0,
    incompleteIdentity:0,other:0}};
  const actions={projects:[],tasks:[],exportsProjects:[],
    exportsTasks:[],upperChoices:inventory.upperChoices||[],skipped,
    observedFocus:[],scannedTasks:tasks.length};
  const mappedSp=new Set();
  for(const p of projects) {
    const raw=await api.loadSyncedData(ALF_GRAPH_PROJECT_LINK_PREFIX+p.id);
    const link=raw?JSON.parse(raw):null;
    if(link&&(link.version!==1||link.notionId!==p.id||
       typeof link.spId!=='string'))
      throw new Error('Corrupted SP project link; no synchronization');
    if(link) {
      const sp=spProjects.filter(x=>x&&x.id===link.spId);
      if(sp.length!==1||mappedSp.has(link.spId)){
        skipped.conflicts++;continue;
      }
      projectLinks.set(p.id,link.spId);
      mappedSp.add(link.spId);
    }else{
      const equal=spProjects.filter(x=>x&&alfGraphName(x.title)===
        alfGraphName(p.name));
      if(equal.length>1 || (equal.length===1&&mappedSp.has(equal[0].id))){
        skipped.conflicts++;continue;
      }
      if(equal.length===1) {
      actions.projects.push({id:p.id,name:p.name,parent:p.parent,
          createdAt:p.createdAt,
          adoptSpId:equal[0].id});
        mappedSp.add(equal[0].id);
      } else actions.projects.push({id:p.id,name:p.name,
        parent:p.parent,createdAt:p.createdAt});
    }
  }
  const active=[...spActive,...spArchive],seenTasks=new Set();
  for(const t of tasks) {
    const failure=(!t.title||t.title.length>250)?'title':
      t.projects.length>1?'multiProject':
      (t.projects.length===1&&!projects.some(p=>p.id===t.projects[0]))?'unknownProject':
      t.parents.length>1?'multiParent':
      !['Done','Not started','In progress','Planned'].includes(t.status)?'status':
      (t.estimateMs!==null&&!Number.isSafeInteger(t.estimateMs))?'estimate':null;
    if(failure){skipped.tasks++;skipped.reasons[failure]++;continue;}
    const claims=active.filter(sp=>alfGraphTaskClaim(sp,t.id));
    const raw=await alfGraphExistingTaskLink(api,t.id);
    const link=raw?JSON.parse(raw):null;
    if(link&&(alfGraphId(link.notionId)!==t.id||
      typeof link.spId!=='string'))
      throw new Error('Invalid original task identity link');
    if(claims.length>1||
       (claims.length===1&&link&&claims[0].id!==link.spId)){
      skipped.conflicts++;continue;
    }
    const existing=link?active.filter(sp=>sp.id===link.spId):claims;
    if(existing.length===1) {
      if(!alfGraphTaskClaim(existing[0],t.id)||seenTasks.has(existing[0].id)){
        skipped.conflicts++;continue;
      }
      // Marker-only candidates are not authorized for automatic status or
      // time writeback until an independently saved ID link exists.
      if(!link){skipped.tasks++;skipped.reasons.incompleteIdentity++;continue;}
      seenTasks.add(existing[0].id);taskLinks.set(t.id,existing[0].id);
      continue;
    }
    if(link){skipped.tasks++;skipped.reasons.missingLinkedTask++;continue;}
    // Historical completed Notion tasks are real records too. Import them
    // completed via the native SP API, never as active work for Today.
    const pendingAdopt=actions.projects.find(p=>
      p.id===t.projects[0]&&p.adoptSpId);
    const potentialProject=t.projects.length===0?'INBOX_PROJECT':
      projectLinks.get(t.projects[0])||
      (pendingAdopt&&pendingAdopt.adoptSpId);
    if(potentialProject && active.some(sp=>
      sp&&sp.projectId===potentialProject&&
      alfGraphName(sp.title)===alfGraphName(t.title)&&
      // A repeated task has a distinct Notion page per day. A prior-day
      // SP task with the same title must not block today's occurrence.
      // If either date is unknown or both dates match, stay fail-closed.
      !(t.due && typeof sp.dueDay==='string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(sp.dueDay) && sp.dueDay!==t.due))) {
      skipped.conflicts++;continue;
    }
    const isSub=t.parents.length===1;
    if(isSub) {
      const parent=tasks.find(x=>x.id===t.parents[0]);
      if(!parent||!parent.kinds.includes('حزمة')||parent.parents.length||
         parent.projects.length!==t.projects.length||
         (t.projects.length&&parent.projects[0]!==t.projects[0])){
        skipped.conflicts++;continue;
      }
    }
    actions.tasks.push({id:t.id,title:t.title,project:t.projects[0]||null,
      parent:t.parents[0]||null,kind:isSub?'subtask':'task',
      createdAt:t.createdAt,
      isBundle:t.kinds.includes('حزمة'),
      estimateMs:t.estimateMs,due:t.due,status:t.status});
  }
  actions.tasks.sort((a,b)=>Number(!!a.parent)-Number(!!b.parent));
  // SP-created projects have no upper-level identity. Never guess a Notion
  // parent; a user must choose an EXISTING parent with النظام=مشروع.
  const knownSpProjects=new Set([...mappedSp,...actions.projects
    .filter(p=>p.adoptSpId).map(p=>p.adoptSpId)]);
  for(const sp of spProjects) {
    if(!sp||typeof sp.id!=='string'||!sp.id||
       sp.id==='INBOX_PROJECT'||sp.isArchived===true||
       typeof sp.title!=='string'||!sp.title.trim()||
       sp.title.length>160||knownSpProjects.has(sp.id))continue;
    if(projects.some(p=>alfGraphName(p.name)===alfGraphName(sp.title))){
      skipped.conflicts++;continue;
    }
    actions.exportsProjects.push({spId:sp.id,title:sp.title,
      createdAt:typeof sp.created==='number'&&Number.isFinite(sp.created)?
        sp.created:null});
  }
  const seenSpIds=new Set(),linkedSpTasks=new Set(taskLinks.values());
  const allProjectIds=new Set(spProjects.map(p=>p.id));
  for(const sp of spActive){
    if(!sp||typeof sp.id!=='string'||!sp.id||seenSpIds.has(sp.id)||
       linkedSpTasks.has(sp.id)||
       typeof sp.title!=='string'||!sp.title.trim()||
       sp.title.length>250||
       (!allProjectIds.has(sp.projectId)&&sp.projectId!=='INBOX_PROJECT')||
       (spProjects.find(p=>p.id===sp.projectId)||{}).isArchived===true||
       sp.isRepeat||sp.repeatCfgId)continue;
    seenSpIds.add(sp.id);
    // Any Notion identity in notes is not ours to overwrite or recreate.
    if(typeof sp.notes==='string'&&sp.notes.includes('alf-notion-page-id:'))continue;
    // Existing same-title tasks on BOTH sides may be unrelated or may be
    // pre-link twins. Do not create a second entity in either direction.
    const possibleNotion=tasks.some(t=>{
      if(alfGraphName(t.title)!==alfGraphName(sp.title))return false;
      if(!t.projects.length)return sp.projectId==='INBOX_PROJECT';
      const candidate=projectLinks.get(t.projects[0])||
        (actions.projects.find(p=>p.id===t.projects[0])||{}).adoptSpId;
      return candidate===sp.projectId;
    });
    if(possibleNotion){skipped.conflicts++;continue;}
    if(sp.parentId){
      const parent=spActive.find(t=>t.id===sp.parentId);
      if(!parent||parent.projectId!==sp.projectId||parent.parentId){
        skipped.conflicts++;continue;
      }
    }
    actions.exportsTasks.push({spId:sp.id,title:sp.title,
      spProjectId:sp.projectId,parentSpId:sp.parentId||null,
      created:typeof sp.created==='number'&&Number.isFinite(sp.created)?
        sp.created:0,
      isDone:sp.isDone===true,notes:typeof sp.notes==='string'?sp.notes:'',
      timeSpent:sp.timeSpent||0,timeEstimate:sp.timeEstimate||0,
      dueDay:sp.dueDay||null,
      isBundle:Array.isArray(sp.subTaskIds)&&sp.subTaskIds.length>0});
  }
  actions.exportsTasks.sort((a,b)=>Number(!!a.parentSpId)-Number(!!b.parentSpId));
  // Observed focus action-hook sessions are only a confirmed lower bound;
  // nothing is inferred from timeSpent or calendar days.
  if(typeof api.listSyncedDataKeys==='function'){
    const keys=await api.listSyncedDataKeys(ALF_FOCUS_KEY_PREFIX);
    if(!Array.isArray(keys)||keys.length>2000)
      throw new Error('Focus session inventory truncated or unavailable');
    const seen=new Set(),counts=new Map();
    for(const key of keys) {
      if(typeof key!=='string'||!key.startsWith(ALF_FOCUS_KEY_PREFIX))continue;
      const raw=await api.loadSyncedData(key);
      if(!raw)continue;
      let record;
      try{record=JSON.parse(raw);}catch(_){continue;}
      if(!record||record.schemaVersion!==1||
         typeof record.sessionId!=='string'||
         key!==ALF_FOCUS_KEY_PREFIX+record.sessionId||
         seen.has(record.sessionId)||
         record.source!=='live-sp-action-hook'||
         record.mode!=='Pomodoro'||record.automatic!==true||
         record.manual!==false||record.observedCompletion!==true||
         record.verifiedCompletedPomodoro!==true||
         typeof record.taskId!=='string'||
         !Number.isFinite(record.startedAt)||!Number.isFinite(record.endedAt)||
         record.endedAt<record.startedAt)continue;
      seen.add(record.sessionId);
      counts.set(record.taskId,(counts.get(record.taskId)||0)+1);
    }
    actions.observedFocus=[...taskLinks].filter(([,spId])=>counts.has(spId))
      .map(([notionId,spId])=>({notionId,spId,
        observedMinimum:counts.get(spId)}));
  }
  actions.signature=alfGraphSignature(actions);
  actions.fingerprint=alfGraphFingerprint(actions.signature);
  actions.links={projects:projectLinks,tasks:taskLinks};
  return actions;
}
function alfGraphPublicReview(p){
  return {fingerprint:p.fingerprint,
    projects:p.projects.slice(0,40),tasks:p.tasks.slice(0,40),
    exportsProjects:p.exportsProjects.slice(0,40),
    exportsTasks:p.exportsTasks.slice(0,40),
    observedFocus:p.observedFocus.slice(0,40),
    upperChoices:p.upperChoices,
    totals:{projects:p.projects.length,tasks:p.tasks.length,
      scannedTasks:p.scannedTasks,
      exportProjects:p.exportsProjects.length,
      exportTasks:p.exportsTasks.length,
      linkedObservedPomodoroTasks:p.observedFocus.length,
      reviewTruncated:[p.projects,p.tasks,p.exportsProjects,
        p.exportsTasks].some(items=>items.length>40),
      skipped:p.skipped,limited:p.projects.length+p.tasks.length>
        ALF_GRAPH_MAX_WRITES_PER_REVIEW},
    note:'Two directions have independently reviewed create actions; observed Pomodoros are a lower bound, never complete history'};
}
async function alfGraphApplyLocal(api,inventory,plan,options={}) {
  if(typeof api.addProject!=='function'||typeof api.addTask!=='function'||
     typeof api.persistDataSynced!=='function')
    throw new Error('Official SP project/task create API unavailable');
  const result={projects:0,tasks:0,skipped:0,errors:0,
    note:'No Notion writes; re-preview to reconcile changes'};
  const pids=new Map(plan.links.projects), tids=new Map(plan.links.tasks);
  // Never create a second SP project if a same-title project now exists.
  let writeSlots=Number.isInteger(options.maxWrites)&&options.maxWrites>=1?
    Math.min(options.maxWrites,ALF_GRAPH_MAX_WRITES_PER_REVIEW):
    ALF_GRAPH_MAX_WRITES_PER_REVIEW;
  for(const p of plan.projects){
    if(!writeSlots)break;
    const all=await api.getAllProjects();
    if(p.adoptSpId){
      const match=all.filter(x=>x.id===p.adoptSpId&&
        alfGraphName(x.title)===alfGraphName(p.name));
      if(match.length!==1){result.skipped++;continue;}
      try {
        await api.persistDataSynced(JSON.stringify({version:1,notionId:p.id,
          spId:p.adoptSpId}),ALF_GRAPH_PROJECT_LINK_PREFIX+p.id);
        await api.persistDataSynced(JSON.stringify({version:1,
          notionId:p.id,spId:p.adoptSpId,sourceId:inventory.ids.lower,
          title:p.name}),ALF_GRAPH_PROJECT_TITLE_ANCHOR_PREFIX+p.id);
        pids.set(p.id,p.adoptSpId);result.projects++;writeSlots--;
      }catch(_){result.errors++;}
      continue;
    }
    if(all.some(x=>alfGraphName(x.title)===alfGraphName(p.name))){
      result.skipped++;continue;
    }
    try{
      const id=await api.addProject({title:p.name});
      if(typeof id!=='string'||!id)throw new Error('SP project creation not confirmed');
      await api.persistDataSynced(JSON.stringify({version:1,notionId:p.id,
        spId:id}),ALF_GRAPH_PROJECT_LINK_PREFIX+p.id);
      await api.persistDataSynced(JSON.stringify({version:1,
        notionId:p.id,spId:id,sourceId:inventory.ids.lower,
        title:p.name}),ALF_GRAPH_PROJECT_TITLE_ANCHOR_PREFIX+p.id);
      pids.set(p.id,id);result.projects++;writeSlots--;
    }catch(_){result.errors++;}
  }
  for(const t of plan.tasks){
    if(!writeSlots)break;
    const projectId=t.project?pids.get(t.project):null;
    if(t.project&&!projectId){result.skipped++;continue;}
    const parentId=t.parent?tids.get(t.parent):null;
    if(t.parent&&!parentId){result.skipped++;continue;}
    const all=[...(await api.getTasks()||[]),...(await api.getArchivedTasks()||[])];
    const claims=all.filter(x=>alfGraphTaskClaim(x,t.id));
    if(claims.length){
      result.skipped++;continue;
    }
    // Recheck titles AFTER every native mutation. Two original Notion pages
    // created for one day must not bypass duplicate detection merely because
    // neither existed in the first inventory snapshot. Distinct dated
    // occurrences (e.g. yesterday/today الحمد) remain independent.
    const targetProject=projectId||'INBOX_PROJECT';
    const sameDayCollision=all.some(sp=>
      sp&&(sp.projectId||'INBOX_PROJECT')===targetProject&&
      alfGraphName(sp.title)===alfGraphName(t.title)&&
      !(t.due&&typeof sp.dueDay==='string'&&
        /^\d{4}-\d{2}-\d{2}$/.test(sp.dueDay)&&sp.dueDay!==t.due));
    if(sameDayCollision){result.skipped++;continue;}
    const linkKey=alfGraphTaskLinkKey(t.id);
    if(await alfGraphExistingTaskLink(api,t.id)){result.skipped++;continue;}
    try{
      const isDone=t.status==='Done';
      const payload={title:t.title,notes:alfGraphMarker(t.id),
        isIgnoreShortSyntax:true,isDone,
        // Explicit null prevents SP inheriting Today's planning date when
        // the original Notion task has no date.
        dueDay:t.due||null};
      if(projectId)payload.projectId=projectId;
      if(t.estimateMs!==null)payload.timeEstimate=t.estimateMs;
      if(parentId)payload.parentId=parentId;
      const id=await api.addTask(payload);
      if(typeof id!=='string'||!id)throw new Error('SP task creation not confirmed');
      await api.persistDataSynced(JSON.stringify({version:1,
        notionId:alfGraphDashedId(t.id),
        spId:id}),linkKey);
      // A newly created identity is a known synchronized baseline.
      // Establish it before the user's first completion toggle; otherwise
      // an edit before the next full poll is misclassified as a conflict.
      if(['Not started','In progress','Done'].includes(t.status)) {
        await api.persistDataSynced(JSON.stringify({version:1,
          notionId:t.id,spId:id,sourceId:inventory.ids.board,
          spDone:isDone,notionStatus:t.status}),
        ALF_GRAPH_STATUS_ANCHOR_PREFIX+t.id);
      }
      await api.persistDataSynced(JSON.stringify({version:1,
        notionId:t.id,spId:id,sourceId:inventory.ids.board,
        values:{title:t.title,estimateMs:t.estimateMs??0,
          due:t.due||null}}),ALF_GRAPH_TASK_FIELDS_ANCHOR_PREFIX+t.id);
      await api.persistDataSynced(JSON.stringify({version:1,
        notionId:t.id,spId:id,sourceId:inventory.ids.board,
        project:t.project||null}),ALF_GRAPH_TASK_PROJECT_ANCHOR_PREFIX+t.id);
      tids.set(t.id,id);result.tasks++;writeSlots--;
    }catch(_){result.errors++;}
  }
  return result;
}
// Reverse creation is intentionally a separate, explicitly reviewed command.
// Notion has no atomic create-if-absent key. Persist an attempted SP identity
// BEFORE POST; on timeout/unknown response never retry it automatically.
const ALF_GRAPH_PROJECT_INTENT_PREFIX='alf-graph-project-export-v1-';
const ALF_GRAPH_TASK_INTENT_PREFIX='alf-graph-task-export-v1-';
const ALF_GRAPH_STATUS_ANCHOR_PREFIX='alf-graph-status-v1-';
const ALF_GRAPH_TIME_ANCHOR_PREFIX='alf-graph-time-v1-';
const ALF_GRAPH_PROJECT_TITLE_ANCHOR_PREFIX='alf-graph-project-title-v1-';
const ALF_GRAPH_TASK_FIELDS_ANCHOR_PREFIX='alf-graph-fields-v1-';
const ALF_GRAPH_TASK_PROJECT_ANCHOR_PREFIX='alf-graph-task-project-v1-';
const ALF_GRAPH_AUTO_KEY='alf-auto-graph-local-enabled-v1';
const ALF_GRAPH_CUTOVER_KEY='alf-auto-graph-cutover-v1';
const ALF_GRAPH_AUTO_PARENT_KEY='alf-auto-graph-parent-v1';
const ALF_POMO_AUTO_KEY='alf-auto-pomo-log-local-enabled-v1';
function alfGraphSpId(id){
  if(typeof id!=='string'||!id||id.length>120||/\s/.test(id))
    throw new Error('Invalid SP entity identity');
  return id;
}
function alfGraphReverseProjectMap(plan){
  return new Map([...plan.links.projects].map(([notionId,spId])=>[spId,notionId]));
}
async function alfGraphApplyRemote(api,inventory,plan,upperParentId,options={}){
  if(typeof api.persistDataSynced!=='function'||typeof api.updateTask!=='function')
    throw new Error('Official SP mapping and task-update capabilities required');
  const upper=alfGraphId(upperParentId);
  if(upperParentId && !plan.upperChoices.some(p=>p.id===upper))
    throw new Error('Select an existing Notion project parent, never a folder');
  const counts={projects:0,tasks:0,skipped:0,errors:0,pending:0,
    reasons:{},note:'SP to Notion reviewed create, no retry of ambiguous POST'};
  const skip=reason=>{
    counts.skipped++;
    counts.reasons[reason]=(counts.reasons[reason]||0)+1;
  };
  const pids=alfGraphReverseProjectMap(plan);
  const notionTaskIds=new Map([...plan.links.tasks].map(([nid,sid])=>[sid,nid]));
  const {c,ids,token}=inventory;
  let slots=Number.isInteger(options.maxWrites)&&options.maxWrites>=1?
    Math.min(options.maxWrites,ALF_GRAPH_MAX_WRITES_PER_REVIEW):
    ALF_GRAPH_MAX_WRITES_PER_REVIEW;
  const projectsToExport=options.taskId?[]:plan.exportsProjects;
  const tasksToExport=options.taskId?
    plan.exportsTasks.filter(t=>t.spId===options.taskId):
    options.preferNewest?
      plan.exportsTasks.slice().sort((a,b)=>
        Number(!!a.parentSpId)-Number(!!b.parentSpId)||
        b.created-a.created):
      plan.exportsTasks;
  for(const project of projectsToExport){
    if(!slots)break;
    const spId=alfGraphSpId(project.spId);
    const key=ALF_GRAPH_PROJECT_INTENT_PREFIX+spId;
    // An earlier operation may have committed despite a lost response.
    if(await api.loadSyncedData(key)){counts.pending++;continue;}
    const others=await api.getAllProjects();
    if(!others.some(p=>p.id===spId&&p.title===project.title)){
      skip('projectChanged');continue;
    }
    // The promise below can resolve after Notion has already created a page.
    // An attempted ledger prevents a second create when the outcome is unknown.
    await api.persistDataSynced(JSON.stringify({version:1,status:'attempted',
      spId,sourceId:ids.lower,parent:upper||null}),key);
    slots--;
    try{
      const properties={
        'Name':{title:[{text:{content:project.title}}]}
      };
      // Never guess a major parent. Unassigned is still a real native
      // small-project row in the existing lower Notion source; its stored
      // SP ID makes it unambiguous on the next discovery.
      if(upper)properties['العنصر الأب']={relation:[{id:upper}]};
      const page=await alfGraphRequest(api,token,'/pages','POST',{
        parent:{type:'data_source_id',data_source_id:ids.lower},
        properties
      });
      const nid=alfGraphId(page&&page.id);
      if(!nid||alfGraphId(page&&page.parent&&page.parent.data_source_id)!==ids.lower)
        throw new Error('Unconfirmed Notion project create');
      await api.persistDataSynced(JSON.stringify({version:1,notionId:nid,
        spId}),ALF_GRAPH_PROJECT_LINK_PREFIX+nid);
      await api.persistDataSynced(JSON.stringify({version:1,
        notionId:nid,spId,sourceId:ids.lower,title:project.title}),
      ALF_GRAPH_PROJECT_TITLE_ANCHOR_PREFIX+nid);
      await api.persistDataSynced(JSON.stringify({version:1,status:'committed',
        spId,notionId:nid,sourceId:ids.lower,parent:upper||null}),key);
      pids.set(spId,nid);counts.projects++;
    }catch(_){counts.errors++;counts.pending++;}
  }
  for(const t of tasksToExport){
    if(!slots)break;
    const spId=alfGraphSpId(t.spId);
    const isInbox=t.spProjectId==='INBOX_PROJECT';
    const notionProject=pids.get(t.spProjectId);
    if(!notionProject&&!isInbox){skip('unlinkedProject');continue;}
    const notionParent=t.parentSpId?notionTaskIds.get(t.parentSpId):null;
    if(t.parentSpId&&!notionParent){skip('unlinkedParentTask');continue;}
    const key=ALF_GRAPH_TASK_INTENT_PREFIX+spId;
    if(await api.loadSyncedData(key)){counts.pending++;continue;}
    const active=await api.getTasks();
    const live=active.filter(x=>x.id===spId);
    if(live.length!==1){skip('taskDisappeared');continue;}
    const now=live[0];
    if(now.title!==t.title){skip('titleChanged');continue;}
    if(now.projectId!==t.spProjectId){skip('projectChanged');continue;}
    if((now.parentId||null)!==t.parentSpId){skip('parentChanged');continue;}
    if((now.isDone===true)!==t.isDone){skip('completionChanged');continue;}
    if((typeof now.notes==='string'?now.notes:'')!==t.notes){
      skip('notesChanged');continue;
    }
    if((now.timeSpent||0)!==t.timeSpent){skip('timeChanged');continue;}
    if((now.timeEstimate||0)!==t.timeEstimate){skip('estimateChanged');continue;}
    if((now.dueDay||null)!==t.dueDay){skip('dueDayChanged');continue;}
    const properties={
      [c.titleProp]:{title:[{text:{content:t.title}}]},
      [c.typeProp]:{multi_select:[{name:t.isBundle?'حزمة':'مهمة'}]},
      [c.statusProp]:{status:{name:t.isDone?'Done':'Not started'}}
    };
    if(notionProject)properties[c.projectProp]={relation:[{id:notionProject}]};
    if(notionParent)properties[c.parentProp]={relation:[{id:notionParent}]};
    if(Number.isSafeInteger(t.timeEstimate)&&t.timeEstimate>0)
      properties[c.estimateProp]={number:t.timeEstimate/
        (c.unit==='hours'?3600000:60000)};
    if(Number.isSafeInteger(t.timeSpent)&&t.timeSpent>0)
      properties[c.actualProp]={number:t.timeSpent/
        (c.unit==='hours'?3600000:60000)};
    if(typeof t.dueDay==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(t.dueDay))
      properties[c.executionProp]={date:{start:t.dueDay}};
    await api.persistDataSynced(JSON.stringify({version:1,status:'attempted',
      spId,sourceId:ids.board,notionProject:notionProject||null}),key);
    slots--;
    try{
      const page=await alfGraphRequest(api,token,'/pages','POST',{
        parent:{type:'data_source_id',data_source_id:ids.board},
        properties
      });
      const nid=alfGraphId(page&&page.id);
      if(!nid||alfGraphId(page&&page.parent&&page.parent.data_source_id)!==ids.board)
        throw new Error('Unconfirmed Notion task creation');
      await api.persistDataSynced(JSON.stringify({version:1,
        notionId:alfGraphDashedId(nid),
        spId}),alfGraphTaskLinkKey(nid));
      // Preserve every existing user note and add only an exact identity marker.
      await api.updateTask(spId,{notes:(t.notes?t.notes.trimEnd()+'\n':'')+
        alfGraphMarker(nid)});
      await api.persistDataSynced(JSON.stringify({version:1,status:'committed',
        notionId:nid,spId,sourceId:ids.board}),key);
      await api.persistDataSynced(JSON.stringify({version:1,
        notionId:nid,spId,sourceId:ids.board,
        spDone:t.isDone,notionStatus:t.isDone?'Done':'Not started'}),
      ALF_GRAPH_STATUS_ANCHOR_PREFIX+nid);
      await api.persistDataSynced(JSON.stringify({version:1,
        notionId:nid,spId,sourceId:ids.board,
        values:{title:t.title,estimateMs:t.timeEstimate||0,
          due:t.dueDay||null}}),ALF_GRAPH_TASK_FIELDS_ANCHOR_PREFIX+nid);
      await api.persistDataSynced(JSON.stringify({version:1,
        notionId:nid,spId,sourceId:ids.board,
        project:notionProject||null}),
      ALF_GRAPH_TASK_PROJECT_ANCHOR_PREFIX+nid);
      notionTaskIds.set(spId,nid);counts.tasks++;
    }catch(_){counts.errors++;counts.pending++;}
  }
  return counts;
}
// Stable Notion ↔ SP small-project title reconciliation. Only the source
// that changed alone from the LAST agreed value may update its peer.
// Conflicting simultaneous edits are intentionally left untouched.
async function alfGraphSyncProjectTitles(api,inventory,plan,options={}){
  const stats={anchored:0,updatedSp:0,writtenNotion:0,
    conflicts:0,skipped:0,errors:0};
  if(typeof api.updateProject!=='function')return {...stats,errors:1};
  const max=Number.isInteger(options.max)&&options.max>0?
    Math.min(options.max,16):4;
  let count=0;
  for(const [notionId,spId] of plan.links.projects){
    if(count++>=max)break;
    const p=inventory.projects.find(x=>x.id===notionId);
    const matches=inventory.spProjects.filter(x=>x&&x.id===spId&&
      x.isArchived!==true);
    if(!p||matches.length!==1||!p.name){stats.skipped++;continue;}
    const sp=matches[0],key=ALF_GRAPH_PROJECT_TITLE_ANCHOR_PREFIX+notionId;
    try{
      const raw=await api.loadSyncedData(key);
      const anchor=raw?JSON.parse(raw):null;
      if(anchor&&(anchor.version!==1||anchor.notionId!==notionId||
         anchor.spId!==spId||anchor.sourceId!==inventory.ids.lower||
         typeof anchor.title!=='string'||!anchor.title)){
        stats.conflicts++;continue;
      }
      if(!anchor){
        if(p.name!==sp.title){stats.conflicts++;continue;}
        await api.persistDataSynced(JSON.stringify({version:1,
          notionId,spId,sourceId:inventory.ids.lower,title:p.name}),key);
        stats.anchored++;continue;
      }
      if(p.name===sp.title){
        if(p.name!==anchor.title){
          await api.persistDataSynced(JSON.stringify({...anchor,title:p.name}),key);
          stats.anchored++;
        }else stats.skipped++;
        continue;
      }
      const notionChanged=p.name!==anchor.title;
      const spChanged=sp.title!==anchor.title;
      if(notionChanged===spChanged){stats.conflicts++;continue;}
      if(notionChanged){
        // A full-graph snapshot is not authority to replace a user's live
        // SP title: the Notion page might have changed or left the set of
        // real small projects during our network round trip.
        const page=await alfGraphRequest(api,inventory.token,
          '/pages/'+notionId);
        const parentIds=page?alfGraphRelation(page,'العنصر الأب'):[];
        const folderIds=page?alfGraphRelation(page,'المجلد الأب الفرعي'):[];
        const kinds=page?alfGraphKinds(page,'النوع  '):[];
        if(!page||page.object!=='page'||page.in_trash||
          alfGraphId(page.id)!==notionId||
          alfGraphId(page.parent&&page.parent.data_source_id)!==
            inventory.ids.lower||
          alfGraphTitle(page,'Name')!==p.name||
          parentIds.length!==(p.parent?1:0)||
          (parentIds[0]||null)!==(p.parent||null)||
          folderIds.length||
          kinds.some(k=>['مجلد رئيسي','مجلد فرعي','كورس',
            'دبلومة','فيديو','مصدر مقالات'].includes(k))){
          stats.conflicts++;continue;
        }
        const fresh=await api.getAllProjects();
        if(!Array.isArray(fresh)||fresh.filter(x=>x.id===spId&&
          x.title===anchor.title).length!==1){stats.conflicts++;continue;}
        await api.updateProject(spId,{title:p.name});
        stats.updatedSp++;
      }else{
        const page=await alfGraphRequest(api,inventory.token,'/pages/'+notionId);
        if(!page||page.object!=='page'||page.in_trash||
          alfGraphId(page.id)!==notionId||
          alfGraphId(page.parent&&page.parent.data_source_id)!==
            inventory.ids.lower||
          alfGraphTitle(page,'Name')!==anchor.title){
          stats.conflicts++;continue;
        }
        const fresh=await api.getAllProjects();
        if(!Array.isArray(fresh)||fresh.filter(x=>x.id===spId&&
          x.title===sp.title).length!==1){stats.conflicts++;continue;}
        const response=await alfGraphRequest(api,inventory.token,
          '/pages/'+notionId,'PATCH',{properties:{
            'Name':{title:[{text:{content:sp.title}}]}
          }});
        if(!response||alfGraphId(response.id)!==notionId)
          throw new Error('Notion project title PATCH outcome unconfirmed');
        stats.writtenNotion++;
      }
      await api.persistDataSynced(JSON.stringify({...anchor,
        title:notionChanged?p.name:sp.title}),key);
    }catch(_){stats.errors++;}
  }
  return stats;
}
// Bidirectional native task title, estimated work and date-only due day.
// One baseline per exact Notion-page/SP-task pair. No last-writer-wins,
// unreviewed rich-text replacement, or rewriting actual tracked work time.
// Parent relations are excluded: SP v20's updateTask explicitly rejects
// parentId mutations because they orphan subtasks without updating the tree.
function alfGraphTaskPlanningValues(notion,sp){
  const n={title:notion.title,estimateMs:notion.estimateMs??0,
    due:notion.due||null};
  if(!sp||typeof sp.title!=='string'||!sp.title.trim()||
     !Number.isSafeInteger(sp.timeEstimate??0)||
     (sp.timeEstimate??0)<0||
     (sp.dueDay && !/^\d{4}-\d{2}-\d{2}$/.test(sp.dueDay))||
     sp.dueWithTime)return null;
  const s={title:sp.title,estimateMs:sp.timeEstimate??0,
    due:sp.dueDay||null};
  return {notion:n,sp:s};
}
async function alfGraphSyncTaskPlanning(api,inventory,plan,options={}){
  const stats={anchored:0,updatedSp:0,writtenNotion:0,
    conflicts:0,skipped:0,errors:0};
  if(typeof api.updateTask!=='function')return {...stats,errors:1};
  if(typeof api.getSecret==='function'&&
     await api.getSecret(ALF_AUTO_PLAN_FLAG)==='enabled')
    return stats; // Older opt-in planning engine owns these fields.
  const max=Number.isInteger(options.max)&&options.max>0?
    Math.min(options.max,20):8;
  let seen=0;
  for(const [notionId,spId] of plan.links.tasks){
    if(seen++>=max)break;
    const n=inventory.tasks.find(p=>p.id===notionId);
    const sp=inventory.spActive.filter(t=>t&&t.id===spId&&
      !t.repeatCfgId&&alfGraphTaskClaim(t,notionId));
    if(!n||sp.length!==1){stats.skipped++;continue;}
    const pair=alfGraphTaskPlanningValues(n,sp[0]);
    if(!pair){stats.skipped++;continue;}
    const key=ALF_GRAPH_TASK_FIELDS_ANCHOR_PREFIX+notionId;
    try{
      const raw=await api.loadSyncedData(key);
      let anchor=raw?JSON.parse(raw):null;
      if(anchor&&(anchor.version!==1||anchor.notionId!==notionId||
         anchor.spId!==spId||anchor.sourceId!==inventory.ids.board||
         !anchor.values||typeof anchor.values.title!=='string'||
         !Number.isSafeInteger(anchor.values.estimateMs)||
         anchor.values.estimateMs<0||
         (anchor.values.due!==null&&typeof anchor.values.due!=='string'))){
        stats.conflicts++;continue;
      }
      const fields=['title','estimateMs','due'];
      if(!anchor){
        if(fields.some(k=>pair.notion[k]!==pair.sp[k])){
          stats.conflicts++;continue; // Cannot infer which old edit wins.
        }
        anchor={version:1,notionId,spId,sourceId:inventory.ids.board,
          values:pair.notion};
        await api.persistDataSynced(JSON.stringify(anchor),key);
        stats.anchored++;continue;
      }
      const toSp={},toNotion={},bothEqual={};
      for(const field of fields){
        const base=anchor.values[field];
        const notion=pair.notion[field],local=pair.sp[field];
        const nc=notion!==base,sc=local!==base;
        if(nc&&sc){
          if(notion===local)bothEqual[field]=notion;
          else stats.conflicts++;
        }else if(nc)toSp[field]=notion;
        else if(sc)toNotion[field]=local;
      }
      let values={...anchor.values,...bothEqual};
      if(Object.keys(toSp).length){
        // Re-fetch the original page before touching SP. A second Notion
        // edit made after inventory collection must not be overwritten by
        // a stale task snapshot, even if it happened a few milliseconds ago.
        const page=await alfGraphRequest(api,inventory.token,
          '/pages/'+notionId);
        const currentNotion=page&&page.object==='page'&&!page.in_trash&&
          alfGraphId(page.id)===notionId&&
          alfGraphId(page.parent&&page.parent.data_source_id)===
            inventory.ids.board?
            alfGraphItem(page,inventory.c):null;
        const sourceUnchanged=!!currentNotion&&
          currentNotion.projects.join(',')===n.projects.join(',')&&
          currentNotion.parents.join(',')===n.parents.join(',')&&
          currentNotion.kinds.slice().sort().join(',')===
            n.kinds.slice().sort().join(',')&&
          fields.every(k=>alfGraphTaskPlanningValues(
            currentNotion,sp[0])?.notion[k]===pair.notion[k]);
        const fresh=await api.getTasks();
        const live=Array.isArray(fresh)?fresh.filter(t=>
          t&&t.id===spId&&alfGraphTaskClaim(t,notionId)):[];
        const current=live.length===1?
          alfGraphTaskPlanningValues(n,live[0]):null;
        if(!sourceUnchanged||!current||Object.keys(toSp).some(k=>
          current.sp[k]!==pair.sp[k])){
          stats.conflicts++;
        }else{
          const changes={};
          if('title' in toSp)changes.title=toSp.title;
          if('estimateMs' in toSp)changes.timeEstimate=toSp.estimateMs;
          if('due' in toSp)changes.dueDay=toSp.due;
          await api.updateTask(spId,changes,{isIgnoreShortSyntax:true});
          values={...values,...toSp};
          stats.updatedSp++;
        }
      }
      if(Object.keys(toNotion).length){
        const page=await alfGraphRequest(api,inventory.token,
          '/pages/'+notionId);
        if(!page||page.object!=='page'||page.in_trash||
          alfGraphId(page.id)!==notionId||
          alfGraphId(page.parent&&page.parent.data_source_id)!==
            inventory.ids.board){
          stats.conflicts++;
        }else{
          const current=alfGraphItem(page,inventory.c);
          const now=current?alfGraphTaskPlanningValues(current,sp[0]):null;
          const live=await api.getTasks();
          const spLive=Array.isArray(live)?live.filter(t=>
            t&&t.id===spId&&alfGraphTaskClaim(t,notionId)):[];
          const latest=current&&spLive.length===1?
            alfGraphTaskPlanningValues(current,spLive[0]):null;
          if(!now||!latest||Object.keys(toNotion).some(k=>
            now.notion[k]!==pair.notion[k]||
            latest.sp[k]!==pair.sp[k])){
            stats.conflicts++;
          }else{
            const props={},pins=inventory.c.taskPropertyBindings;
            if('title' in toNotion)
              props[pins.titleProp.id]={title:[{text:{
                content:toNotion.title}}]};
            if('estimateMs' in toNotion)
              props[pins.estimateProp.id]={number:toNotion.estimateMs?
                toNotion.estimateMs/
                  (inventory.c.unit==='hours'?3600000:60000):null};
            if('due' in toNotion)
              props[pins.executionProp.id]={date:toNotion.due?
                {start:toNotion.due}:null};
            const result=await alfGraphRequest(api,inventory.token,
              '/pages/'+notionId,'PATCH',{properties:props});
            if(!result||alfGraphId(result.id)!==notionId)
              throw new Error('Unconfirmed task planning PATCH');
            values={...values,...toNotion};
            stats.writtenNotion++;
          }
        }
      }
      if(fields.some(k=>values[k]!==anchor.values[k]))
        await api.persistDataSynced(JSON.stringify({...anchor,values}),key);
      else if(!Object.keys(toSp).length&&!Object.keys(toNotion).length)
        stats.skipped++;
    }catch(_){stats.errors++;}
  }
  return stats;
}
// The official SP v20 updateTask API can move a TOP-LEVEL task to another
// project using TaskMoveToProjectService (which preserves its children).
// It must NOT be used to rewrite parentId of an existing subtask.
async function alfGraphSyncTaskProjects(api,inventory,plan,options={}){
  const stats={anchored:0,updatedSp:0,writtenNotion:0,
    conflicts:0,skipped:0,errors:0};
  const toSp=new Map(plan.links.projects);
  const toNotion=new Map([...toSp].map(([notion,sp])=>[sp,notion]));
  const max=Number.isInteger(options.max)&&options.max>0?
    Math.min(options.max,16):4;
  let checked=0;
  for(const [notionId,spId] of plan.links.tasks){
    if(checked++>=max)break;
    const n=inventory.tasks.find(x=>x.id===notionId);
    const sp=inventory.spActive.filter(x=>x&&x.id===spId&&
      !x.repeatCfgId&&alfGraphTaskClaim(x,notionId));
    if(!n||sp.length!==1||n.projects.length>1||
       n.parents.length||sp[0].parentId){
      stats.skipped++;continue; // Subtask moves need a tree API.
    }
    const notion=n.projects[0]||null;
    const sid=sp[0].projectId;
    const local=(!sid||sid==='INBOX_PROJECT')?null:toNotion.get(sid);
    if(local===undefined||notion&&!toSp.has(notion)){
      stats.conflicts++;continue; // Unknown project identity.
    }
    const key=ALF_GRAPH_TASK_PROJECT_ANCHOR_PREFIX+notionId;
    try{
      const raw=await api.loadSyncedData(key);
      const anchor=raw?JSON.parse(raw):null;
      if(anchor&&(anchor.version!==1||anchor.notionId!==notionId||
         anchor.spId!==spId||anchor.sourceId!==inventory.ids.board||
         (anchor.project!==null&&typeof anchor.project!=='string'))){
        stats.conflicts++;continue;
      }
      if(!anchor){
        if(notion!==local){stats.conflicts++;continue;}
        await api.persistDataSynced(JSON.stringify({version:1,
          notionId,spId,sourceId:inventory.ids.board,project:notion}),key);
        stats.anchored++;continue;
      }
      if(notion===local){
        if(notion!==anchor.project){
          await api.persistDataSynced(JSON.stringify({...anchor,
            project:notion}),key);
          stats.anchored++;
        }else stats.skipped++;
        continue;
      }
      const nc=notion!==anchor.project,sc=local!==anchor.project;
      if(nc===sc){stats.conflicts++;continue;}
      if(nc){
        const page=await alfGraphRequest(api,inventory.token,
          '/pages/'+notionId);
        const current=page&&page.object==='page'&&!page.in_trash&&
          alfGraphId(page.id)===notionId&&
          alfGraphId(page.parent&&page.parent.data_source_id)===
            inventory.ids.board?
          alfGraphItem(page,inventory.c):null;
        if(!current||current.projects.length!==n.projects.length||
          (current.projects[0]||null)!==notion||
          current.parents.length||current.title!==n.title){
          stats.conflicts++;continue;
        }
        const live=await api.getTasks();
        if(!Array.isArray(live)||live.filter(x=>x&&x.id===spId&&
          alfGraphTaskClaim(x,notionId)&&!x.parentId&&
          x.projectId===sp[0].projectId).length!==1){
          stats.conflicts++;continue;
        }
        await api.updateTask(spId,{projectId:notion?toSp.get(notion):null});
        stats.updatedSp++;
      }else{
        const page=await alfGraphRequest(api,inventory.token,
          '/pages/'+notionId);
        const original=page&&page.object==='page'?
          alfGraphItem(page,inventory.c):null;
        if(!page||page.object!=='page'||page.in_trash||
          alfGraphId(page.id)!==notionId||
          alfGraphId(page.parent&&page.parent.data_source_id)!==
            inventory.ids.board||
          !original||original.projects.length!==(notion?1:0)||
          (original.projects[0]||null)!==notion){
          stats.conflicts++;continue;
        }
        const live=await api.getTasks();
        if(!Array.isArray(live)||live.filter(x=>x&&x.id===spId&&
          alfGraphTaskClaim(x,notionId)&&x.projectId===sp[0].projectId&&
          !x.parentId).length!==1){
          stats.conflicts++;continue;
        }
        const response=await alfGraphRequest(api,inventory.token,
          '/pages/'+notionId,'PATCH',{properties:{
            [inventory.c.taskPropertyBindings.projectProp.id]:{
              relation:local?[{id:local}]:[]
            }
          }});
        if(!response||alfGraphId(response.id)!==notionId)
          throw new Error('Unconfirmed original task project move');
        stats.writtenNotion++;
      }
      await api.persistDataSynced(JSON.stringify({...anchor,
        project:nc?notion:local}),key);
    }catch(_){stats.errors++;}
  }
  return stats;
}
// Exact task identity, three-way status baselines, no arbitrary last-writer
// wins. This deliberately does not infer In progress from time tracking.
async function alfGraphSyncStatuses(api,inventory,plan){
  const stats={anchored:0,updated:0,written:0,conflicts:0,skipped:0,errors:0};
  if(typeof api.updateTask!=='function')return {...stats,errors:1};
  const all=[...inventory.spActive,...inventory.spArchive];
  let remaining=8;
  for(const [notionId,spId] of plan.links.tasks) {
    if(!remaining--)break;
    const page=inventory.tasks.find(t=>t.id===notionId);
    const matches=all.filter(t=>t.id===spId&&alfGraphTaskClaim(t,notionId));
    if(!page||matches.length!==1||
       !['Not started','In progress','Done'].includes(page.status)){
      stats.skipped++;continue;
    }
    const sp=matches[0];
    if(Array.isArray(sp.subTaskIds)&&sp.subTaskIds.length){
      stats.skipped++;continue; // bundles' aggregate state is not a leaf completion
    }
    const done=sp.isDone===true;
    const key=ALF_GRAPH_STATUS_ANCHOR_PREFIX+notionId;
    let anchor;
    try{
      const raw=await api.loadSyncedData(key);
      anchor=raw?JSON.parse(raw):null;
      if(anchor&&(anchor.version!==1||anchor.notionId!==notionId||
         anchor.spId!==spId||anchor.sourceId!==inventory.ids.board||
         typeof anchor.spDone!=='boolean'||
         !['Not started','In progress','Done'].includes(anchor.notionStatus))){
        stats.conflicts++;continue;
      }
      if(!anchor) {
        if(done!==(page.status==='Done')){stats.conflicts++;continue;}
        await api.persistDataSynced(JSON.stringify({version:1,
          notionId,spId,sourceId:inventory.ids.board,
          spDone:done,notionStatus:page.status}),key);
        stats.anchored++;continue;
      }
      const spChanged=done!==anchor.spDone;
      const notionChanged=page.status!==anchor.notionStatus;
      if(spChanged&&notionChanged&&done!==(page.status==='Done')){
        stats.conflicts++;continue;
      }
      if(spChanged&&!notionChanged) {
        const newStatus=done?'Done':'Not started';
        // Preflight the exact original current page and pinned status property.
        const current=await alfGraphRequest(api,inventory.token,'/pages/'+notionId);
        if(!current||current.object!=='page'||current.in_trash||
           alfGraphId(current.id)!==notionId||
           alfGraphId(current.parent&&current.parent.data_source_id)!==
             inventory.ids.board ||
           alfGraphStatus(current,inventory.c.statusProp)!==page.status){
          stats.conflicts++;continue;
        }
        const updated=await api.getTasks();
        const after=updated.find(t=>t.id===spId)||
          (await api.getArchivedTasks()).find(t=>t.id===spId);
        if(!after||after.isDone!==done){stats.conflicts++;continue;}
        const patched=await alfGraphRequest(api,inventory.token,
          '/pages/'+notionId,'PATCH',{properties:{
            [inventory.c.taskPropertyBindings.statusProp.id]:
              {status:{name:newStatus}}
          }});
        if(!patched||alfGraphId(patched.id)!==notionId)
          throw new Error('Notion status update outcome unknown');
        page.status=newStatus;stats.written++;
      }else if(!spChanged&&notionChanged&&
          done!==(page.status==='Done')){
        if(!inventory.spActive.some(t=>t.id===spId)){
          stats.conflicts++;continue;
        }
        const live=await api.getTasks();
        if(!live.some(t=>t.id===spId&&t.isDone===done&&
          alfGraphTaskClaim(t,notionId))){
          stats.conflicts++;continue;
        }
        await api.updateTask(spId,{isDone:page.status==='Done'});
        stats.updated++;
      }
      if(spChanged||notionChanged){
        const newDone=spChanged?done:page.status==='Done';
        await api.persistDataSynced(JSON.stringify({version:1,
          notionId,spId,sourceId:inventory.ids.board,
          spDone:newDone,notionStatus:page.status}),key);
      }else stats.skipped++;
    }catch(_){stats.errors++;}
  }
  return stats;
}
// User work time is a cumulative SP timeSpent value, NOT a Pomodoro count.
// Mirror verified INCREMENTS to the original اللوح / الوقت الفعلي Number.
// Keep a three-way baseline: a manually edited Notion number always wins.
// No new Notion properties, and no write on unlinked tasks or habit pages.
async function alfGraphSyncTrackedTime(api,inventory,plan,options={}){
  const stats={anchored:0,written:0,unchanged:0,conflicts:0,
    skipped:0,errors:0,legacyOwner:false};
  if(typeof api.getSecret==='function' &&
      await api.getSecret(ALF_AUTO_TIME_FLAG)==='enabled'){
    stats.legacyOwner=true;
    return stats; // The older opt-in exporter already owns this Number.
  }
  if(typeof api.persistDataSynced!=='function'||
     typeof api.loadSyncedData!=='function')
    return {...stats,errors:1};
  if(!inventory.c || !['hours','minutes'].includes(inventory.c.unit) ||
     !inventory.c.taskPropertyBindings?.actualProp?.id)
    return {...stats,errors:1};
  const all=[...inventory.spActive,...inventory.spArchive];
  const max=Number.isInteger(options.max)&&options.max>0?
    Math.min(options.max,20):8;
  let checked=0;
  for(const [notionId,spId] of plan.links.tasks){
    if(checked++>=max)break;
    const item=inventory.tasks.find(t=>t.id===notionId);
    const spMatches=all.filter(t=>t&&t.id===spId&&
      alfGraphTaskClaim(t,notionId));
    if(!item||spMatches.length!==1 ||
       (Array.isArray(spMatches[0].subTaskIds)&&spMatches[0].subTaskIds.length) ||
       spMatches[0].repeatCfgId ||
       !Number.isSafeInteger(spMatches[0].timeSpent) ||
       spMatches[0].timeSpent<0){
      stats.skipped++;continue;
    }
    const sp=spMatches[0],key=ALF_GRAPH_TIME_ANCHOR_PREFIX+notionId;
    try{
      const raw=await api.loadSyncedData(key);
      let anchor=raw?JSON.parse(raw):null;
      if(anchor&&(anchor.version!==1||anchor.notionId!==notionId||
          anchor.spId!==spId||anchor.sourceId!==inventory.ids.board||
          !Number.isSafeInteger(anchor.spMs)||anchor.spMs<0||
          typeof anchor.notionNumber!=='number'||
          !Number.isFinite(anchor.notionNumber)||anchor.notionNumber<0||
          !Number.isSafeInteger(anchor.lastPushedAt))){
        stats.conflicts++;continue;
      }
      if(anchor&&sp.timeSpent<anchor.spMs){
        stats.conflicts++;continue; // user reset or changed the timer
      }
      if(anchor&&sp.timeSpent===anchor.spMs){
        stats.unchanged++;continue;
      }
      if(anchor&&Date.now()-anchor.lastPushedAt<
          (options.minPushGapMs??20000)&&!sp.isDone){
        stats.unchanged++;continue; // don't PATCH on every timer tick
      }
      const path='/pages/'+notionId;
      const page=await alfGraphRequest(api,inventory.token,path);
      if(!page||page.object!=='page'||page.in_trash||
         alfGraphId(page.id)!==notionId||
         alfGraphId(page.parent&&page.parent.data_source_id)!==
           inventory.ids.board){
        stats.conflicts++;continue;
      }
      const live=alfGraphItem(page,inventory.c);
      const actual=alfGraphField(page,inventory.c,'actualProp');
      if(!live||live.title!==item.title||!actual||
         actual.type!=='number'||
         (actual.number!==null&&
           (typeof actual.number!=='number'||
            !Number.isFinite(actual.number)||actual.number<0))){
        stats.conflicts++;continue;
      }
      const value=actual.number??0;
      if(!anchor){
        // A genuinely empty original Number may safely take the whole
        // already-tracked SP duration. A nonempty Number is preserved as
        // pre-existing history; only FUTURE SP increments are added.
        const seed={version:1,notionId,spId,sourceId:inventory.ids.board,
          spMs:value===0?0:sp.timeSpent,notionNumber:value,
          lastPushedAt:Date.now()-21000};
        await api.persistDataSynced(JSON.stringify(seed),key);
        anchor=seed;stats.anchored++;
      }
      if(Math.abs(value-anchor.notionNumber)>0.000001){
        stats.conflicts++;continue; // manual Notion edits are authoritative
      }
      const delta=sp.timeSpent-anchor.spMs;
      if(delta<=0){stats.unchanged++;continue;}
      const increment=delta/(inventory.c.unit==='hours'?3600000:60000);
      const next=Math.round((anchor.notionNumber+increment)*1000000)/1000000;
      if(!Number.isFinite(next)||next<=anchor.notionNumber){
        stats.unchanged++;continue;
      }
      const newest=[...(await api.getTasks()||[]),
        ...(await api.getArchivedTasks()||[])].filter(t=>t&&t.id===spId&&
        alfGraphTaskClaim(t,notionId));
      if(newest.length!==1||newest[0].timeSpent!==sp.timeSpent ||
         (await api.loadSyncedData(key))!==JSON.stringify(anchor) ||
         await api.getSecret(ALF_GRAPH_AUTO_KEY)!=='enabled'){
        stats.conflicts++;continue;
      }
      // The last GET/PATCH race cannot be made atomic by Notion; on an
      // ambiguous PATCH the unchanged baseline guarantees fail-closed.
      const changed=await alfGraphRequest(api,inventory.token,path,'PATCH',{
        properties:{
          [inventory.c.taskPropertyBindings.actualProp.id]:{number:next}
        }
      });
      if(!changed||changed.object!=='page'||
         alfGraphId(changed.id)!==notionId)
        throw new Error('Notion did not confirm tracked-time update');
      stats.written++;
      await api.persistDataSynced(JSON.stringify({...anchor,
        spMs:sp.timeSpent,notionNumber:next,lastPushedAt:Date.now()}),key);
    }catch(_){stats.errors++;}
  }
  return stats;
}
// v0.37: append-only Pomodoro journal in the body of the EXISTING Notion
// task page. No new property/database and no overwriting user-authored blocks.
// This is a log of OBSERVED completions, not imported historical timer data.
const ALF_POMO_BLOCK_MARKER='ALF-POMODORO-SESSION-V1:';
const ALF_POMO_BLOCK_LEDGER='alf-pomo-block-v1-';
function alfPomoVerifiedRecord(e,key){
  return !!(e&&e.schemaVersion===1&&
    typeof e.sessionId==='string'&&
    /^[a-zA-Z0-9_-]{4,120}$/.test(e.sessionId)&&
    key===ALF_FOCUS_KEY_PREFIX+e.sessionId&&
    typeof e.taskId==='string'&&e.taskId&&
    e.mode==='Pomodoro'&&e.automatic===true&&e.manual===false&&
    e.verifiedCompletedPomodoro===true&&e.observedCompletion===true&&
    e.source==='live-sp-action-hook'&&
    Number.isSafeInteger(e.startedAt)&&e.startedAt>0&&
    Number.isSafeInteger(e.endedAt)&&e.endedAt>=e.startedAt);
}
function alfPomoBlockText(record){
  const start=new Date(record.startedAt).toISOString();
  const end=new Date(record.endedAt).toISOString();
  return '✅ Pomodoro completed in Super Productivity (observed) | '+
    'UTC '+start+' → '+end+' | '+
    ALF_POMO_BLOCK_MARKER+record.sessionId;
}
function alfPomoMarkerInBlock(block){
  if(!block||typeof block.type!=='string')return '';
  const r=block[block.type]&&block[block.type].rich_text;
  if(!Array.isArray(r))return '';
  const text=r.map(v=>v.plain_text||(v.text&&v.text.content)||'').join('');
  const m=text.match(/ALF-POMODORO-SESSION-V1:([a-zA-Z0-9_-]{4,120})/);
  return m?m[1]:'';
}
async function alfPomoReadRemoteSessionIds(api,token,pageId){
  const ids=new Set(),seenCursors=new Set();
  let cursor='';
  // Paginate the full root block list; a truncated scan must never be used
  // as evidence that a particular session marker is missing.
  for(let n=0;n<15;n++){
    const path='/blocks/'+pageId+'/children?page_size=100'+
      (cursor?'&start_cursor='+encodeURIComponent(cursor):'');
    const reply=await alfGraphRequest(api,token,path);
    if(!reply||!Array.isArray(reply.results)||reply.results.length>100||
       typeof reply.has_more!=='boolean')
      throw new Error('Invalid Notion block list; no Pomodoro writes');
    for(const b of reply.results){
      const sid=alfPomoMarkerInBlock(b);
      if(sid)ids.add(sid);
    }
    if(!reply.has_more)return ids;
    if(typeof reply.next_cursor!=='string'||!reply.next_cursor||
       seenCursors.has(reply.next_cursor))
      throw new Error('Incomplete Notion block paging; no Pomodoro writes');
    seenCursors.add(reply.next_cursor);cursor=reply.next_cursor;
  }
  throw new Error('Notion page has over 1500 top-level blocks; review manually');
}
async function alfGraphApplyPomodoro(api,inventory,plan){
  const stats={scanned:0,linked:0,written:0,alreadyPresent:0,
    pending:0,skipped:0,errors:0};
  if(typeof api.listSyncedDataKeys!=='function'||
     typeof api.persistDataSynced!=='function')
    throw new Error('SP durable focus-session inventory unavailable');
  const keys=await api.listSyncedDataKeys(ALF_FOCUS_KEY_PREFIX);
  if(!Array.isArray(keys)||keys.length>2000)
    throw new Error('Focus history inventory incomplete');
  const targetByTask=new Map([...plan.links.tasks].map(([pageId,spId])=>[spId,pageId]));
  const checkedPages=new Map(),seen=new Set();
  let slots=3; // Bounded writes per single reviewed or automatic cycle.
  for(const key of keys.sort()){
    if(!slots)break;
    stats.scanned++;
    if(typeof key!=='string'||!key.startsWith(ALF_FOCUS_KEY_PREFIX))continue;
    const raw=await api.loadSyncedData(key);
    if(!raw){stats.skipped++;continue;}
    let record;
    try{record=JSON.parse(raw);}catch(_){stats.skipped++;continue;}
    if(!alfPomoVerifiedRecord(record,key)||seen.has(record.sessionId)){
      stats.skipped++;continue;
    }
    seen.add(record.sessionId);
    const target=targetByTask.get(record.taskId);
    if(!target){stats.skipped++;continue;}
    const original=inventory.tasks.find(p=>p.id===target);
    if(!original){stats.skipped++;continue;}
    const spMatches=[...inventory.spActive,...inventory.spArchive].filter(
      t=>t&&t.id===record.taskId&&alfGraphTaskClaim(t,target));
    if(spMatches.length!==1){stats.skipped++;continue;}
    stats.linked++;
    const ledgerKey=ALF_POMO_BLOCK_LEDGER+record.sessionId;
    const saved=await api.loadSyncedData(ledgerKey);
    let ledger=null;
    try{ledger=saved?JSON.parse(saved):null;}catch(_){stats.skipped++;continue;}
    if(ledger&&(ledger.version!==1||ledger.sessionId!==record.sessionId||
        ledger.taskId!==record.taskId||ledger.notionId!==target||
        !['attempted','committed'].includes(ledger.status))){
      stats.skipped++;continue;
    }
    if(ledger&&ledger.status==='committed'){stats.alreadyPresent++;continue;}
    let attempted=false;
    try{
      if(!checkedPages.has(target)){
        const page=await alfGraphRequest(api,inventory.token,'/pages/'+target);
        if(!page||page.object!=='page'||page.in_trash||
           alfGraphId(page.id)!==target||
           alfGraphId(page.parent&&page.parent.data_source_id)!==
             inventory.ids.board)
          throw new Error('Notion Pomodoro target moved or missing');
        const live=alfGraphItem(page,inventory.c);
        if(!live||live.id!==target||live.title!==original.title)
          throw new Error('Notion Pomodoro target changed since review');
        checkedPages.set(target,await alfPomoReadRemoteSessionIds(
          api,inventory.token,target));
      }
      const markers=checkedPages.get(target);
      if(markers.has(record.sessionId)){
        await api.persistDataSynced(JSON.stringify({version:1,status:'committed',
          sessionId:record.sessionId,taskId:record.taskId,notionId:target}),
        ledgerKey);
        stats.alreadyPresent++;continue;
      }
      if(ledger){
        // A previously attempted PATCH may have committed despite timeout.
        // Never silently re-append if a complete remote scan finds no marker.
        stats.pending++;continue;
      }
      await api.persistDataSynced(JSON.stringify({version:1,
        status:'attempted',sessionId:record.sessionId,
        taskId:record.taskId,notionId:target}),ledgerKey);
      attempted=true;
      slots--;
      const line=alfPomoBlockText(record);
      const reply=await alfGraphRequest(api,inventory.token,
        '/blocks/'+target+'/children','PATCH',{children:[{
          object:'block',type:'paragraph',paragraph:{rich_text:[{
            type:'text',text:{content:line}
          }]}
        }]});
      if(!reply||!Array.isArray(reply.results)||
         reply.results.length!==1||
         alfPomoMarkerInBlock(reply.results[0])!==record.sessionId)
        throw new Error('Notion block append outcome unconfirmed');
      markers.add(record.sessionId);
      await api.persistDataSynced(JSON.stringify({version:1,status:'committed',
        sessionId:record.sessionId,taskId:record.taskId,notionId:target}),
      ledgerKey);
      stats.written++;
    }catch(_){
      // If the ledger was written first, an error requires manual resolution.
      stats.errors++;
      if(attempted||ledger)stats.pending++;
      else stats.skipped++;
    }
  }
  return stats;
}
// A device's first automatic run must never mass-import its pre-existing
// backlog (which may contain years of unrelated SP or Notion tasks). A single
// local activation time fences object creation; exact ID-linked tasks continue
// to receive status reconciliation regardless of their original creation date.
// This is intentionally conservative: records without a trustworthy creation
// timestamp require explicit historical reconciliation, not a guessed import.
function alfGraphOnlyNewEntities(plan,sinceMs,options={}){
  if(!Number.isSafeInteger(sinceMs)||sinceMs<=0||
     sinceMs>Date.now()+60000)
    throw new Error('Missing or invalid graph sync activation baseline');
  const fresh=items=>items.filter(x=>
    Number.isSafeInteger(x.createdAt)&&x.createdAt>=sinceMs);
  // Recover recent Notion work created just before device activation.
  // Bound by time and the per-run write quota; no silent years-long
  // historical migration. The SP-side historical backlog is still fenced.
  const graceMs=options.notionCatchupMs===undefined?
    48*3600000:options.notionCatchupMs;
  if(!Number.isSafeInteger(graceMs)||graceMs<0||
      graceMs>7*24*3600000)
    throw new Error('Unbounded historical Notion catch-up refused');
  const notionStart=Math.max(0,sinceMs-graceMs);
  const tasks=options.includeHistoricalNotion?plan.tasks.slice():
    plan.tasks.filter(t=>
      Number.isSafeInteger(t.createdAt)&&t.createdAt>=notionStart);
  const requiredBundles=new Set(tasks.map(t=>t.parent).filter(Boolean));
  for(const t of plan.tasks){
    if(requiredBundles.has(t.id)&&!tasks.some(x=>x.id===t.id))
      tasks.push(t);
  }
  // Never import a subtask before its parent. Among top-level tasks, do
  // today's executable work before older completed history.
  // Use the host's LOCAL logical calendar day, not UTC midnight: SP's
  // Today/Planner is device-local and Notion dates are date-only values.
  const now=new Date();
  const dateToday=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),
    String(now.getDate()).padStart(2,'0')].join('-');
  const urgency=t=>t.status==='Done'?3:
    t.due===dateToday?0:t.due?1:2;
  tasks.sort((a,b)=>Number(!!a.parent)-Number(!!b.parent)||
    urgency(a)-urgency(b)||String(a.id).localeCompare(String(b.id)));
  // A new Notion task can belong to an older legitimate small project that
  // SP has never seen. Create/adopt only that required parent project, not
  // the entire historical project backlog.
  const requiredNotionProjects=new Set(tasks.map(t=>t.project).filter(Boolean));
  const exportsTasks=plan.exportsTasks.filter(x=>
    Number.isSafeInteger(x.created)&&x.created>=sinceMs);
  const spExisting=options.spProjectIdsBefore &&
    typeof options.spProjectIdsBefore.has==='function'?
    options.spProjectIdsBefore:null;
  const requiredSpProjects=new Set(exportsTasks.map(t=>t.spProjectId)
    .filter(x=>x&&x!=='INBOX_PROJECT'));
  // Likewise a newly created SP subtask needs the original SP parent to
  // become a Notion bundle if that parent has no Notion link yet.
  const requiredSpParents=new Set(exportsTasks.map(t=>t.parentSpId)
    .filter(Boolean));
  return {...plan,
    projects:options.includeHistoricalNotion?plan.projects.slice():
      plan.projects.filter(p=>
        (Number.isSafeInteger(p.createdAt)&&p.createdAt>=sinceMs)||
        requiredNotionProjects.has(p.id)),
    tasks,
    exportsProjects:plan.exportsProjects.filter(p=>
      (spExisting?!spExisting.has(p.spId):
        Number.isSafeInteger(p.createdAt)&&p.createdAt>=sinceMs)||
      requiredSpProjects.has(p.spId)),
    exportsTasks:plan.exportsTasks.filter(x=>
      (Number.isSafeInteger(x.created)&&x.created>=sinceMs)||
      requiredSpParents.has(x.spId))};
}
// Opt-in foreground/background-host reconciliation of NEW entities only.
// Notion create POST is never retried after ambiguous failure. Other existing
// engines own approved plan/time/habit fields; do not double-write them here.
// A single designated Windows/Android writer per account is required.
function alfCreateAutoGraphSync(api,options={}){
  const intervalMs=options.intervalMs||8000;
  const inventoryFn=options.inventory||alfGraphInventory;
  const probeFn=options.probe||alfGraphQuickProbe;
  const fullRefreshMs=options.fullRefreshMs||2*60*1000;
  let timer=null,inflight=false,previous=0,lastFull=0,probeSignature;
  let drainingHistoricalBackfill=false;
  async function runOnce(){
    const result={enabled:false,processed:0,written:0,skipped:0,
      conflicts:0,errors:0,timeWritten:0};
    if(typeof api.getSecret!=='function' ||
       await api.getSecret(ALF_GRAPH_AUTO_KEY)!=='enabled')return result;
    result.enabled=true;
    try{
      const cutoffRaw=await api.getSecret(ALF_GRAPH_CUTOVER_KEY);
      const cutoff=cutoffRaw?JSON.parse(cutoffRaw):null;
      if(!cutoff||cutoff.version!==1||
         !Number.isSafeInteger(cutoff.sinceMs))
        throw new Error('Enable graph with a safe initial baseline');
      const inventory=await inventoryFn(api);
      const projectBaselineRaw=await api.loadSyncedData(
        'alf-graph-sp-projects-at-connect-v1');
      let spProjectIdsBefore=null;
      if(projectBaselineRaw){
        let record;
        try{record=JSON.parse(projectBaselineRaw);}catch(_){}
        if(record&&record.version===1&&
           record.source===inventory.ids.board&&
           Array.isArray(record.ids)&&record.ids.length<=10000&&
           record.ids.every(id=>typeof id==='string'&&id.length<=120))
          spProjectIdsBefore=new Set(record.ids);
      }
      const plan=await alfGraphPlan(api,inventory);
      const newPlan=alfGraphOnlyNewEntities(plan,cutoff.sinceMs,
        {spProjectIdsBefore,includeHistoricalNotion:true});
      // The historical Notion backlog is imported in tiny, idempotent
      // batches. Keep the >40 safeguard for potentially dangerous mass
      // exports of unrelated SP entities INTO Notion only.
      if([newPlan.exportsProjects,
        newPlan.exportsTasks].some(items=>items.length>40)){
        result.conflicts++;result.skipped++;
        await alfStoreAutoStatus(api,'graph',result);
        return result; // Never mutate an unreviewable backlog.
      }
      const local=await alfGraphApplyLocal(api,inventory,newPlan,{maxWrites:6});
      result.backfillPending=Math.max(0,newPlan.projects.length+
        newPlan.tasks.length-local.projects-local.tasks-local.skipped);
      // Re-read both sources after local creates. Never make reverse Notion
      // pages from the pre-write snapshot: a new SP task might have been
      // created as a consequence of this very cycle.
      const postLocalInventory=await inventoryFn(api);
      const postLocalPlan=await alfGraphPlan(api,postLocalInventory);
      const newPostLocalPlan=alfGraphOnlyNewEntities(postLocalPlan,
        cutoff.sinceMs,{spProjectIdsBefore,includeHistoricalNotion:true});
      const upper=await api.getSecret(ALF_GRAPH_AUTO_PARENT_KEY)||'';
      const remote=await alfGraphApplyRemote(api,postLocalInventory,
        newPostLocalPlan,upper,{maxWrites:1,preferNewest:true});
      const statuses=await alfGraphSyncStatuses(api,postLocalInventory,
        postLocalPlan);
      const projectTitles=await alfGraphSyncProjectTitles(api,
        postLocalInventory,postLocalPlan);
      const planning=await alfGraphSyncTaskPlanning(api,
        postLocalInventory,postLocalPlan);
      const taskProjects=await alfGraphSyncTaskProjects(api,
        postLocalInventory,postLocalPlan);
      const time=await alfGraphSyncTrackedTime(api,postLocalInventory,
        postLocalPlan);
      const pomo=await api.getSecret(ALF_POMO_AUTO_KEY)==='enabled'?
        await alfGraphApplyPomodoro(api,postLocalInventory,postLocalPlan):
        {written:0,pending:0,errors:0};
      result.processed=postLocalPlan.projects.length+postLocalPlan.tasks.length+
        postLocalPlan.exportsProjects.length+postLocalPlan.exportsTasks.length;
      result.written=local.projects+local.tasks+
        remote.projects+remote.tasks+statuses.written+pomo.written+
        time.written+projectTitles.updatedSp+projectTitles.writtenNotion+
        planning.updatedSp+planning.writtenNotion+
        taskProjects.updatedSp+taskProjects.writtenNotion;
      result.timeWritten=time.written;
      result.skipped=local.skipped+remote.skipped+remote.pending+
        statuses.skipped+pomo.pending+time.skipped;
      result.conflicts=postLocalPlan.skipped.conflicts+statuses.conflicts+
        time.conflicts+projectTitles.conflicts+planning.conflicts+
        taskProjects.conflicts;
      result.errors=local.errors+remote.errors+statuses.errors+pomo.errors+
        time.errors+projectTitles.errors+planning.errors+
        taskProjects.errors;
    }catch(_){result.errors++;}
    await alfStoreAutoStatus(api,'graph',result);
    return result;
  }
  async function heartbeat(force=false){
    if(inflight)return;
    // Disabled checks must not reset the cooldown; the first newly enabled
    // cycle should start without a ten-minute delay.
    if(typeof api.getSecret!=='function' ||
       await api.getSecret(ALF_GRAPH_AUTO_KEY)!=='enabled'){
      previous=0;lastFull=0;probeSignature=undefined;
      drainingHistoricalBackfill=false;return;
    }
    if(!force&&Date.now()-previous<intervalMs)return;
    // A long full scan must not be repeated continuously by every
    // taskUpdate emitted while SP's timer is ticking.
    if(force&&lastFull&&Date.now()-lastFull<15000)return;
    inflight=true;previous=Date.now();
    try{
      if(!force&&!drainingHistoricalBackfill&&lastFull&&
         Date.now()-lastFull<fullRefreshMs){
        let changed;
        try{
          const next=await probeFn(api);
          changed=next===null||probeSignature===undefined||
            next!==probeSignature;
          probeSignature=next;
        }catch(_){
          // If a quick probe cannot prove the state is unchanged, rely on
          // the bounded full scan rather than dropping future updates.
          changed=Date.now()-lastFull>=45000;
        }
        if(!changed)return;
      }
      const result=await runOnce();
      if(result&&result.enabled){
        lastFull=Date.now();
        // Keep scanning while we make verified native progress; without
        // this, the Notion-only change probe would postpone each batch to
        // the two-minute fallback despite pending historical pages.
        drainingHistoricalBackfill=!!(result.backfillPending>0&&
          result.written>0&&!result.errors);
      }
      return result;
    }
    finally{inflight=false;}
  }
  function start(){
    if(timer!==null||typeof setInterval!=='function')return;
    timer=setInterval(()=>{void heartbeat();},5000);
    void heartbeat();
  }
  function stop(){
    if(timer!==null&&typeof clearInterval==='function')clearInterval(timer);
    timer=null;
  }
  return {runOnce,start,stop,heartbeat};
}

if (typeof PluginAPI !== 'undefined' && typeof PluginAPI.onReady==='function') {
  const alfAutomaticPlan=alfCreateAutoPlanSync(PluginAPI);
  const alfAutomaticTime=alfCreateAutoTimeSync(PluginAPI);
  const alfAutomaticHabits=alfCreateAutoHabitSync(PluginAPI);
  const alfAutomaticGraph=alfCreateAutoGraphSync(PluginAPI);
  let alfGraphWakeTimer=null;
  function alfQueueGraphRecheck(){
    if(alfGraphWakeTimer!==null)clearTimeout(alfGraphWakeTimer);
    // A local task create/update is already a committed SP operation by the
    // time its hook fires. Debounce adjacent edits and batch them at source.
    alfGraphWakeTimer=setTimeout(()=>{
      alfGraphWakeTimer=null;
      void alfAutomaticGraph.heartbeat(true);
    },3000);
  }
  if(typeof PluginAPI.registerHook==='function'&&PluginAPI.Hooks){
    for(const name of ['TASK_CREATED','TASK_COMPLETE','TASK_UPDATE',
      'PROJECT_LIST_UPDATE']){
      const hook=PluginAPI.Hooks[name];
      if(hook)PluginAPI.registerHook(hook,alfQueueGraphRecheck);
    }
  }
  PluginAPI.onReady(()=>{
    alfAutomaticPlan.start();
    alfAutomaticTime.start();
    alfAutomaticHabits.start();
    alfAutomaticGraph.start();
  });
  if(typeof PluginAPI.onUnload==='function')
    PluginAPI.onUnload(()=>{
      if(alfGraphWakeTimer!==null){
        clearTimeout(alfGraphWakeTimer);
        alfGraphWakeTimer=null;
      }
      if(typeof alfStopHostRpcBridge==='function')alfStopHostRpcBridge();
      alfAutomaticPlan.stop();
      alfAutomaticTime.stop();
      alfAutomaticHabits.stop();
      alfAutomaticGraph.stop();
    });
}
