import { WebSocket } from 'ws';

/**
 * Holds the sockets of connected live server instances and fans out published events to all of them.
 *
 * @trace DSN-034 REQ-003 REQ-007 REQ-011
 */
export class EventFeed {
  constructor(public clients: Set<WebSocket>) {}

  /** Sends the topic and payload to every held open socket and drops sockets that are no longer open; throws if the topic is empty. */
  publish(topic: string, payload: string): void {
    if (typeof topic !== 'string' || topic.length === 0) {
      throw new Error('topic must be a non-empty string');
    }
    const message = JSON.stringify({ topic, payload });
    for (const socket of this.clients) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.clients.delete(socket);
        continue;
      }
      socket.send(message);
    }
  }
}
