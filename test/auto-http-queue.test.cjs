'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'..','plugin.js'),'utf8');

function harness() {
  let now=1000;
  const delays=[],ctx={
    console,Date:{now(){return now;}},
    setTimeout(fn,ms){
      assert.ok(ms>=0&&ms<=5000,'bounded rate-limiting waits');
      delays.push(ms);
      now+=ms;
      fn();
    }
  };
  vm.createContext(ctx);
  vm.runInContext(code,ctx,{filename:'plugin.js'});
  const queued=vm.runInContext('alfQueuedNotionRequest',ctx);
  return {queued,delays,clock(){return now;}};
}
test('three auto engines share one serialized Notion request lane',async()=>{
  const h=harness(),order=[];
  const api={async request(url,opts){
    order.push({url,at:h.clock(),method:opts.method});
    return {ok:true};
  }};
  const run=await Promise.all([
    h.queued(api,'https://api.notion.com/v1/first',{method:'GET'}),
    h.queued(api,'https://api.notion.com/v1/second',{method:'POST'}),
    h.queued(api,'https://api.notion.com/v1/third',{method:'GET'})
  ]);
  assert.equal(run.length,3);
  assert.deepEqual(order.map(x=>x.url.split('/').at(-1)),['first','second','third']);
  assert.ok(order[1].at-order[0].at>=450);
  assert.ok(order[2].at-order[1].at>=450);
});
test('an explicit Notion 429 may be retried once with bounded delay',async()=>{
  const h=harness(),calls=[];
  const api={async request(url,opts) {
    calls.push({at:h.clock(),url});
    if(calls.length===1)throw Object.assign(new Error('Notion 429 rate limited'),{
      status:429,retryAfter:1
    });
    return {object:'page',id:'p'};
  }};
  const result=await h.queued(api,'https://api.notion.com/v1/pages/p',{method:'GET'});
  assert.equal(result.object,'page');
  assert.equal(calls.length,2);
  assert.ok(calls[1].at-calls[0].at>=1000);
  assert.ok(h.delays.some(ms=>ms===1000));
});
test('a second explicit 429 is not retried endlessly',async()=>{
  const h=harness();
  let attempts=0;
  const api={async request(){
    attempts++;
    throw Object.assign(new Error('429'),{status:429});
  }};
  await assert.rejects(h.queued(api,'https://api.notion.com/v1/pages/p',
    {method:'GET'}),/429/);
  assert.equal(attempts,2);
});
test('ambiguous Notion PATCH outcome is never retried automatically',async()=>{
  const h=harness();
  let attempts=0;
  const api={async request(){
    attempts++;
    throw new Error('network connection reset after possible PATCH commit');
  }};
  await assert.rejects(h.queued(api,'https://api.notion.com/v1/pages/p',
    {method:'PATCH',body:{properties:{n:{number:3}}}}),/network connection reset/);
  assert.equal(attempts,1,'never replay a write of unknown server outcome');
});
test('unexpected server errors do not become blind retries',async()=>{
  const h=harness();
  let attempts=0;
  const api={async request(){
    attempts++;
    throw Object.assign(new Error('service unavailable'),{status:503});
  }};
  await assert.rejects(h.queued(api,'https://api.notion.com/v1/pages/p',
    {method:'PATCH'}),/service unavailable/);
  assert.equal(attempts,1);
});
test('queue recovers after failed request without blocking another engine',async()=>{
  const h=harness(),order=[];
  const api={async request(url){
    order.push(url);
    if(url.endsWith('/bad'))throw new Error('network failed');
    return {ok:true};
  }};
  const bad=h.queued(api,'https://api.notion.com/v1/bad',{method:'GET'});
  const good=h.queued(api,'https://api.notion.com/v1/good',{method:'GET'});
  const results=await Promise.allSettled([bad,good]);
  assert.equal(results[0].status,'rejected');
  assert.equal(results[1].status,'fulfilled');
  assert.equal(order.length,2);
});


test('ambiguous PATCH response mentioning rate limit never triggers a second write',async()=>{
  const h=harness();
  let attempts=0,applied=0;
  const api={async request(){
    attempts++;applied++;
    throw Object.assign(new Error('connection closed after rate limit gateway, server outcome unknown'),{
      code:'rate_limited'
    });
  }};
  await assert.rejects(h.queued(api,'https://api.notion.com/v1/pages/p',
    {method:'PATCH',body:{properties:{field:{number:7}}}}),/outcome unknown/);
  assert.equal(attempts,1,'error strings and a non-HTTP error code are not proof of 429');
  assert.equal(applied,1,'no second possible mutation');
});
test('ambiguous PATCH error message containing 429 but HTTP status 503 never retries',async()=>{
  const h=harness();
  let attempts=0;
  const api={async request(){
    attempts++;
    throw Object.assign(new Error('upstream says 429 rate limit'),{status:503});
  }};
  await assert.rejects(h.queued(api,'https://api.notion.com/v1/pages/p',
    {method:'PATCH'}),/upstream says 429/);
  assert.equal(attempts,1);
});
test('machine-readable nested HTTP 429 can be retried exactly once',async()=>{
  const h=harness();
  let attempts=0;
  const api={async request(){
    attempts++;
    if(attempts===1)
      throw Object.assign(new Error('Notion refused this request'),{
        response:{status:429,headers:{'retry-after':'1'}}
      });
    return {object:'page',id:'p'};
  }};
  const out=await h.queued(api,'https://api.notion.com/v1/pages/p',{method:'GET'});
  assert.equal(attempts,2);
  assert.equal(out.id,'p');
});
