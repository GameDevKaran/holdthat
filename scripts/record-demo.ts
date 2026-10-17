import {chromium} from '@playwright/test';
import {mkdirSync,copyFileSync} from 'node:fs';
import {createApp} from '../src/server/app.js';
import {SessionStore} from '../src/server/store.js';

const output='.local/demo';mkdirSync(output,{recursive:true});
const store=new SessionStore(':memory:');
const server=createApp({store}).listen(3214,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:output,size:{width:1440,height:1000}}});
const page=await context.newPage();
const video=page.video()!;
async function caption(text:string,seconds=6){
 await page.evaluate(text=>{
  let box=document.getElementById('recording-caption');
  if(!box){box=document.createElement('div');box.id='recording-caption';document.body.append(box);Object.assign(box.style,{position:'fixed',bottom:'16px',left:'260px',right:'32px',zIndex:'9999',background:'#193e2f',color:'white',padding:'18px 24px',borderRadius:'10px',font:'16px Segoe UI, sans-serif',boxShadow:'0 8px 30px #0002'});}
  box.textContent='LOCAL DEMO · '+text;
 },text);
 await page.waitForTimeout(seconds*1000);
}
try{
 await page.goto('http://127.0.0.1:3214');
 await caption('HoldThat: resume from confirmed progress. Manual input; no live Bedrock or Alexa device connection.',8);
 await page.getByRole('button',{name:/Pack an overnight bag/}).click();
 await page.getByLabel('What happened?').fill('The overnight bag is open.');
 await page.getByLabel('This means…').selectOption('confirmed');
 await caption('A statement of completion creates a review prompt. It does not mark the step done.',6);
 await page.getByRole('button',{name:'Save progress'}).click();
 await caption('The checkpoint is still unconfirmed until the user explicitly agrees.',6);
 await page.getByRole('button',{name:'Yes, I finished this step'}).click();
 await page.getByLabel('What happened?').fill('I started laying out my shirts, but got interrupted.');
 await page.getByLabel('This means…').selectOption('started');
 await page.getByRole('button',{name:'Save progress'}).click();
 await caption('Started is different from finished. The uncertain work stays visible.',6);
 await page.getByRole('button',{name:'Pause for now'}).click();
 await caption('Pause at any time. Confirmed and unresolved progress remain separate.',6);
 await page.reload();
 await caption('Reloading recovers the saved session from the actual local backend.',6);
 await page.getByRole('button',{name:'Pick it back up'}).click();
 await caption('Resume asks about the unfinished sorting step instead of skipping ahead.',8);
 await page.getByLabel('What happened?').fill('I am not sure whether all my clothes are laid out.');
 await page.getByLabel('This means…').selectOption('uncertain');
 await page.getByRole('button',{name:'Save progress'}).click();
 await caption('Uncertainty is a valid answer. Nothing is silently marked complete.',6);
 page.once('dialog',d=>d.accept('I opened the wrong bag and need to restart that step.'));
 await page.getByRole('button',{name:'Correct Choose and open the overnight bag',exact:true}).click();
 await caption('Correcting a prerequisite reopens dependent work without erasing earlier reports.',8);
 await page.getByRole('heading',{name:'Your checkpoint history'}).scrollIntoViewIfNeeded();
 await caption('The history records actual local MCP actions, confirmations and corrections.',6);
 await page.locator('.technical summary').click();await page.locator('.technical').scrollIntoViewIfNeeded();
 await caption('MCP and persistence are tested locally. Live model accuracy, AWS deployment and the final public video are still separate gates.',8);
}finally{
 await context.close();copyFileSync(await video.path(),output+'/holdthat-local-demo.webm');
 await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();
}
console.log('Saved '+output+'/holdthat-local-demo.webm (real local workflow, captioned, no live inference).');
