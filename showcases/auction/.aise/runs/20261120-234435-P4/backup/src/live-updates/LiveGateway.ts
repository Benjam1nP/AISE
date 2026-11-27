/**
 * WebSocket gateway for browsers; keeps watchers per item and broadcasts only to them.
 *
 * @trace DSN-033 REQ-003 REQ-009 REQ-011 REQ-004
 */
export class LiveGateway {
  private outbox: Map<string, string[]> = new Map();

  constructor(public watchers: Map<string, Set<string>>) {}

  watch(clientId: string, itemId: string): void {
    if (!clientId || !itemId) {
      throw new Error('clientId and itemId are required');
    }
    let clients = this.watchers.get(itemId);
    if (!clients) {
      clients = new Set<string>();
      this.watchers.set(itemId, clients);
    }
    if (clients.size >= 200 && !clients.has(clientId)) {
      throw new Error(`Item ${itemId} already has 200 watchers`);
    }
    clients.add(clientId);
  }

  unwatch(clientId: string, itemId: string): void {
    const clients = this.watchers.get(itemId);
    if (!clients) {
      return;
    }
    clients.delete(clientId);
    if (clients.size === 0) {
      this.watchers.delete(itemId);
    }
  }

  broadcast(itemId: string, message: string): void {
    if (!itemId) {
      throw new Error('itemId is required');
    }
    const clients = this.watchers.get(itemId);
    if (!clients) {
      return;
    }
    for (const clientId of clients) {
      const queue = this.outbox.get(clientId) ?? [];
      queue.push(`${itemId}:${message}`);
      this.outbox.set(clientId, queue);
    }
  }
}
