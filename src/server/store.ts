import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { applyCommand, createSession, DomainError, type Command, type Session } from '../domain/index.js';

export class SessionStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec('CREATE TABLE IF NOT EXISTS sessions (owner TEXT PRIMARY KEY, body TEXT NOT NULL, updated INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS operations (owner TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(owner,key));');
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.db.prepare('DELETE FROM operations WHERE owner IN (SELECT owner FROM sessions WHERE updated < ?)').run(cutoff);
    this.db.prepare('DELETE FROM sessions WHERE updated < ?').run(cutoff);
  }
  get(owner: string): Session | null {
    const row = this.db.prepare('SELECT body FROM sessions WHERE owner=?').get(owner) as {body:string}|undefined;
    return row ? JSON.parse(row.body) : null;
  }
  create(owner: string, templateId: string): Session {
    if (this.get(owner)) throw new DomainError('SESSION_EXISTS', 'Finish or clear the current checklist before choosing another.');
    const session = createSession(templateId, randomUUID());
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(owner, JSON.stringify(session), Date.now());
    return session;
  }
  command(owner: string, command: Command, key: string, expectedSessionId: string): Session {
    const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(owner);
      if (!current) throw new DomainError('NO_SESSION', 'Choose a checklist first.');
      if(current.id!==expectedSessionId)throw new DomainError('STALE_SESSION','This checklist was replaced. Reload before changing it.');
      const cached = this.db.prepare('SELECT hash,result FROM operations WHERE owner=? AND key=?').get(owner,key) as {hash:string;result:string}|undefined;
      if (cached) {
        if (cached.hash !== hash) throw new DomainError('KEY_REUSED', 'This request identifier was already used for another action.');
        this.db.exec('COMMIT');
        // A retry confirms the operation happened; return the current state, never overwrite newer progress.
        return this.get(owner)!;
      }
      if (current.events.length > 3000) throw new DomainError('SESSION_LIMIT', 'Export and clear this session before continuing.');
      const next = applyCommand(current,command);
      this.db.prepare('UPDATE sessions SET body=?,updated=? WHERE owner=?').run(JSON.stringify(next),Date.now(),owner);
      // Only the request identity is needed for retries. Avoid storing a full growing
      // event-history snapshot per operation (quadratic disk usage for long sessions).
      this.db.prepare('INSERT INTO operations VALUES (?,?,?,?)').run(owner,key,hash,'');
      this.db.exec('COMMIT');
      return next;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  clear(owner: string): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM operations WHERE owner=?').run(owner);
      this.db.prepare('DELETE FROM sessions WHERE owner=?').run(owner);
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close():void { this.db.close(); }
}
