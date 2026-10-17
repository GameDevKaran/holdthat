import {spawn} from 'node:child_process';
import {createApp} from '../src/server/app.js';
import {SessionStore} from '../src/server/store.js';

// Own the test server directly so Windows shell teardown cannot orphan it.
const store=new SessionStore(':memory:');
const server=createApp({store}).listen(3211,'127.0.0.1');
await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
const modelStore=new SessionStore(':memory:');
const modelServer=createApp({store:modelStore,modelLabel:'TEST DOUBLE — no live inference',model:async input=>{
 if(input.text==='Simulate provider failure')throw new Error('Explicit test-double failure');
 return {intent:{action:'report',stepId:input.steps[0].id,status:'confirmed',evidence:input.text,message:'Test interpretation: you reported completion. Review before using.'},trace:{provider:'bedrock',model:'TEST DOUBLE',requestId:'test-only',latencyMs:0}};
}}).listen(3213,'127.0.0.1');
await new Promise<void>((resolve,reject)=>{modelServer.once('listening',resolve);modelServer.once('error',reject);});
const child=spawn(process.execPath,['node_modules/playwright/cli.js','test',...process.argv.slice(2)],{stdio:'inherit',shell:false});
const code=await new Promise<number>(resolve=>{child.once('exit',c=>resolve(c??1));child.once('error',()=>resolve(1));});
server.closeAllConnections();
await new Promise<void>(resolve=>server.close(()=>resolve()));
store.close();
modelServer.closeAllConnections();await new Promise<void>(resolve=>modelServer.close(()=>resolve()));modelStore.close();
process.exitCode=code;
