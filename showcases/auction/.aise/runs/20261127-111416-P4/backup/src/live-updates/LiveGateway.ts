import { WebSocket } from 'ws';

/**
 * WebSocket gateway that pushes each bid update only to the browser sockets watching that item.
 * @trace DSN-033 REQ-003 REQ-009 REQ-011 REQ-004
 */
export class LiveGateway {
  private watchers: Map<string, Set<string>> = new Map();

  /** Keeps the open browser sockets by client id. */
  constructor(public sockets: Map<string, WebSocket>) {}

  /** Adds the client as a watcher of the item; throws if the id is empty or the client has no open socket. */
  watch(clientId: string, itemId: string): void {
    this.checkId(clientId, 'clientId');
    this.checkId(itemId, 'itemId');
    if (!this.sockets.has(clientId)) {
      throw new Error(`Client ${clientId} not found`);
    }
    let set = this.watchers.get(itemId);
    if (!set) {
      set = new Set<string>();
      this.watchers.set(itemId, set);
    }
    set.add(clientId);
  }

  /** Removes the client from the watchers of the item; throws if an id is empty. */
  unwatch(clientId: string, itemId: string): void {
    this.checkId(clientId, 'clientId');
    this.checkId(itemId, 'itemId');
    const set = this.watchers.get(itemId);
    if (!set) {
      return;
    }
    set.delete(clientId);
    if (set.size === 0) {
      this.watchers.delete(itemId);
    }
  }

  /** Sends the message to every open socket watching the item; throws if the item id is empty. */
  broadcast(itemId: string, message: string): void {
    this.checkId(itemId, 'itemId');
    const set = this.watchers.get(itemId);
    if (!set) {
      return;
    }
    for (const clientId of [...set]) {
      const socket = this.sockets.get(clientId);
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        set.delete(clientId);
        continue;
      }
      socket.send(message);
    }
    if (set.size === 0) {
      this.watchers.delete(itemId);
    }
  }

  private checkId(value: string, name: string): void {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${name} must be a non-empty string`);
    }
  }
}
