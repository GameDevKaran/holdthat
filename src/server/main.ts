import {SessionStore} from './store.js';
import {createApp} from './app.js';
import {createBedrockInterpreter} from './model.js';

const port=Number(process.env.PORT??3210);
const host=process.env.HOST??'127.0.0.1';
const origin=process.env.HOLDTHAT_ORIGIN||undefined;
const production=process.env.NODE_ENV==='production';
if(production && (!origin || new URL(origin).protocol!=='https:'))throw new Error('Production requires HOLDTHAT_ORIGIN with the exact public HTTPS origin.');
const enabled=process.env.HOLDTHAT_MODEL_PROVIDER==='bedrock';
const region=process.env.BEDROCK_REGION||process.env.AWS_REGION;
const modelId=process.env.BEDROCK_MODEL_ID;
if(enabled && (!region||!modelId))throw new Error('Bedrock mode requires an authorized AWS region and BEDROCK_MODEL_ID.');
const store=new SessionStore(process.env.HOLDTHAT_DATABASE_PATH??'.local/holdthat.sqlite');
const app=createApp({store,origin,production,model:enabled?createBedrockInterpreter({region:region!,modelId:modelId!}):undefined,modelCallsPerSession:Number(process.env.HOLDTHAT_MODEL_CALLS_PER_SESSION??30),modelCallsPerDay:Number(process.env.HOLDTHAT_MODEL_CALLS_PER_DAY??300)});
const server=app.listen(port,host,()=>console.log('HoldThat listening on http://'+host+':'+port+'; model: '+(enabled?'configured Bedrock (unverified until called)':'disabled')));
function shutdown(){server.close(()=>{store.close();process.exit(0);});server.closeIdleConnections();setTimeout(()=>process.exit(1),5000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
