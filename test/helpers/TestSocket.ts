import type { Socket } from "socket.io";

// A minimal Socket.io Socket test double sufficient for unit tests
export class TestSocket {
  public id: string;
  private listeners: Map<string, Set<Function>> = new Map();
  public emitted: { event: string; args: any[] }[] = [];
  public rooms: Set<string> = new Set();

  constructor(id: string) {
    this.id = id;
  }

  on(event: string, handler: Function) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return this;
  }

  off(event: string, handler: Function) {
    const set = this.listeners.get(event);
    if (set) set.delete(handler);
    return this;
  }

  emit(event: string, ...args: any[]) {
    // record emit for assertion
    this.emitted.push({ event, args });
    // also invoke any local listeners to simulate loopback behavior in tests when needed
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) fn(...args);
    }
    return true;
  }

  // Helper to trigger an incoming event from outside (e.g., server → client message)
  trigger(event: string, ...args: any[]) {
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) fn(...args);
    }
  }

  join(room: string) {
    this.rooms.add(room);
    return Promise.resolve();
  }
}

export type ISocket = Pick<TestSocket, "id" | "on" | "off" | "emit" | "join"> & Partial<Socket>;
