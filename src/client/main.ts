import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Session,Template,Command} from '../domain/index.js';
import './style.css';

const root=document.querySelector<HTMLDivElement>('#app')!;
let session:Session|null=null, templates:Template[]=[], busy=false, error='', notice='';
let modelEnabled=false, modelLabel='', modelProposal:any=null, selectedStep='';
let client:Client|null=null, toolNames:string[]=[], speechActive=false;
let transcript='', reportStatus='started', voiceOutput=false;
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const icons=['↗','✳','⌁'];
async function api(path:string,init:RequestInit={}):Promise<any>{
 const response=await fetch(path,{...init,headers:{'Content-Type':'application/json',...init.headers}});
 const value=await response.json();
 if(!response.ok)throw new Error(value.error??'Request failed.');
 return value;
}
async function connect(){
 client=new Client({name:'holdthat-browser',version:'0.1.0'});
 await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',location.origin)));
 toolNames=(await client.listTools()).tools.map(t=>t.name);
}
async function refresh(){
 const data=await api('/api/bootstrap');templates=data.templates;session=data.session;modelEnabled=data.model.enabled;modelLabel=data.model.label;
 if(session&&!session.steps.some(s=>s.id===selectedStep))selectedStep=nextStep()?.id??session.steps[0].id;
}
function nextStep(){
 return session?.steps.find(s=>(s.status==='started'||s.status==='uncertain')&&s.dependencies.every(id=>session!.steps.find(t=>t.id===id)?.status==='confirmed'))
 ??session?.steps.find(s=>s.status==='pending'&&s.dependencies.every(id=>session!.steps.find(t=>t.id===id)?.status==='confirmed'));
}
async function action(fn:()=>Promise<void>){
 if(busy)return;busy=true;error='';notice='';render();
 try{await fn();}catch(e){error=e instanceof Error?e.message:'Something went wrong.';try{await refresh();}catch{/* Preserve the last readable state during network loss. */}}
 finally{busy=false;render();}
}
async function manual(command:Command){
 const data=await api('/api/command',{method:'POST',body:JSON.stringify({command:{...command,expectedRevision:session!.revision},requestId:crypto.randomUUID(),expectedSessionId:session!.id})});
 session=data.session;modelProposal=null;
}
async function tool(name:string,args:Record<string,unknown>){
 if(!client)await connect();
 const result=await client!.callTool({name,arguments:name==='get_session'?args:{...args,expectedSessionId:session!.id}});
 const text=(result.content as Array<{type:string;text?:string}>).find(c=>c.type==='text')?.text;
 if(!text)throw new Error('The tool returned no readable result.');
 const value=JSON.parse(text);
 if(result.isError)throw new Error(value.error??'The action was refused.');
 session=value.session;modelProposal=null;
 if(voiceOutput&&value.decision?.message)speak(value.decision.message);
 return value;
}
function speak(text:string){if('speechSynthesis'in window){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(text));}}
function render(){
 const active=!!session;
 const template=templates.find(t=>t.id===session?.templateId);
 const confirmed=session?.steps.filter(s=>s.status==='confirmed').length??0;
 const total=session?.steps.length??0;
 const next=nextStep();
 const paused=session?.phase==='INTERRUPTED';
 const done=session?.phase==='DONE';
 const pending=session?.pendingConfirmation;
 if(!selectedStep||!session?.steps.some(s=>s.id===selectedStep&&s.status!=='confirmed'))selectedStep=next?.id??'';
 root.innerHTML=`
 <div class="shell">
 <aside class="sidebar">
  <a class="brand" href="/" aria-label="HoldThat home"><span class="brand-mark">h<span>·</span></span>HoldThat</a>
  <div class="sidebar-label">YOUR SPACE</div>
  <div class="nav-item selected"><span>◷</span> Current checklist <span class="nav-dot"></span></div>
  <div class="sidebar-note"><div class="small-icon">Ⅱ</div><h3>Life happens.<br>Your place stays.</h3><p>A pause is just a pause. Pick up from what you actually know.</p></div>
  <div class="privacy-note"><span>◈</span><p>Private to this browser.<br>No account needed.</p></div>
 </aside>
 <main>
 <header class="topbar"><span>ONE THING AT A TIME</span><span class="simulation">Alexa+ experience simulation</span></header>
 <section class="heading"><div><p class="eyebrow">A LITTLE LESS TO REMEMBER</p><h1>${active?(done?'All accounted for.':paused?'Take your time.':'Right where you left off.'):'Pause. Come back.<br>Carry on.'}</h1><p class="subtitle">${active?(paused?'Your checkpoint is saved. Nothing uncertain has been marked done.':done?'Every step has your explicit confirmation.':'Keep what is confirmed. Clear up what is uncertain. Take the next small step.'):'A small space for tasks that get interrupted. Save your progress without guessing what is done.'}</p></div><div class="hero-symbol" aria-hidden="true"><span>Ⅱ</span><i></i><b>↗</b></div></section>
 ${error?`<div class="alert error" role="alert">${esc(error)}</div>`:''}
 ${notice?`<div class="alert" role="status">${esc(notice)}</div>`:''}
 ${!active?`
  <section class="choose"><div class="section-heading"><h2>What are you getting ready?</h2><span>3 simple checklists</span></div>
  <div class="template-grid">${templates.map((t,i)=>`<button class="template-card" data-template="${esc(t.id)}" ${busy?'disabled':''}><span class="template-icon">${icons[i]}</span><span class="template-title">${esc(t.title)}</span><span class="template-description">${esc(t.description)}</span><span class="template-bottom">${t.steps.length} steps <b>Start checklist ↗</b></span></button>`).join('')}</div>
  <div class="how"><span class="number">01</span><p><strong>Say where you are</strong><br>Started, unsure or finished — each means something different.</p><span class="number">02</span><p><strong>Pause whenever</strong><br>Your reports stay with the checklist.</p><span class="number">03</span><p><strong>Resume with confidence</strong><br>Confirm the uncertain bit, then carry on.</p></div></section>
 `:`
 <div class="workspace"><section class="task-panel">
  <div class="task-top"><div><span class="eyebrow">CURRENT CHECKLIST</span><h2>${esc(template?.title)}</h2></div><span class="phase ${paused?'paused':''}">${done?'Complete':paused?'Paused':'In progress'}</span></div>
  <div class="progress-meta"><span>${confirmed} of ${total} confirmed</span><span>Saved · revision ${session!.revision}</span></div><progress max="${total}" value="${confirmed}" aria-label="Confirmed steps"></progress>
  <ol class="steps">${session!.steps.map((s,i)=>`<li class="step ${s.status}"><span class="step-number">${s.status==='confirmed'?'✓':String(i+1).padStart(2,'0')}</span><div><strong>${esc(s.title)}</strong><span class="step-state">${s.status==='confirmed'?'Confirmed by you':s.status==='started'?'Started · completion unknown':s.status==='uncertain'?'Needs clarification':'Not yet reported'}</span></div>${s.status!=='pending'?`<button class="text-button" data-correct="${esc(s.id)}" ${busy?'disabled':''} aria-label="Correct ${esc(s.title)}">Correct</button>`:''}</li>`).join('')}</ol>
  <div class="task-actions">${session!.phase==='READY'?`<button id="start-current" class="primary" ${busy?'disabled':''}>Start checklist</button>`:done?'':`<button id="pause" class="${paused?'primary':'secondary'}" ${busy?'disabled':''}>${paused?'↗ Resume checklist':'Ⅱ Pause for now'}</button>`}<a class="text-button" href="/api/export" download>Export checkpoint ↓</a></div>
 </section>
 <section class="review-panel" aria-label="Progress review">
  ${paused?`<div class="pause-card"><span class="big-pause">Ⅱ</span><h2>Safely on pause.</h2><p>${confirmed} confirmed step${confirmed===1?'':'s'} saved. Resume when you are ready; we will check what is still unclear.</p><button id="resume-card" class="primary" ${busy?'disabled':''}>Pick it back up ↗</button></div>`:done?`<div class="pause-card"><span class="big-pause">✓</span><h2>You have your place.</h2><p>All steps are confirmed by you. The history keeps every report and correction.</p><button id="new-task" class="primary">Choose another checklist</button></div>`:pending?`
  <div class="clarification"><span class="eyebrow">ONE QUICK CHECK</span><h2>Finished, or just started?</h2><blockquote>“${esc(pending.evidence)}”</blockquote><p>Can you confirm that you finished <strong>${esc(session!.steps.find(s=>s.id===pending.stepId)?.title)}</strong>?</p><button id="confirm" class="primary" ${busy?'disabled':''}>Yes, I finished this step</button><button id="not-yet" class="secondary" ${busy?'disabled':''}>Not yet — keep it started</button><p class="hint">A report alone never marks a step complete.</p></div>
  `:`
  <div class="next-card"><span class="eyebrow">${next?.status==='pending'?'YOUR NEXT SMALL STEP':'LET’S CLEAR THIS UP'}</span><h2>${esc(next?.title??'Review your progress')}</h2><p>${next?.status==='pending'?'Tell us where you are. You will always review a completion before it is saved.':'You started this step, but its completion is still unknown. Tell us what happened before moving on.'}</p></div>
  <form id="progress-form"><label for="step">Which step?</label><select id="step" name="step">${session!.steps.filter(s=>s.status!=='confirmed').map(s=>`<option value="${esc(s.id)}" ${s.id===selectedStep?'selected':''} ${s.dependencies.some(id=>session!.steps.find(t=>t.id===id)?.status!=='confirmed')?'disabled':''}>${esc(s.title)}</option>`).join('')}</select><label for="statement">What happened?</label><textarea id="statement" name="statement" maxlength="2000" placeholder="For example: I started laying out my clothes…" required>${esc(transcript)}</textarea><button id="dictate" class="voice-button" type="button">${speechActive?'Stop dictation':'◎ Dictate an update'}</button><p class="hint">Optional dictation uses your browser’s speech service. HoldThat does not store raw audio.</p>
  <label for="status">This means…</label><select id="status" name="status"><option value="started" ${reportStatus==='started'?'selected':''}>I started, but have not confirmed completion</option><option value="uncertain" ${reportStatus==='uncertain'?'selected':''}>I am unsure whether I finished</option><option value="confirmed" ${reportStatus==='confirmed'?'selected':''}>I finished — ask me to confirm</option></select>
  <button class="primary" type="submit" ${busy?'disabled':''}>Save progress ↗</button>
  ${modelEnabled?`<button id="interpret" class="secondary" type="button" ${busy?'disabled':''}>Suggest an interpretation with AI</button><p class="mode-note">Interpretation: ${esc(modelLabel)} · review before using.</p>`:'<p class="mode-note">Manual progress controls · AI interpretation is not configured.</p>'}
  </form>
  ${modelProposal?`<div class="proposal"><strong>Review AI interpretation</strong><p>${esc(modelProposal.intent.message)}</p><p>${esc(modelProposal.intent.action)} · ${esc(modelProposal.intent.status??'')} · ${esc(session!.steps.find(s=>s.id===modelProposal.intent.stepId)?.title??'No step change')}</p><button id="apply-proposal" class="secondary">Use this interpretation</button><p class="hint">No progress has changed yet. Completion still needs your separate confirmation.</p></div>`:''}
  `}
 </section></div>
 <section class="history"><div class="section-heading"><h2>Your checkpoint history</h2><span>Reports, never guesses</span></div><ol>${[...session!.events].reverse().slice(0,12).map(e=>`<li><span class="history-dot ${e.type==='confirmed'?'green':''}"></span><div><strong>${esc(e.type.replaceAll('_',' '))}</strong><p>${esc(e.message)}</p></div><span class="revision">r${e.at}</span></li>`).join('')}</ol></section>
 `}
 <footer><span>Small steps. A clear place to return.</span><div><label class="read-aloud"><input id="read-aloud" type="checkbox" ${voiceOutput?'checked':''}> Read resume guidance aloud</label>${active?'<button id="clear" class="text-button">Clear my session</button>':''}</div></footer>
 <details class="technical"><summary>Connection & privacy details</summary><p>This is an Alexa+ experience simulation, not a native Alexa device connection. Progress tools use a real MCP connection to this server. ${client?'Connected tools: '+esc(toolNames.join(', ')):'Connecting…'}. ${modelEnabled?'Interpreter configured: '+esc(modelLabel)+'. Configuration alone does not verify live inference.':'No model inference is enabled; manual controls are deterministic.'}</p><p>Reports are stored in a private browser-bound session on this server. Unused sessions are removed after seven days when the server next starts. Clear your session to delete it now. Export before clearing if you want a copy.</p></details>
 </main></div>`;
 bind();
}
let recognition:any=null;
function bind(){
 document.querySelectorAll<HTMLButtonElement>('[data-template]').forEach(b=>b.onclick=()=>void action(async()=>{
  const data=await api('/api/session',{method:'POST',body:JSON.stringify({templateId:b.dataset.template})});session=data.session;await manual({type:'start'});selectedStep=nextStep()?.id??'';
 }));
 const pause=()=>void action(async()=>{await tool(session!.phase==='INTERRUPTED'?'resume_task':'interrupt_task',{expectedRevision:session!.revision,requestId:crypto.randomUUID()});});
 document.getElementById('start-current')?.addEventListener('click',()=>void action(async()=>{await manual({type:'start'});}));
 document.getElementById('pause')?.addEventListener('click',pause);document.getElementById('resume-card')?.addEventListener('click',pause);
 document.getElementById('confirm')?.addEventListener('click',()=>void action(async()=>{await manual({type:'confirm',stepId:session!.pendingConfirmation!.stepId});transcript='';selectedStep=nextStep()?.id??'';}));
 document.getElementById('not-yet')?.addEventListener('click',()=>void action(async()=>{await tool('report_progress',{stepId:session!.pendingConfirmation!.stepId,status:'started',evidence:'I have not finished this step yet.',expectedRevision:session!.revision,requestId:crypto.randomUUID()});}));
 document.querySelectorAll<HTMLButtonElement>('[data-correct]').forEach(b=>b.onclick=()=>{
  const reason=prompt('What needs correcting? Dependent steps will need rechecking.');if(!reason?.trim())return;
  void action(async()=>{await manual({type:'correct',stepId:b.dataset.correct!,status:'pending',reason});notice='Correction saved. Earlier reports remain in the history.';});
 });
 const clear=()=>{if(confirm('Delete this checklist and all its reports from the server? Export first if you want a copy.'))void action(async()=>{await api('/api/session',{method:'DELETE',body:JSON.stringify({expectedSessionId:session!.id})});session=null;transcript='';modelProposal=null;notice='Your session was cleared.';});};
 document.getElementById('clear')?.addEventListener('click',clear);document.getElementById('new-task')?.addEventListener('click',clear);
 document.querySelector<HTMLSelectElement>('#step')?.addEventListener('change',e=>{selectedStep=(e.target as HTMLSelectElement).value;modelProposal=null;});
 document.querySelector<HTMLTextAreaElement>('#statement')?.addEventListener('input',e=>{transcript=(e.target as HTMLTextAreaElement).value;modelProposal=null;});
 document.querySelector<HTMLSelectElement>('#status')?.addEventListener('change',e=>{reportStatus=(e.target as HTMLSelectElement).value;});
 document.querySelector<HTMLFormElement>('#progress-form')?.addEventListener('submit',e=>{
  e.preventDefault();void action(async()=>{await tool('report_progress',{stepId:selectedStep,status:reportStatus,evidence:transcript,expectedRevision:session!.revision,requestId:crypto.randomUUID()});transcript='';});
 });
 document.getElementById('interpret')?.addEventListener('click',()=>void action(async()=>{
  modelProposal=await api('/api/interpret',{method:'POST',body:JSON.stringify({text:transcript,expectedRevision:session!.revision,expectedSessionId:session!.id})});
 }));
 document.getElementById('apply-proposal')?.addEventListener('click',()=>void action(async()=>{
  const p=modelProposal;if(p.expectedSessionId!==session!.id||p.expectedRevision!==session!.revision)throw new Error('Progress changed. Request a fresh interpretation.');
  if(p.intent.action==='clarify'){notice=p.intent.message;return;}
  const name=p.intent.action==='report'?'report_progress':p.intent.action==='interrupt'?'interrupt_task':'resume_task';
  const args:Record<string,unknown>={expectedRevision:session!.revision,requestId:crypto.randomUUID()};
  if(p.intent.action==='report')Object.assign(args,{stepId:p.intent.stepId,status:p.intent.status,evidence:p.intent.evidence});
  await tool(name,args);transcript='';
 }));
 document.querySelector<HTMLInputElement>('#read-aloud')?.addEventListener('change',e=>{voiceOutput=(e.target as HTMLInputElement).checked;if(!voiceOutput&&'speechSynthesis'in window)speechSynthesis.cancel();});
 document.getElementById('dictate')?.addEventListener('click',()=>{
  if(speechActive){recognition?.stop();return;}
  const Speech=(window as any).SpeechRecognition??(window as any).webkitSpeechRecognition;
  if(!Speech){error='Dictation is unavailable in this browser. Type your update below; every other control still works.';render();return;}
  recognition=new Speech();recognition.lang='en-US';recognition.continuous=false;recognition.interimResults=false;
  recognition.onresult=(event:any)=>{transcript=event.results[0][0].transcript;notice='Review the transcription before saving it.';};
  recognition.onerror=()=>{error='Microphone access or dictation failed. Type your update instead.';};
  recognition.onend=()=>{speechActive=false;render();document.querySelector<HTMLTextAreaElement>('#statement')?.focus();};
  try{recognition.start();speechActive=true;render();}catch{error='Dictation could not start. Type your update instead.';render();}
 });
}
window.addEventListener('beforeunload',()=>{recognition?.abort();});
await action(async()=>{await refresh();await connect();});
