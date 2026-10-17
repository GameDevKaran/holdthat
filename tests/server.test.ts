import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createApp,type AppOptions} from '../src/server/app.js';
import {SessionStore} from '../src/server/store.js';

async function fixture(extra:Partial<AppOptions>={}){
 const store=new SessionStore(':memory:');
 const server=createApp({store,...extra}).listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+(server.address() as any).port;
 const response=await fetch(base+'/api/bootstrap');const cookie=response.headers.get('set-cookie')!.split(';')[0];
 const request=async(path:string,body?:unknown,method=body?'POST':'GET')=>{
  if(body&&(path==='/api/command'||path==='/api/interpret')){const current=await(await fetch(base+'/api/bootstrap',{headers:{cookie}})).json();body={expectedSessionId:current.session?.id,...body as object};}
  const r=await fetch(base+path,{method,headers:{cookie,'Content-Type':'application/json',origin:base},body:body?JSON.stringify(body):undefined});
  return {status:r.status,value:await r.json()};
 };
 const client=new Client({name:'holdthat-real-http-test',version:'1.0'});
 const transport=new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Cookie:cookie}}});
 await client.connect(transport);
 return {base,cookie,request,client,store,close:async()=>{await client.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}};
}
test('real MCP initialize/discovery/report/interrupt/resume and manual confirm',async()=>{
 const f=await fixture();try{
  const tools=await f.client.listTools();assert.deepEqual(tools.tools.map(t=>t.name).sort(),['get_session','interrupt_task','report_progress','resume_task']);
  await f.request('/api/session',{templateId:'travel-packing'});
  await f.request('/api/command',{command:{type:'start',expectedRevision:0},requestId:randomUUID()});
  const call=async(name:string,args:any)=>{const current=await f.request('/api/bootstrap');const r=await f.client.callTool({name,arguments:{...args,expectedSessionId:current.value.session.id}});assert.ok(!r.isError);return JSON.parse((r.content as any)[0].text);};
  const result=await call('report_progress',{stepId:'choose-bag',status:'confirmed',evidence:'The bag is open.',expectedRevision:1,requestId:randomUUID()});
  assert.equal(result.session.steps[0].status,'uncertain');
  await call('interrupt_task',{expectedRevision:2,requestId:randomUUID()});
  const resumed=await call('resume_task',{expectedRevision:3,requestId:randomUUID()});assert.equal(resumed.decision.kind,'clarify');
  const confirmed=await f.request('/api/command',{command:{type:'confirm',stepId:'choose-bag',expectedRevision:4},requestId:randomUUID()});assert.equal(confirmed.value.session.steps[0].status,'confirmed');
  const exported=await f.request('/api/export');assert.equal(exported.value.session.revision,5);
 }finally{await f.close();}
});
test('idempotent retry returns current state and altered reuse is rejected',()=>{
 const store=new SessionStore(':memory:');try{
  const id=store.create('owner','travel-packing').id;
  const command={type:'start' as const,expectedRevision:0};store.command('owner',command,'key',id);
  store.command('owner',{type:'interrupt',expectedRevision:1},'other',id);
  assert.equal(store.command('owner',command,'key',id).phase,'INTERRUPTED');
  assert.throws(()=>store.command('owner',{type:'reset'},'key',id),(e:any)=>e.code==='KEY_REUSED');
 }finally{store.close();}
});
test('SQLite persistence survives reopening and clearing removes records',()=>{
 const dir=mkdtempSync(join(tmpdir(),'holdthat-store-'));const file=join(dir,'test.sqlite');
 try{let store=new SessionStore(file);const id=store.create('owner','craft-kit').id;store.command('owner',{type:'start'},'one',id);store.close();store=new SessionStore(file);assert.equal(store.get('owner')?.phase,'ACTIVE');assert.equal(store.get('stranger'),null);store.clear('owner');assert.equal(store.get('owner'),null);store.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('unknown session cannot read another browser state',async()=>{
 const f=await fixture();try{
  await f.request('/api/session',{templateId:'craft-kit'});
  const response=await fetch(f.base+'/api/bootstrap');const value=await response.json();assert.equal(value.session,null);
  assert.equal((await fetch(f.base+'/api/export')).status,401);
 }finally{await f.close();}
});
test('cross-site mutations and unrecognized hosts are rejected',async()=>{
 const f=await fixture();try{
  const response=await fetch(f.base+'/api/session',{method:'POST',headers:{cookie:f.cookie,origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({templateId:'travel-packing'})});assert.equal(response.status,403);
  const status=await new Promise<number>((resolve,reject)=>{const req=httpRequest(f.base+'/api/bootstrap',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode!);});req.on('error',reject);req.end();});assert.equal(status,403);
 }finally{await f.close();}
});
test('stale revisions and invalid request fields cannot mutate state',async()=>{
 const f=await fixture();try{
  await f.request('/api/session',{templateId:'travel-packing'});
  assert.equal((await f.request('/api/command',{command:{type:'start',expectedRevision:42},requestId:randomUUID()})).status,409);
  assert.equal((await f.request('/api/command',{command:{type:'confirm',stepId:'choose-bag',expectedRevision:0,force:true},requestId:randomUUID()})).status,400);
  const state=await f.request('/api/bootstrap');assert.equal(state.value.session.revision,0);
 }finally{await f.close();}
});
test('disabled model returns truthful unavailable status and leaves state intact',async()=>{
 const f=await fixture();try{await f.request('/api/session',{templateId:'travel-packing'});const r=await f.request('/api/interpret',{text:'Done',expectedRevision:0});assert.equal(r.status,503);assert.equal((await f.request('/api/bootstrap')).value.session.revision,0);}finally{await f.close();}
});
test('provider failure is isolated from progress; model test double never changes state',async()=>{
 const f=await fixture({model:async()=>{throw new Error('Provider test double failure');}});try{
  await f.request('/api/session',{templateId:'travel-packing'});
  const r=await f.request('/api/interpret',{text:'I started.',expectedRevision:0});assert.equal(r.status,502);assert.equal(r.value.code,'MODEL_FAILED');assert.equal((await f.request('/api/bootstrap')).value.session.revision,0);
 }finally{await f.close();}
});
test('model request cap bounds an injected provider without implying live verification',async()=>{
 const f=await fixture({modelCallsPerSession:1,model:async input=>({intent:{action:'clarify',stepId:null,status:null,evidence:input.text,message:'Which step?'},trace:{provider:'bedrock',model:'test-double',latencyMs:0}})});try{
  await f.request('/api/session',{templateId:'travel-packing'});
  assert.equal((await f.request('/api/interpret',{text:'Done',expectedRevision:0})).status,200);
  assert.equal((await f.request('/api/interpret',{text:'Done',expectedRevision:0})).status,429);
  assert.equal((await f.request('/api/bootstrap')).value.session.revision,0);
 }finally{await f.close();}
});

test('replaced checklist rejects stale confirmation, MCP action, clear and model request at matching revisions',async()=>{
 let modelCalls=0;const f=await fixture({model:async()=>{modelCalls++;throw new Error('Should not run');}});
 try{
  const prepare=async()=>{const created=await f.request('/api/session',{templateId:'travel-packing'});const id=created.value.session.id;await f.request('/api/command',{command:{type:'start',expectedRevision:0},requestId:randomUUID(),expectedSessionId:id});const r=await f.client.callTool({name:'report_progress',arguments:{stepId:'choose-bag',status:'confirmed',evidence:'Bag ready',expectedRevision:1,expectedSessionId:id,requestId:randomUUID()}});assert.ok(!r.isError);return id;};
  const oldId=await prepare();await f.request('/api/session',{expectedSessionId:oldId},'DELETE');const newId=await prepare();assert.notEqual(newId,oldId);
  assert.equal((await f.request('/api/command',{command:{type:'confirm',stepId:'choose-bag',expectedRevision:2},requestId:randomUUID(),expectedSessionId:oldId})).status,409);
  const staleTool=await f.client.callTool({name:'interrupt_task',arguments:{expectedRevision:2,expectedSessionId:oldId,requestId:randomUUID()}});assert.ok(staleTool.isError);assert.match((staleTool.content as any)[0].text,/STALE_SESSION/);
  assert.equal((await f.request('/api/session',{expectedSessionId:oldId},'DELETE')).status,409);
  assert.equal((await f.request('/api/interpret',{text:'Done',expectedRevision:2,expectedSessionId:oldId})).status,409);assert.equal(modelCalls,0);
  const current=await f.request('/api/bootstrap');assert.equal(current.value.session.id,newId);assert.equal(current.value.session.revision,2);assert.equal(current.value.session.steps[0].status,'uncertain');
 }finally{await f.close();}
});
