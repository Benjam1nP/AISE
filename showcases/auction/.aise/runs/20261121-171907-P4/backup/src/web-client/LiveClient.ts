import { ItemPage } from './ItemPage.js';

interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

const SOCKET_OPEN = 1;

/**
 * Browser WebSocket client of a live update server; watches an item and passes updates to the item page.
 * @trace DSN-038 REQ-003 REQ-009 REQ-004
 */
export class LiveClient {
  private socket: SocketLike | null = null;
  private readonly watched: Set<string> = new Set<string>();
  private readonly pending: string[] = [];

  constructor(private readonly itemPage: ItemPage) {
  }

  watch(itemId: string): void {
    if (typeof itemId !== 'string' || itemId.trim() === '') {
      throw new Error('Item id is required');
    }
    this.watched.add(itemId);
    this.send({ type: 'watch', itemId });
  }

  unwatch(itemId: string): void {
    if (typeof itemId !== 'string' || itemId.trim() === '') {
      throw new Error('Item id is required');
    }
    if (!this.watched.has(itemId)) {
      throw new Error(`Item ${itemId} not found`);
    }
    this.watched.delete(itemId);
    this.send({ type: 'unwatch', itemId });
  }

  onMessage(message: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      throw new Error('Invalid live update message');
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Invalid live update message');
    }
    const itemId = (parsed as { itemId?: unknown }).itemId;
    if (typeof itemId === 'string' && !this.watched.has(itemId)) {
      return;
    }
    this.itemPage.showUpdate(message);
  }

  private send(payload: { type: string; itemId: string }): void {
    const socket = this.connect();
    const data = JSON.stringify(payload);
    if (socket.readyState === SOCKET_OPEN) {
      socket.send(data);
    } else {
      this.pending.push(data);
    }
  }

  private connect(): SocketLike {
    if (this.socket !== null && this.socket.readyState <= SOCKET_OPEN) {
      return this.socket;
    }
    const ctor = (globalThis as unknown as { WebSocket?: new (url: string) => SocketLike }).WebSocket;
    if (ctor === undefined) {
      throw new Error('WebSocket is not available');
    }
    const location = (globalThis as unknown as { location?: { protocol: string; host: string } }).location;
    const scheme = location !== undefined && location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location !== undefined ? location.host : 'localhost';
    const socket = new ctor(`${scheme}://${host}/live`);
    socket.onopen = (): void => {
      for (const data of this.pending.splice(0)) {
        socket.send(data);
      }
      for (const itemId of this.watched) {
        socket.send(JSON.stringify({ type: 'watch', itemId }));
      }
    };
    socket.onmessage = (event: { data: unknown }): void => {
      this.onMessage(String(event.data));
    };
    socket.onclose = (): void => {
      if (this.socket === socket) {
        this.socket = null;
      }
    };
    this.socket = socket;
    return socket;
  }
}
