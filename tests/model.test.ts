import test from 'node:test';
import assert from 'node:assert/strict';
import {createBedrockInterpreter,parseIntent,type ModelInput} from '../src/server/model.js';
const input:ModelInput={text:'I started opening the bag.',steps:[{id:'choose-bag',title:'Open the bag',status:'pending'}],phase:'ACTIVE'};
test('model parsing uses the actual user statement as evidence',()=>{const value=parseIntent({action:'report',stepId:'choose-bag',status:'started',message:'Started, not done.'},input);assert.equal(value.evidence,input.text);});
test('unknown tool actions are refused',()=>assert.throws(()=>parseIntent({action:'confirm',stepId:'choose-bag',status:'confirmed',message:'Done'},input)));
test('unknown step ids are refused',()=>assert.throws(()=>parseIntent({action:'report',stepId:'fake',status:'confirmed',message:'Done'},input)));
test('additional generated evidence fields are refused',()=>assert.throws(()=>parseIntent({action:'report',stepId:'choose-bag',status:'confirmed',message:'Done',evidence:'invented'},input)));
test('non-report intent cannot smuggle a step change',()=>assert.throws(()=>parseIntent({action:'resume',stepId:'choose-bag',status:'confirmed',message:'Done'},input)));
test('Bedrock adapter contract uses an explicitly injected test double, not a live call',async()=>{
 const interpreter=createBedrockInterpreter({region:'test-region',modelId:'test-model'},async command=>{
  assert.equal(command.input.modelId,'test-model');assert.equal(command.input.inferenceConfig?.maxTokens,400);
  return {output:{message:{content:[{text:JSON.stringify({action:'report',stepId:'choose-bag',status:'started',message:'Did you finish?'})}]}},usage:{inputTokens:12,outputTokens:10},$metadata:{requestId:'unit-test-double'}};
 });
 const result=await interpreter(input);assert.equal(result.intent.status,'started');assert.equal(result.trace.requestId,'unit-test-double');
});
test('malformed provider output fails without a result',async()=>{const fn=createBedrockInterpreter({region:'test',modelId:'test'},async()=>({output:{message:{content:[{text:'not JSON'}]}}}));await assert.rejects(()=>fn(input));});
