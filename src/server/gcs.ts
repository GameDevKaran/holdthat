import {Storage} from '@google-cloud/storage';
import {GenerationConflict, MAX_SESSION_BYTES, type ConditionalObjects, type ObjectSnapshot} from './object-store.js';

export const AUTHORIZED_PROJECT = 'tough-melody-508008-p8';
export const HOLDDATA_BUCKET = AUTHORIZED_PROJECT + '-holdthat-sessions';
function code(error: unknown): number { return Number((error as {code?: unknown})?.code); }

/** Uses attached Cloud Run identity via ADC; no key files or client-visible credentials. */
export class GcsObjects implements ConditionalObjects {
  private bucket;
  constructor(project: string, bucket: string, storage?: Storage) {
    if (project !== AUTHORIZED_PROJECT || bucket !== HOLDDATA_BUCKET) throw new Error('HoldThat GCS scope must match the authorized project and isolated session bucket.');
    this.bucket = (storage ?? new Storage({projectId: project, timeout: 10000, retryOptions: {autoRetry: false}})).bucket(bucket);
  }
  async read(name: string): Promise<ObjectSnapshot | null> {
    // Read generation and data from ONE response. SDK File({generation}) converts
    // strings to Number, losing precision for large generations; never use it here.
    const stream = this.bucket.file(name).createReadStream({validation: 'crc32c', decompress: false});
    let generation = ''; let size = 0; const chunks: Buffer[] = [];
    stream.on('response', (response: {headers: Record<string, string | string[] | undefined>}) => {
      generation = String(response.headers['x-goog-generation'] ?? '');
    });
    try {
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > MAX_SESSION_BYTES) throw new Error('Session object exceeds limit.');
        chunks.push(bytes);
      }
      if (!/^[1-9][0-9]*$/.test(generation)) throw new Error('Missing session generation.');
      return {body: Buffer.concat(chunks).toString('utf8'), generation};
    } catch (error) { if (code(error) === 404) return null; if (code(error) === 412) throw new GenerationConflict(); throw error; }
    finally { stream.destroy(); }
  }
  async write(name: string, body: string, generation: string): Promise<void> {
    try {
      await this.bucket.file(name).save(body, {resumable: false, validation: 'crc32c',
        preconditionOpts: {ifGenerationMatch: generation},
        metadata: {contentType: 'application/json', cacheControl: 'no-store'}});
    } catch (error) { if (code(error) === 412) throw new GenerationConflict(); throw error; }
  }
  async remove(name: string, generation: string): Promise<void> {
    try { await this.bucket.file(name).delete({ifGenerationMatch: generation}); }
    catch (error) { if ([404, 412].includes(code(error))) throw new GenerationConflict(); throw error; }
  }
}
