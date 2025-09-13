import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../src/sessionManager';
import { TestSocket } from './helpers/TestSocket';

function isOk<T, E>(res: any): res is { isOk: true; value: T } {
  return !!res && typeof res === 'object' && 'isOk' in res && res.isOk === true;
}

function isErr<T, E>(res: any): res is { isErr: true; error: E } {
  return !!res && typeof res === 'object' && 'isErr' in res && res.isErr === true;
}

describe('SessionManager', () => {
  let mgr: SessionManager;
  let s1: TestSocket;
  let s2: TestSocket;

  beforeEach(() => {
    mgr = new SessionManager();
    s1 = new TestSocket('s1');
    s2 = new TestSocket('s2');
  });

  it('createSession attaches socket to a new session and joins room', () => {
    const created = mgr.createSession(s1 as any);
    expect(isOk<{ id: string; full: boolean }, any>(created)).toBe(true);
    if (!isOk<{ id: string; full: boolean }, any>(created)) return;

    expect(created.value.full).toBe(false);
    expect(created.value.id).toBeTypeOf('string');
    // socket should have joined its own session room
    expect(s1.rooms.has(created.value.id)).toBe(true);
  });

  it('enterSession with invalid id returns NotFound error', () => {
    const res = mgr.enterSession(s1 as any, 'does-not-exist');
    expect(isErr<any, string>(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error).toBe('Not Found');
    }
  });

  it('enterSession allows second socket and reports full=true', () => {
    const created = mgr.createSession(s1 as any);
    if (!isOk<{ id: string; full: boolean }, any>(created)) throw new Error('expected ok');

    const entered = mgr.enterSession(s2 as any, created.value.id);
    expect(isOk<{ id: string; full: boolean }, any>(entered)).toBe(true);
    if (isOk(entered)) {
      expect(entered.value.id).toBe(created.value.id);
      expect(entered.value.full).toBe(true);
    }
  });

  it('leaveSession removes empty session; cannot re-enter by id afterwards', () => {
    const created = mgr.createSession(s1 as any);
    if (!isOk<{ id: string; full: boolean }, any>(created)) throw new Error('expected ok');
    const id = created.value.id;

    const entered = mgr.enterSession(s2 as any, id);
    if (!isOk(entered)) throw new Error('expected ok');

    mgr.leaveSession(s1 as any);
    mgr.leaveSession(s2 as any);

    const tryAgain = mgr.enterSession(new TestSocket('s3') as any, id);
    expect(isErr<any, string>(tryAgain)).toBe(true);
    if (isErr(tryAgain)) {
      expect(tryAgain.error).toBe('Not Found');
    }
  });

  it('createSession returns AlreadyExists when the same socket already has a session', () => {
    const first = mgr.createSession(s1 as any);
    expect(isOk(first)).toBe(true);
    const second = mgr.createSession(s1 as any);
    expect(isErr<any, string>(second)).toBe(true);
    if (isErr(second)) {
      expect(second.error).toBe('AlreadyExists');
    }
  });
});
