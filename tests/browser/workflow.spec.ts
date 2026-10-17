import {test,expect} from '@playwright/test';

test('old tab cannot confirm a replacement checklist at the same revision',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:/Pack an overnight bag/}).click();await page.getByLabel('What happened?').fill('Old bag is ready');await page.getByLabel('This means…').selectOption('confirmed');await page.getByRole('button',{name:'Save progress'}).click();await expect(page.getByRole('button',{name:'Yes, I finished this step'})).toBeVisible();
 const old=(await(await page.request.get('/api/bootstrap')).json()).session;
 await page.request.delete('/api/session',{data:{expectedSessionId:old.id}});
 const fresh=(await(await page.request.post('/api/session',{data:{templateId:'travel-packing'}})).json()).session;
 await page.request.post('/api/command',{data:{command:{type:'start',expectedRevision:0},expectedSessionId:fresh.id,requestId:crypto.randomUUID()}});
 await page.request.post('/mcp',{headers:{Accept:'application/json, text/event-stream'},data:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'report_progress',arguments:{stepId:'choose-bag',status:'confirmed',evidence:'Replacement bag',expectedRevision:1,expectedSessionId:fresh.id,requestId:crypto.randomUUID()}}}});
 await page.getByRole('button',{name:'Yes, I finished this step'}).click();await expect(page.getByRole('alert')).toContainText('replaced');const after=(await(await page.request.get('/api/bootstrap')).json()).session;expect(after.id).toBe(fresh.id);expect(after.revision).toBe(2);expect(after.steps[0].status).toBe('uncertain');
});

test('choose, report, confirm, pause, reload and resume without invented completion',async({page})=>{
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'What are you getting ready?'})).toBeVisible();
 await page.getByRole('button',{name:/Pack an overnight bag/}).click();
 await page.getByLabel('What happened?').fill('The overnight bag is open.');
 await page.getByLabel('This means…').selectOption('confirmed');
 await page.getByRole('button',{name:'Save progress'}).click();
 await expect(page.getByText('0 of 5 confirmed')).toBeVisible();
 await page.getByRole('button',{name:'Yes, I finished this step'}).click();
 await expect(page.getByText('1 of 5 confirmed')).toBeVisible();
 await page.getByLabel('What happened?').fill('I started laying out shirts.');
 await page.getByLabel('This means…').selectOption('started');
 await page.getByRole('button',{name:'Save progress'}).click();
 await page.getByRole('button',{name:'Pause for now'}).click();
 await page.reload();
 await expect(page.getByRole('heading',{name:'Safely on pause.'})).toBeVisible();
 await page.getByRole('button',{name:'Pick it back up'}).click();
 await expect(page.getByText('1 of 5 confirmed')).toBeVisible();
 await expect(page.getByText('Started · completion unknown')).toBeVisible();
 await expect(page.getByRole('heading',{name:'Lay out the clothes for the trip'})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('resume.png'),fullPage:true});
});
test('explicit correction retains history and returns to the right step',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:/Pack an overnight bag/}).click();
 await page.getByLabel('What happened?').fill('Bag open.');await page.getByLabel('This means…').selectOption('confirmed');
 await page.getByRole('button',{name:'Save progress'}).click();await page.getByRole('button',{name:'Yes, I finished this step'}).click();
 page.once('dialog',dialog=>dialog.accept('I opened the wrong bag.'));
 await page.getByRole('button',{name:'Correct Choose and open the overnight bag',exact:true}).click();
 await expect(page.getByText('0 of 5 confirmed')).toBeVisible();
 await expect(page.getByText(/Changed confirmed to pending/)).toBeVisible();
 await expect(page.getByRole('heading',{name:'Choose and open the overnight bag'})).toBeVisible();
});
test('complete a five-step checklist, export it, and explicitly clear',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:/Prepare a paper craft kit/}).click();
 for(let i=0;i<5;i++){
  await page.getByLabel('What happened?').fill('I finished the selected step '+(i+1)+'.');
  await page.getByLabel('This means…').selectOption('confirmed');
  await page.getByRole('button',{name:'Save progress'}).click();
  await page.getByRole('button',{name:'Yes, I finished this step'}).click();
 }
 await expect(page.getByRole('heading',{name:'All accounted for.'})).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('link',{name:'Export checkpoint'}).click();expect((await download).suggestedFilename()).toBe('holdthat-checkpoint.json');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Clear my session'}).click();
 await expect(page.getByRole('heading',{name:'What are you getting ready?'})).toBeVisible();
});
test('model-unavailable state is explicit and keyboard-only controls work',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:/Organise a spare cable kit/}).focus();await page.keyboard.press('Enter');
 await expect(page.getByText('Manual progress controls · AI interpretation is not configured.')).toBeVisible();
 await page.getByLabel('What happened?').fill('I am unsure whether I opened the case.');
 await page.getByLabel('This means…').selectOption('uncertain');await page.getByRole('button',{name:'Save progress'}).focus();await page.keyboard.press('Enter');
 await expect(page.getByText('Needs clarification', {exact:true})).toBeVisible();
 await expect(page.getByText('0 of 5 confirmed')).toBeVisible();
});
test('stored statements are displayed as text and never execute HTML',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:/Pack an overnight bag/}).click();
 await page.getByLabel('What happened?').fill('<img src=x onerror="window.hacked=true">');
 await page.getByRole('button',{name:'Save progress'}).click();
 expect(await page.evaluate(()=>(window as any).hacked)).toBeUndefined();
 await expect(page.locator('img[src=x]')).toHaveCount(0);
});
test('a creation interrupted before start can be recovered after reload',async({page})=>{
 await page.goto('/');
 await page.request.post('/api/session',{data:{templateId:'craft-kit'}});
 await page.reload();
 await page.getByRole('button',{name:'Start checklist',exact:true}).click();
 await page.getByLabel('What happened?').fill('I started opening the pouch.');
 await page.getByRole('button',{name:'Save progress'}).click();
 await expect(page.getByText('Started · completion unknown')).toBeVisible();
});
test('unsupported dictation preserves the typed workflow',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(window,'SpeechRecognition',{value:undefined,configurable:true});Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined,configurable:true});});
 await page.goto('/');await page.getByRole('button',{name:/Pack an overnight bag/}).click();
 await page.getByRole('button',{name:'Dictate an update'}).click();
 await expect(page.getByRole('alert')).toContainText('Dictation is unavailable');
 await page.getByLabel('What happened?').fill('I started finding a bag.');
 await page.getByRole('button',{name:'Save progress'}).click();
 await expect(page.getByText('Started · completion unknown')).toBeVisible();
});
