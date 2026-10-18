import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Storage, CRC32C} from '@google-cloud/storage';
import {GcsObjects, AUTHORIZED_PROJECT, HOLDDATA_BUCKET} from '../src/server/gcs.js';
import {GenerationConflict} from '../src/server/object-store.js';

test('GCS scope rejects other project/bucket configuration before any request', () => {
  assert.throws(() => new GcsObjects('unauthorized-project', HOLDDATA_BUCKET));
  assert.throws(() => new GcsObjects(AUTHORIZED_PROJECT, 'unrelated-bucket'));
});

test('real Google Storage SDK serializes generation guards against a labelled local HTTP double', async () => {
  const body = JSON.stringify({fixture: 'LOCAL HTTP STORAGE DOUBLE — no live GCP'});
  const crc = new CRC32C(); crc.update(Buffer.from(body));
  const generation = '9007199254740993123';
  const seen: {method: string; url: URL; body: string}[] = [];
  let metadataStatus = 200; let downloadStatus = 200; let writeStatus = 200; let deleteStatus = 204;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost'); const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    seen.push({method: req.method!, url, body: Buffer.concat(chunks).toString()});
    const media = url.searchParams.get('alt') === 'media';
    const status = req.method === 'POST' ? writeStatus : req.method === 'DELETE' ? deleteStatus : media ? downloadStatus : metadataStatus;
    res.statusCode = status;
    if (status >= 400) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({error: {code: status, message: 'Local injected failure'}})); return; }
    if (req.method === 'DELETE') { res.end(); return; }
    if (media) { res.setHeader('x-goog-generation', generation); res.setHeader('x-goog-stored-content-encoding', 'identity'); res.setHeader('x-goog-hash', 'crc32c=' + crc.toString()); res.end(body); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({name: 'sessions/test.json', bucket: HOLDDATA_BUCKET, generation, size: String(Buffer.byteLength(body)), crc32c: crc.toString()}));
  }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const storage = new Storage({projectId: AUTHORIZED_PROJECT, apiEndpoint: 'http://127.0.0.1:' + (server.address() as any).port,
    useAuthWithCustomEndpoint: false, timeout: 2000, retryOptions: {autoRetry: false}});
  const objects = new GcsObjects(AUTHORIZED_PROJECT, HOLDDATA_BUCKET, storage);
  try {
    assert.deepEqual(await objects.read('sessions/test.json'), {body, generation});
    assert.equal(seen.length, 1); // Data and exact generation came from the same HTTP response.
    await objects.write('sessions/test.json', body, '0');
    const upload = seen.find(r => r.method === 'POST')!;
    assert.equal(upload.url.searchParams.get('ifGenerationMatch'), '0'); assert.ok(upload.body.includes(body));
    assert.ok(upload.body.includes('no-store'));
    await objects.write('sessions/test.json', body, generation);
    assert.equal(seen.filter(r => r.method === 'POST').at(-1)?.url.searchParams.get('ifGenerationMatch'), generation);
    await objects.remove('sessions/test.json', generation);
    assert.equal(seen.find(r => r.method === 'DELETE')?.url.searchParams.get('ifGenerationMatch'), generation);
    downloadStatus = 404; assert.equal(await objects.read('sessions/test.json'), null);
    downloadStatus = 412; await assert.rejects(objects.read('sessions/test.json'), GenerationConflict); downloadStatus = 200;
    writeStatus = 412; await assert.rejects(objects.write('sessions/test.json', body, generation), GenerationConflict);
    deleteStatus = 412; await assert.rejects(objects.remove('sessions/test.json', generation), GenerationConflict);
    deleteStatus = 404; await assert.rejects(objects.remove('sessions/test.json', generation), GenerationConflict);
    downloadStatus = 403; await assert.rejects(objects.read('sessions/test.json'), (error: any) => error.code === 403);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
