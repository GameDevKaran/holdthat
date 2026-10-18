import {createHash, randomUUID} from 'node:crypto';
import {applyCommand, createSession, DomainError, type Command, type Session} from '../domain/index.js';
import {StorageUnavailable, type ChecklistStore} from './persistence.js';

export class GenerationConflict extends Error {}
export interface ObjectSnapshot {body: string; generation: string}
/** Conditional object operations, implemented by GCS in production. */
export interface ConditionalObjects {
  read(name: string): Promise<ObjectSnapshot | null>;
  write(name: string, body: string, generation: string): Promise<void>;
  remove(name: string, generation: string): Promise<void>;
}
type RecordBody = {schema: 1; updated: number; session: Session; operations: Record<string, string>};
export const MAX_SESSION_BYTES = 1024 * 1024;
const TTL = 7 * 24 * 60 * 60 * 1000;

/** State and retry identities occupy ONE object and commit atomically via generation CAS. */
export class ObjectSessionStore implements ChecklistStore {
  constructor(private objects: ConditionalObjects, private now: () => number = Date.now) {}
  private name(owner: string): string {
    if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error('Invalid opaque owner hash.');
    return 'sessions/' + owner + '.json';
  }
  private async retry<T>(action: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try { return await action(); }
      catch (error) {
        if (error instanceof DomainError) throw error;
        if (!(error instanceof GenerationConflict)) throw new StorageUnavailable();
      }
    }
    throw new StorageUnavailable();
  }
  private async current(name: string): Promise<{value: RecordBody; generation: string} | null> {
    const snapshot = await this.objects.read(name);
    if (!snapshot) return null;
    if (Buffer.byteLength(snapshot.body) > MAX_SESSION_BYTES) throw new StorageUnavailable();
    const value = JSON.parse(snapshot.body) as RecordBody;
    // Never replace an unreadable record with an empty session.
    if (value.schema !== 1 || !Number.isFinite(value.updated) || !value.session?.id ||
        !Number.isInteger(value.session.revision) || !Array.isArray(value.session.events) ||
        !value.operations || typeof value.operations !== 'object' || Array.isArray(value.operations)) {
      throw new StorageUnavailable();
    }
    if (this.now() - value.updated >= TTL) {
      await this.objects.remove(name, snapshot.generation);
      return null;
    }
    return {value, generation: snapshot.generation};
  }
  private encode(value: RecordBody): string {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > MAX_SESSION_BYTES) throw new DomainError('SESSION_LIMIT', 'Export and clear this session before continuing.');
    return body;
  }
  async get(owner: string): Promise<Session | null> {
    return this.retry(async () => (await this.current(this.name(owner)))?.value.session ?? null);
  }
  async create(owner: string, templateId: string): Promise<Session> {
    const name = this.name(owner);
    return this.retry(async () => {
      if (await this.current(name)) throw new DomainError('SESSION_EXISTS', 'Finish or clear the current checklist before choosing another.');
      const session = createSession(templateId, randomUUID());
      await this.objects.write(name, this.encode({schema: 1, updated: this.now(), session, operations: {}}), '0');
      return session;
    });
  }
  async command(owner: string, command: Command, key: string, expectedSessionId: string): Promise<Session> {
    const name = this.name(owner);
    const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    // Hash retry keys as well: object property names never come from user input.
    const retryKey = createHash('sha256').update(key).digest('hex');
    return this.retry(async () => {
      const record = await this.current(name);
      if (!record) throw new DomainError('NO_SESSION', 'Choose a checklist first.');
      const {value, generation} = record;
      if (value.session.id !== expectedSessionId) throw new DomainError('STALE_SESSION', 'This checklist was replaced. Reload before changing it.');
      const cached = value.operations[retryKey];
      if (cached) {
        if (cached !== hash) throw new DomainError('KEY_REUSED', 'This request identifier was already used for another action.');
        return value.session;
      }
      if (value.session.events.length > 3000) throw new DomainError('SESSION_LIMIT', 'Export and clear this session before continuing.');
      const session = applyCommand(value.session, command);
      await this.objects.write(name, this.encode({...value, updated: this.now(), session,
        operations: {...value.operations, [retryKey]: hash}}), generation);
      return session;
    });
  }
  async clear(owner: string, expectedSessionId: string): Promise<void> {
    const name = this.name(owner);
    return this.retry(async () => {
      const record = await this.current(name);
      if (!record) return; // Safe retry after a completed deletion.
      if (record.value.session.id !== expectedSessionId) throw new DomainError('STALE_SESSION', 'This checklist was replaced. Reload before clearing it.');
      await this.objects.remove(name, record.generation);
    });
  }
  close(): void {}
}
