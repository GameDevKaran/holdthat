import {SessionStore} from './store.js';
import {createApp} from './app.js';
import {createBedrockInterpreter} from './model.js';
import {ObjectSessionStore} from './object-store.js';
import {GcsObjects} from './gcs.js';

const port=Number(process.env.PORT??3210);
const host=process.env.HOST??'127.0.0.1';
const origin=process.env.HOLDTHAT_ORIGIN||undefined;
const production=process.env.NODE_ENV==='production';
if(production && (!origin || new URL(origin).protocol!=='https:' || new URL(origin).origin!==origin))throw new Error('Production requires HOLDTHAT_ORIGIN with the exact canonical public HTTPS origin (no path, credentials, query or trailing slash).');
const enabled=process.env.HOLDTHAT_MODEL_PROVIDER==='bedrock';
const region=process.env.BEDROCK_REGION||process.env.AWS_REGION;
const modelId=process.env.BEDROCK_MODEL_ID;
if(enabled && (!region||!modelId))throw new Error('Bedrock mode requires an authorized AWS region and BEDROCK_MODEL_ID.');
const mode=process.env.HOLDTHAT_STORE??'sqlite';
if(!['sqlite','gcs'].includes(mode))throw new Error('HOLDTHAT_STORE must be sqlite or gcs.');
if(process.env.K_SERVICE && mode!=='gcs')throw new Error('Cloud Run requires the durable GCS store; SQLite is only for a persistent local volume.');
const store=mode==='gcs'
 ? new ObjectSessionStore(new GcsObjects(process.env.GCP_PROJECT_ID??'',process.env.HOLDTHAT_GCS_BUCKET??''))
 : new SessionStore(process.env.HOLDTHAT_DATABASE_PATH??'.local/holdthat.sqlite');
const app=createApp({store,origin,production,model:enabled?createBedrockInterpreter({region:region!,modelId:modelId!}):undefined,modelCallsPerSession:Number(process.env.HOLDTHAT_MODEL_CALLS_PER_SESSION??30),modelCallsPerDay:Number(process.env.HOLDTHAT_MODEL_CALLS_PER_DAY??300)});
const server=app.listen(port,host,()=>console.log('HoldThat listening on http://'+host+':'+port+'; model: '+(enabled?'configured Bedrock (unverified until called)':'disabled')));
function shutdown(){server.close(async()=>{await store.close();process.exit(0);});server.closeIdleConnections();setTimeout(()=>process.exit(1),5000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
