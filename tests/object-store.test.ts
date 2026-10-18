import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ObjectSessionStore, GenerationConflict, MAX_SESSION_BYTES, type ConditionalObjects, type ObjectSnapshot} from '../src/server/object-store.js';
import {StorageUnavailable} from '../src/server/persistence.js';
import {createApp} from '../src/server/app.js';

// Explicit storage transport test double: these tests do NOT verify live Google Cloud.
class MemoryObjects implements ConditionalObjects {
  records = new Map<string, ObjectSnapshot>();
  sequence = 9007199254740993n;
  unavailable = false;
  loseNextWriteResponse = false;
  beforeRemove?: () => Promise<void>;
  async read(name: string) { if (this.unavailable) throw new Error('PRIVATE PROVIDER DETAILS'); return structuredClone(this.records.get(name) ?? null); }
  async write(name: string, body: string, generation: string) {
    await Promise.resolve();
    if (this.unavailable) throw new Error('PRIVATE PROVIDER DETAILS');
    if ((this.records.get(name)?.generation ?? '0') !== generation) throw new GenerationConflict();
    this.records.set(name, {body, generation: String(++this.sequence)});
    if (this.loseNextWriteResponse) { this.loseNextWriteResponse = false; throw new Error('Response lost AFTER commit'); }
  }
  async remove(name: string, generation: string) {
    const hook = this.beforeRemove; this.beforeRemove = undefined; await hook?.();
    if (this.unavailable) throw new Error('PRIVATE PROVIDER DETAILS');
    if (this.records.get(name)?.generation !== generation) throw new GenerationConflict();
    this.records.delete(name);
  }
}
const owner = createHash('sha256').update('browser-owner').digest('hex');
const other = createHash('sha256').update('other-browser').digest('hex');
const errorCode = (code: string) => (error: any) => error.code === code;

