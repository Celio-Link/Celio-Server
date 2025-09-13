import { describe, it, expect, beforeEach } from 'vitest';
import { Session } from '../src/session';
import { TestSocket } from './helpers/TestSocket';
import { CommandType, LinkStatus, type StatusMessage } from '../src/messages/gameboy';

function status(statusType: LinkStatus): StatusMessage {
  return { type: 'status', statusType };
}

describe('Session', () => {
  let session: Session;
  let a: TestSocket;
  let b: TestSocket;

  beforeEach(() => {
    session = new Session('sid');
    a = new TestSocket('a');
    b = new TestSocket('b');
  });

  it('notifies partnerJoined when the second socket enters', () => {
    const ok1 = session.enter(a as any);
    const ok2 = session.enter(b as any);
    expect(ok1).toBe(true);
    expect(ok2).toBe(true);

    const eventsOfA = a.emitted.map(e => e.event);
    expect(eventsOfA).toContain('partnerJoined');
  });

  it('oppositeSocket returns the other socket when two sockets are present', () => {
    session.enter(a as any);
    session.enter(b as any);

    // @ts-ignore accessing private method through bracket notation for test purposes
    const oa = session.oppositeSocket(a as any);
    // @ts-ignore
    const ob = session.oppositeSocket(b as any);

    expect(oa?.id).toBe('b');
    expect(ob?.id).toBe('a');
  });

  it('HandshakeWaiting selects master first, then slave', () => {
    session.enter(a as any);
    session.enter(b as any);

    session.handleStatusMessage(a as any, status(LinkStatus.HandshakeWaiting));
    session.handleStatusMessage(b as any, status(LinkStatus.HandshakeWaiting));

    // First socket should receive SetModeMaster, second SetModeSlave
    expect(a.emitted.some(e => e.event === 'deviceCommand' && e.args[0] === CommandType.SetModeMaster)).toBe(true);
    expect(b.emitted.some(e => e.event === 'deviceCommand' && e.args[0] === CommandType.SetModeSlave)).toBe(true);
  });

  it('HandshakeReceived from both triggers StartHandshake to both', () => {
    session.enter(a as any);
    session.enter(b as any);

    session.handleStatusMessage(a as any, status(LinkStatus.HandshakeReceived));
    session.handleStatusMessage(b as any, status(LinkStatus.HandshakeReceived));

    const aStart = a.emitted.filter(e => e.event === 'deviceCommand' && e.args[0] === CommandType.StartHandshake).length;
    const bStart = b.emitted.filter(e => e.event === 'deviceCommand' && e.args[0] === CommandType.StartHandshake).length;

    expect(aStart).toBe(1);
    expect(bStart).toBe(1);
  });

  it('LinkConnected on one side sends ConnectLink to partner', () => {
    session.enter(a as any);
    session.enter(b as any);

    session.handleStatusMessage(a as any, status(LinkStatus.LinkConnected));

    const bEvents = b.emitted.filter(e => e.event === 'deviceCommand' && e.args[0] === CommandType.ConnectLink).length;
    const aEvents = a.emitted.filter(e => e.event === 'deviceCommand' && e.args[0] === CommandType.ConnectLink).length;

    expect(bEvents).toBe(1);
    expect(aEvents).toBe(0);
  });
});
