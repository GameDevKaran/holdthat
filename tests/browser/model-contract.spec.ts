import {test,expect} from '@playwright/test';
test('labelled provider double proposes, then MCP reports, then the user confirms',async({page})=>{
 await page.goto('http://127.0.0.1:3213');await page.getByRole('button',{name:/Pack an overnight bag/}).click();
 await expect(page.getByText(/^Interpretation: TEST DOUBLE — no live inference/)).toBeVisible();
 await page.getByLabel('What happened?').fill('I finished opening the bag.');
 await page.getByRole('button',{name:'Suggest an interpretation with AI'}).click();
 await expect(page.getByText('Review AI interpretation',{exact:true})).toBeVisible();
 await expect(page.getByText('0 of 5 confirmed')).toBeVisible();
 await page.getByRole('button',{name:'Use this interpretation'}).click();
 await expect(page.getByText('0 of 5 confirmed')).toBeVisible();
 await page.getByRole('button',{name:'Yes, I finished this step'}).click();
 await expect(page.getByText('1 of 5 confirmed')).toBeVisible();
});
test('provider-double failure does not block typed progress or change state',async({page})=>{
 await page.goto('http://127.0.0.1:3213');await page.getByRole('button',{name:/Pack an overnight bag/}).click();
 await page.getByLabel('What happened?').fill('Simulate provider failure');await page.getByRole('button',{name:'Suggest an interpretation with AI'}).click();
 await expect(page.getByRole('alert')).toContainText('No progress was changed');
 await expect(page.getByText('0 of 5 confirmed')).toBeVisible();
 await page.getByLabel('What happened?').fill('I started opening the bag.');await page.getByRole('button',{name:'Save progress'}).click();
 await expect(page.getByText('Started · completion unknown')).toBeVisible();
});
