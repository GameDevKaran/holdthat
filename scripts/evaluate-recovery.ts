import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSession,applyCommand,getResumeDecision,type Command} from '../src/domain/index.js';

const raw=readFileSync('evaluation/recovery-cases.json','utf8');
type Case={id:string;template:string;actions:Array<[string,number?]>;next:number|null;kind:string;confirmed:number;errors?:string[]};
const fixtures=JSON.parse(raw) as {scope:string;cases:Case[]};
const rows=fixtures.cases.map(c=>{
 let state=createSession(c.template,c.id);const ids=state.steps.map(s=>s.id);const errors:string[]=[];
 const checked=new Set<number>();let last:number|null=null;
 for(const [action,index] of c.actions){
  const stepId=ids[index??0];let command:Command;
  switch(action){
   case 'start':command={type:'start'};break;
   case 'pause':command={type:'interrupt'};break;
   case 'resume':command={type:'resume'};break;
   case 'reset':command={type:'reset'};break;
   case 'stale-pause':command={type:'interrupt',expectedRevision:0};break;
   case 'confirm':command={type:'confirm',stepId};break;
   case 'correct':command={type:'correct',stepId,status:'pending',reason:'Manual correction: this work needs rechecking.'};break;
   default:command={type:'report',stepId,status:action==='done'?'confirmed':action as 'started'|'uncertain',evidence:action==='uncertain'?'Not finished / unsure: encoded as uncertainty by the fixture.':'Synthetic user report: '+action};
  }
  try{state=applyCommand(state,command);}catch(e){errors.push((e as {code:string}).code);continue;}
  // Both simple baselines receive accepted actions; neither is disadvantaged by parsing errors.
  if(index!==undefined)last=index;
  if(action==='confirm')checked.add(index!);
  if(action==='correct')checked.delete(index!);
  if(action==='reset'){checked.clear();last=null;}
 }
 const decision=getResumeDecision(state);const actual={next:decision.stepId===null?null:ids.indexOf(decision.stepId),kind:decision.kind,confirmed:state.steps.filter(s=>s.status==='confirmed').length};
 const expected={next:c.next,kind:c.kind,confirmed:c.confirmed};
 const staticNext=ids.findIndex((_,i)=>!checked.has(i));
 const staticResult={next:staticNext<0?null:staticNext,kind:staticNext<0?'complete':'next',confirmed:checked.size};
 // Last-task reminder deliberately has no substep status; it repeats the last touched step.
 const reminderResult={next:last??0,kind:'next',confirmed:checked.size};
 const same=(value:typeof expected)=>JSON.stringify(value)===JSON.stringify(expected);
 return {id:c.id,expected,actual,errors,passed:same(actual)&&JSON.stringify(errors)===JSON.stringify(c.errors??[]),staticChecklist:staticResult,staticPass:same(staticResult),lastReminder:reminderResult,reminderPass:same(reminderResult)};
});
const result={runAt:new Date().toISOString(),fixtureSha256:createHash('sha256').update(raw).digest('hex'),scope:fixtures.scope,total:rows.length,holdThatPassed:rows.filter(r=>r.passed).length,staticChecklistPassed:rows.filter(r=>r.staticPass).length,lastReminderPassed:rows.filter(r=>r.reminderPass).length,rows};
writeFileSync('evaluation/results.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,rows:undefined},null,2));
if(result.holdThatPassed!==result.total)process.exitCode=1;
