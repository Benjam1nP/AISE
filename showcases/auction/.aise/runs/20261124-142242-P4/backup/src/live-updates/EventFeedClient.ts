import { WebSocket } from 'ws';
import { LiveGateway } from './LiveGateway.js';

const RECONNECT_DELAY_MS = 1000;

/**
 * Client of the API server's internal ws event feed that hands incoming events to the live gateway.
 * @trace DSN-032 REQ-003 REQ-007 REQ-011
 */
export class EventFeedClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly liveGateway: LiveGateway) {}

  /** Opens the ws to the API server and reopens it after a close; no error is thrown. */
  connect(): void {
    const url = process.env.API_SERVER_URL ?? 'ws://localhost:8080';
    const socket = new WebSocket(`${url}/internal/live-update-server`);
    this.socket = socket;
    socket.on('message', (data) => {
      const text = data.toString();
      try {
        const event = JSON.parse(text) as { topic?: unknown; payload?: unknown };
        if (typeof event.topic !== 'string' || typeof event.payload !== 'string') {
          return;
        }
        this.onEvent(event.topic, event.payload);
      } catch {
        return;
      }
    });
    socket.on('close', () => {
      this.socket = null;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, RECONNECT_DELAY_MS);
    });
    socket.on('error', () => {
      socket.close();
    });
  }

  /** Hands an event to the gateway for the item it names; throws an Error for an unknown topic or a payload without itemId. */
  onEvent(topic: string, payload: string): void {
    if (!topic.startsWith('item:')) {
      throw new Error(`Unknown topic ${topic}`);
    }
    let itemId: unknown;
    try {
      itemId = (JSON.parse(payload) as { itemId?: unknown }).itemId;
    } catch {
      throw new Error('Payload must be JSON with an itemId');
    }
    if (typeof itemId !== 'string' || itemId.length === 0) {
      throw new Error('Payload must be JSON with an itemId');
    }
    this.liveGateway.broadcast(itemId, payload);
  }
}
