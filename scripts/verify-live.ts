import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {chromium, expect} from '@playwright/test';

const journal = JSON.parse(readFileSync('.local/cloud-run-deployment.json', 'utf8'));
assert.equal(journal.project, 'tough-melody-508008-p8'); assert.equal(journal.service, 'holdthat');
const base = journal.url as string;
assert.match(base, /^https:\/\/holdthat-[a-z0-9.-]+\.run\.app$/);
const phase = process.argv[2] ?? 'prepare'; assert.ok(['prepare', 'restart', 'public'].includes(phase));
const auth = process.env.HOLDTHAT_VERIFY_ID_TOKEN;
const headers: Record<string, string> = auth ? {Authorization: 'Bearer ' + auth} : {};
if (phase === 'public') assert.ok(!auth, 'Public proof must have no Cloud Run identity token.');
mkdirSync('.local/live', {recursive: true});
const savedPath = '.local/live/private-probe.json';
const report: Record<string, unknown> = {at: new Date().toISOString(), phase, url: base, commit: journal.commit,
  image: journal.image, revision: journal.revision, authentication: auth ? 'operator identity (not saved)' : 'anonymous public',
  storage: 'real GCS through deployed application', model: 'disabled; no inference claim', checks: []};
const checks = report.checks as string[];
try {
  const health = await fetch(base + '/api/health', {headers, signal: AbortSignal.timeout(30000)});
  assert.equal(health.status, 200); assert.equal((await health.json()).application, 'holdthat'); checks.push('HTTPS health');
  if (phase === 'prepare') {
    const bootstrap = await fetch(base + '/api/bootstrap', {headers}); assert.equal(bootstrap.status, 200);
    const setCookie = bootstrap.headers.get('set-cookie')!;
    assert.match(setCookie, /Secure/); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0]; assert.equal((await bootstrap.json()).session, null); checks.push('Secure private browser cookie');
    const sessionHeaders = {...headers, cookie, origin: base, 'Content-Type': 'application/json'};
    const created = await fetch(base + '/api/session', {method: 'POST', headers: sessionHeaders, body: JSON.stringify({templateId: 'travel-packing'})});
    assert.equal(created.status, 201); const {session} = await created.json();
    const start = await fetch(base + '/api/command', {method: 'POST', headers: sessionHeaders, body: JSON.stringify({command: {type: 'start', expectedRevision: 0}, requestId: randomUUID(), expectedSessionId: session.id})});
    assert.equal(start.status, 200);
    const client = new Client({name: 'holdthat-live-verifier', version: '1'});
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), {requestInit: {headers: {...headers, cookie}}}));
      const listed = await client.listTools(); assert.equal(listed.tools.length, 4); checks.push('real deployed MCP initialize and four tools');
      const result = await client.callTool({name: 'report_progress', arguments: {stepId: 'choose-bag', status: 'confirmed', evidence: 'Live verification: report remains a proposal.', expectedRevision: 1, requestId: randomUUID(), expectedSessionId: session.id}});
      assert.ok(!result.isError); const proposed = JSON.parse((result.content as any)[0].text).session;
      assert.equal(proposed.steps[0].status, 'uncertain'); checks.push('real MCP action does not invent confirmation');
    } finally { await client.close(); }
    const confirmed = await fetch(base + '/api/command', {method: 'POST', headers: sessionHeaders, body: JSON.stringify({command: {type: 'confirm', stepId: 'choose-bag', expectedRevision: 2}, requestId: randomUUID(), expectedSessionId: session.id})});
    assert.equal(confirmed.status, 200); assert.equal((await confirmed.json()).session.revision, 3);
    writeFileSync(savedPath, JSON.stringify({cookie, id: session.id, revision: 3, deployedRevision: journal.revision}));
    checks.push('explicit confirmation persisted; private probe saved for revision replacement');
    const stranger = await fetch(base + '/api/bootstrap', {headers}); assert.equal((await stranger.json()).session, null); checks.push('separate owner isolation');
    const denied = await fetch(base + '/api/session', {method: 'POST', headers: {...sessionHeaders, origin: 'https://untrusted.invalid'}, body: JSON.stringify({templateId: 'craft-kit'})});
    assert.equal(denied.status, 403); checks.push('cross-origin mutation rejected');
  } else if (phase === 'restart') {
    const probe = JSON.parse(readFileSync(savedPath, 'utf8'));
    assert.notEqual(probe.deployedRevision, journal.revision, 'A different ready revision is required for persistence evidence.');
    const sessionHeaders = {...headers, cookie: probe.cookie, origin: base, 'Content-Type': 'application/json'};
    const loaded = await fetch(base + '/api/bootstrap', {headers: sessionHeaders}); const {session} = await loaded.json();
    assert.equal(session.id, probe.id); assert.equal(session.revision, probe.revision); assert.equal(session.steps[0].status, 'confirmed');
    checks.push('confirmed progress survives actual Cloud Run revision replacement');
    const exported = await fetch(base + '/api/export', {headers: sessionHeaders}); assert.equal((await exported.json()).session.id, probe.id); checks.push('live export');
    const cleared = await fetch(base + '/api/session', {method: 'DELETE', headers: sessionHeaders, body: JSON.stringify({expectedSessionId: probe.id})}); assert.equal(cleared.status, 200);
    assert.equal((await (await fetch(base + '/api/bootstrap', {headers: sessionHeaders})).json()).session, null); checks.push('live deletion');
  } else {
    const browser = await chromium.launch(); const context = await browser.newContext({viewport: {width: 1440, height: 1000}, recordVideo: {dir: '.local/live/video', size: {width: 1440, height: 1000}}});
    try {
      const page = await context.newPage(); await page.goto(base); await expect(page.getByRole('heading', {name: 'What are you getting ready?'})).toBeVisible();
      await page.getByRole('button', {name: /Pack an overnight bag/}).click();
      await page.getByLabel('What happened?').fill('The overnight bag is open.'); await page.getByLabel('This means…').selectOption('confirmed');
      await page.getByRole('button', {name: 'Save progress'}).click(); await expect(page.getByText('0 of 5 confirmed')).toBeVisible();
      await page.getByRole('button', {name: 'Yes, I finished this step'}).click(); await expect(page.getByText('1 of 5 confirmed')).toBeVisible();
      await page.getByLabel('What happened?').fill('I started sorting clothes.'); await page.getByLabel('This means…').selectOption('started');
      await page.getByRole('button', {name: 'Save progress'}).click(); await page.getByRole('button', {name: 'Pause for now'}).click(); await page.reload();
      await expect(page.getByRole('heading', {name: 'Safely on pause.'})).toBeVisible(); await page.screenshot({path: '.local/live/holdthat-paused.png', fullPage: true});
      await page.getByRole('button', {name: 'Pick it back up'}).click(); await expect(page.getByText('Started · completion unknown')).toBeVisible();
      await expect(page.getByText('1 of 5 confirmed')).toBeVisible(); await page.screenshot({path: '.local/live/holdthat-resumed.png', fullPage: true});
      checks.push('anonymous public browser choose/report/confirm/pause/reload/resume with actual MCP');
      await page.setViewportSize({width: 390, height: 844}); await page.screenshot({path: '.local/live/holdthat-mobile.png', fullPage: true}); checks.push('desktop and mobile screenshots');
      page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', {name: 'Clear my session'}).click(); await expect(page.getByRole('heading', {name: 'What are you getting ready?'})).toBeVisible();
      checks.push('browser deletion');
    } finally { await context.close(); await browser.close(); }
  }
  report.passed = true;
} catch (error) { report.passed = false; report.error = error instanceof Error ? error.message.replace(/Bearer\s+\S+/g, 'Bearer [redacted]') : 'verification failed'; throw error; }
finally { writeFileSync('.local/live/' + phase + '-verification.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify({phase, passed: report.passed, checks})); }
