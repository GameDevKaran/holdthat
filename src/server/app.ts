import express, {type Request,type Response,type NextFunction} from 'express';
import {createHash,randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {z} from 'zod';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {DomainError,getResumeDecision,templates,type Command} from '../domain/index.js';
import {SessionStore} from './store.js';
import type {ModelInterpreter} from './model.js';

const revision=z.number().int().nonnegative();
const requestId=z.string().uuid();
const manualCommand=z.discriminatedUnion('type',[
 z.object({type:z.literal('start'),expectedRevision:revision}).strict(),
 z.object({type:z.literal('confirm'),stepId:z.string(),expectedRevision:revision}).strict(),
 z.object({type:z.literal('correct'),stepId:z.string(),status:z.enum(['pending','started','uncertain']),reason:z.string().trim().min(1).max(2000),expectedRevision:revision}).strict(),
 z.object({type:z.literal('reset'),expectedRevision:revision}).strict(),
]);
export interface AppOptions {store:SessionStore;origin?:string;production?:boolean;model?:ModelInterpreter;modelLabel?:string;modelCallsPerSession?:number;modelCallsPerDay?:number;dist?:string}
export function createApp(options:AppOptions){
 const app=express();
 app.disable('x-powered-by');
 const requests=new Map<string,{count:number;until:number}>();
 const modelCounts=new Map<string,number>(); let day='',dailyCalls=0;
 app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('Cache-Control','no-store');
  if(req.path==='/api/health') return next();
  const host=req.get('host')??'';
  if(options.origin ? host!==new URL(options.origin).host : !['localhost','127.0.0.1','[::1]'].includes(req.hostname)){
   return res.status(403).json({error:'Unrecognized host.'});
  }
  const origin=req.get('origin');
  if(origin && (options.origin ? origin!==options.origin : !['http://'+host,'http://127.0.0.1:5173','http://localhost:5173'].includes(origin))){
   return res.status(403).json({error:'This request came from a different site.'});
  }
  if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'Cross-site requests are not allowed.'});
  next();
 });
 app.use(express.json({limit:'24kb'}));
 app.get('/api/health',(_req,res)=>res.json({status:'ok',application:'holdthat'}));
 function identity(req:Request,res:Response,create=false):string|null{
  const token=(req.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith('holdthat='))?.slice(9);
  if(token && /^[a-f0-9]{64}$/.test(token))return createHash('sha256').update(token).digest('hex');
  if(!create){res.status(401).json({error:'Open HoldThat to create a private session first.'});return null;}
  const fresh=randomBytes(32).toString('hex');
  res.setHeader('Set-Cookie', 'holdthat='+fresh+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800'+(options.production?'; Secure':''));
  return createHash('sha256').update(fresh).digest('hex');
 }
 function limited(owner:string,res:Response):boolean{
  const now=Date.now();const record=requests.get(owner);
  if(requests.size>10000){for(const [key,value] of requests)if(value.until<now)requests.delete(key);}
  if(!record||record.until<now){requests.set(owner,{count:1,until:now+60000});return false;}
  if(++record.count>120){res.setHeader('Retry-After','60');res.status(429).json({error:'Too many requests. Wait a minute and retry.'});return true;}return false;
 }
 app.get('/api/bootstrap',(req,res)=>{
  const owner=identity(req,res,true)!;
  res.json({templates,session:options.store.get(owner),model:{enabled:!!options.model,label:options.model?options.modelLabel??'Bedrock':'Manual controls — no AI inference'},simulation:'Alexa+ experience simulation; no native Alexa connection'});
 });
 app.post('/api/session',(req,res,next)=>{try{
  const owner=identity(req,res);if(!owner||limited(owner,res))return;
  const input=z.object({templateId:z.string()}).strict().parse(req.body);
  res.status(201).json({session:options.store.create(owner,input.templateId)});
 }catch(e){next(e);}});
 app.delete('/api/session',(req,res,next)=>{try{
  const owner=identity(req,res);if(!owner)return;
  options.store.clear(owner);modelCounts.delete(owner);res.json({cleared:true});
 }catch(e){next(e);}});
 app.get('/api/export',(req,res)=>{
  const owner=identity(req,res);if(!owner)return;
  const session=options.store.get(owner);
  if(!session)return res.status(404).json({error:'No checklist to export.'});
  res.setHeader('Content-Disposition','attachment; filename="holdthat-checkpoint.json"');
  res.json({application:'HoldThat',exportedAt:new Date().toISOString(),evidence:'User reports and explicit confirmations, not sensor verification of physical completion.',session});
 });
 app.post('/api/command',(req,res,next)=>{try{
  const owner=identity(req,res);if(!owner||limited(owner,res))return;
  const input=z.object({command:manualCommand,requestId}).strict().parse(req.body);
  res.json({session:options.store.command(owner,input.command,input.requestId)});
 }catch(e){next(e);}});
 app.post('/api/interpret',async(req,res,next)=>{try{
  const owner=identity(req,res);if(!owner||limited(owner,res))return;
  if(!options.model)return res.status(503).json({error:'AI interpretation is not configured. Use the progress controls; they remain fully functional.',code:'MODEL_UNAVAILABLE'});
  const input=z.object({text:z.string().trim().min(1).max(2000),expectedRevision:revision}).strict().parse(req.body);
  const session=options.store.get(owner);
  if(!session)return res.status(404).json({error:'Choose a checklist first.'});
  if(session.revision!==input.expectedRevision)return res.status(409).json({error:'Checklist changed. Reload before interpreting this update.'});
  const today=new Date().toISOString().slice(0,10);if(today!==day){day=today;dailyCalls=0;}
  if((modelCounts.get(owner)??0)>=(options.modelCallsPerSession??30)||dailyCalls>=(options.modelCallsPerDay??300))return res.status(429).json({error:'Model request limit reached. Manual controls remain available.'});
  modelCounts.set(owner,(modelCounts.get(owner)??0)+1);dailyCalls++;
  try {
   const result=await options.model({text:input.text,steps:session.steps,phase:session.phase});
   // Interpretation is a proposal only. A separate user action sends it through the real MCP tool.
   res.json({...result,expectedRevision:session.revision});
  }catch {res.status(502).json({error:'The model could not produce a valid response. No progress was changed. Use manual controls or retry.',code:'MODEL_FAILED'});}
 }catch(e){next(e);}});
 app.post('/mcp',async(req,res,next)=>{
  const owner=identity(req,res);if(!owner||limited(owner,res))return;
  const server=new McpServer({name:'holdthat',version:'0.1.0'});
  const reply=(session:ReturnType<SessionStore['get']>)=>({content:[{type:'text' as const,text:JSON.stringify({session,decision:session?getResumeDecision(session):null})}]});
  const run=(command:Command,key:string)=>{try{return reply(options.store.command(owner,command,key));}catch(e){return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:e instanceof Error?e.message:'Invalid action',code:e instanceof DomainError?e.code:'INVALID_ACTION'})}]};}};
  server.registerTool('get_session',{description:'Read this browser session and its next unresolved step. No physical completion is inferred.',inputSchema:{}},async()=>reply(options.store.get(owner)));
  server.registerTool('report_progress',{description:'Record what the user said about one step. Reported completion creates a proposal; it never confirms the step.',inputSchema:{stepId:z.string(),status:z.enum(['started','uncertain','confirmed']),evidence:z.string().trim().min(1).max(2000),expectedRevision:revision,requestId}},async({requestId,...input})=>run({type:'report',...input},requestId));
  server.registerTool('interrupt_task',{description:'Pause and retain confirmed, started and uncertain progress.',inputSchema:{expectedRevision:revision,requestId}},async({requestId,expectedRevision})=>run({type:'interrupt',expectedRevision},requestId));
  server.registerTool('resume_task',{description:'Resume a paused task and ask about unresolved progress without inventing completion.',inputSchema:{expectedRevision:revision,requestId}},async({requestId,expectedRevision})=>run({type:'resume',expectedRevision},requestId));
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{void transport.close();void server.close();});
  try{await server.connect(transport);await transport.handleRequest(req,res,req.body);}catch(e){if(!res.headersSent)next(e);}
 });
 app.all('/mcp',(_req,res)=>res.status(405).json({error:'Use Streamable HTTP POST. This server is stateless at the transport layer.'}));
 const dist=options.dist??resolve('dist');
 if(existsSync(dist))app.use(express.static(dist,{index:'index.html',etag:true}));
 app.use((_req,res)=>res.status(404).json({error:'Route not found.'}));
 app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
  const status=error instanceof DomainError ? (error.code==='STALE_REVISION'||error.code==='KEY_REUSED'?409:400) : error instanceof z.ZodError ? 400 : 500;
  res.status(status).json({error:error instanceof DomainError?error.message:error instanceof z.ZodError?'Invalid request fields.':'The request could not be completed.',code:error instanceof DomainError?error.code:'REQUEST_FAILED'});
 });
 return app;
}