test('fresh store instances share persisted progress while owners remain isolated', async () => {
  const objects = new MemoryObjects(); const a = new ObjectSessionStore(objects);
  const created = await a.create(owner, 'travel-packing');
  await a.command(owner, {type: 'start', expectedRevision: 0}, 'start', created.id);
  a.close(); const b = new ObjectSessionStore(objects);
  assert.equal((await b.get(owner))?.phase, 'ACTIVE'); assert.equal(await b.get(other), null);
  assert.ok(BigInt([...objects.records.values()][0].generation) > BigInt(Number.MAX_SAFE_INTEGER));
});
test('simultaneous creation commits one checklist and never overwrites the winner', async () => {
  const objects = new MemoryObjects(); const a = new ObjectSessionStore(objects); const b = new ObjectSessionStore(objects);
  const results = await Promise.allSettled([a.create(owner, 'travel-packing'), b.create(owner, 'craft-kit')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const loser = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal(loser.reason.code, 'SESSION_EXISTS'); assert.equal(objects.records.size, 1);
});
test('competing instance mutations have one winner and one stale revision', async () => {
  const objects = new MemoryObjects(); const a = new ObjectSessionStore(objects); const b = new ObjectSessionStore(objects);
  const {id} = await a.create(owner, 'travel-packing');
  const results = await Promise.allSettled([
    a.command(owner, {type: 'start', expectedRevision: 0}, 'one', id),
    b.command(owner, {type: 'start', expectedRevision: 0}, 'two', id),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'STALE_REVISION');
  assert.equal((await b.get(owner))?.revision, 1);
});
test('concurrent identical retries commit once and later retries return current progress', async () => {
  const objects = new MemoryObjects(); const a = new ObjectSessionStore(objects); const b = new ObjectSessionStore(objects);
  const {id} = await a.create(owner, 'travel-packing'); const command = {type: 'start' as const, expectedRevision: 0};
  const results = await Promise.all([a.command(owner, command, 'same', id), b.command(owner, command, 'same', id)]);
  assert.deepEqual(results.map(s => s.revision), [1, 1]);
  await b.command(owner, {type: 'interrupt', expectedRevision: 1}, 'later', id);
  assert.equal((await a.command(owner, command, 'same', id)).phase, 'INTERRUPTED');
  await assert.rejects(a.command(owner, {type: 'reset'}, 'same', id), errorCode('KEY_REUSED'));
});
test('response loss after commit is recoverable with same retry identity', async () => {
  const objects = new MemoryObjects(); const a = new ObjectSessionStore(objects); const {id} = await a.create(owner, 'craft-kit');
  objects.loseNextWriteResponse = true;
  await assert.rejects(a.command(owner, {type: 'start', expectedRevision: 0}, 'key', id), StorageUnavailable);
  assert.equal((await a.command(owner, {type: 'start', expectedRevision: 0}, 'key', id)).revision, 1);
});
test('delete/recreate invalidates old commands, retries and deletion tokens', async () => {
  const objects = new MemoryObjects(); const a = new ObjectSessionStore(objects); const {id} = await a.create(owner, 'craft-kit');
  await a.command(owner, {type: 'start'}, 'old-key', id); await a.clear(owner, id);
  const fresh = await a.create(owner, 'travel-packing');
  await assert.rejects(a.command(owner, {type: 'start'}, 'old-key', id), errorCode('STALE_SESSION'));
  await assert.rejects(a.clear(owner, id), errorCode('STALE_SESSION'));
  assert.equal((await a.get(owner))?.id, fresh.id);
});
test('deletion racing a replacement cannot erase the new checklist', async () => {
  const objects = new MemoryObjects(); const a = new ObjectSessionStore(objects); const b = new ObjectSessionStore(objects);
  const {id} = await a.create(owner, 'craft-kit'); let replacement = '';
  objects.beforeRemove = async () => { objects.records.clear(); replacement = (await b.create(owner, 'travel-packing')).id; };
  await assert.rejects(a.clear(owner, id), errorCode('STALE_SESSION'));
  assert.equal((await b.get(owner))?.id, replacement);
});
test('expiry is enforced on reads; cleanup racing a fresh mutation preserves new state', async () => {
  const objects = new MemoryObjects(); let now = 100; const a = new ObjectSessionStore(objects, () => now);
  const b = new ObjectSessionStore(objects, () => now - 1); const {id} = await a.create(owner, 'craft-kit');
  now += 7 * 86400000;
  objects.beforeRemove = async () => { await b.command(owner, {type: 'start', expectedRevision: 0}, 'fresh', id); };
  assert.equal((await a.get(owner))?.phase, 'ACTIVE');
  now += 7 * 86400000;
  assert.equal(await a.get(owner), null); assert.equal(objects.records.size, 0);
});
test('unreadable or oversized records fail closed without erasing progress', async () => {
  const objects = new MemoryObjects(); const a = new ObjectSessionStore(objects); await a.create(owner, 'craft-kit');
  const [name, record] = [...objects.records.entries()][0];
  for (const body of ['not-json', '{}', 'x'.repeat(MAX_SESSION_BYTES + 1)]) {
    objects.records.set(name, {...record, body});
    await assert.rejects(a.get(owner), StorageUnavailable); assert.equal(objects.records.get(name)?.body, body);
  }
});
test('repeated contention and provider failure terminate with recoverable storage failure', async () => {
  const objects = new MemoryObjects(); let attempts = 0;
  objects.write = async () => { attempts++; throw new GenerationConflict(); };
  const a = new ObjectSessionStore(objects);
  await assert.rejects(a.create(owner, 'craft-kit'), StorageUnavailable); assert.equal(attempts, 5);
  objects.unavailable = true; await assert.rejects(a.get(owner), StorageUnavailable);
});

test('real HTTP/MCP uses async persistence and safely reports storage outage', async () => {
  const objects = new MemoryObjects(); const store = new ObjectSessionStore(objects);
  const server = createApp({store}).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as any).port;
  const first = await fetch(base + '/api/bootstrap'); const cookie = first.headers.get('set-cookie')!.split(';')[0];
  const headers = {cookie, 'Content-Type': 'application/json', origin: base};
  const client = new Client({name: 'async-store-local-test', version: '1'});
  try {
    assert.equal((await first.json()).session, null);
    const create = await fetch(base + '/api/session', {method: 'POST', headers, body: JSON.stringify({templateId: 'travel-packing'})});
    const {session} = await create.json(); assert.ok(session.id);
    const start = await fetch(base + '/api/command', {method: 'POST', headers, body: JSON.stringify({command: {type: 'start', expectedRevision: 0}, requestId: randomUUID(), expectedSessionId: session.id})});
    assert.equal((await start.json()).session.phase, 'ACTIVE');
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), {requestInit: {headers: {cookie}}}));
    const pause = await client.callTool({name: 'interrupt_task', arguments: {expectedRevision: 1, expectedSessionId: session.id, requestId: randomUUID()}});
    assert.equal(JSON.parse((pause.content as any)[0].text).session.phase, 'INTERRUPTED');
    objects.unavailable = true;
    const failed = await fetch(base + '/api/bootstrap', {headers}); assert.equal(failed.status, 503);
    const body = await failed.text(); assert.match(body, /STORAGE_UNAVAILABLE/); assert.ok(!body.includes('PRIVATE'));
    const failedMcp = await client.callTool({name: 'get_session', arguments: {}}); assert.equal(failedMcp.isError, true);
    assert.ok(!JSON.stringify(failedMcp).includes('PRIVATE'));
    objects.unavailable = false;
    assert.equal((await (await fetch(base + '/api/export', {headers})).json()).session.revision, 2);
    const clear = await fetch(base + '/api/session', {method: 'DELETE', headers, body: JSON.stringify({expectedSessionId: session.id})});
    assert.equal(clear.status, 200); assert.equal(objects.records.size, 0);
  } finally { await client.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
