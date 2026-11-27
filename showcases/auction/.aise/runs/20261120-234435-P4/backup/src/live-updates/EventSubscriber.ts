import { EventFeed } from '../auction-api/EventFeed.js';

/**
 * Live server side of the internal ws event feed; each live instance connects to the API server and so receives every event.
 * @trace DSN-032 REQ-003 REQ-007 REQ-011
 */
export class EventSubscriber {
  private readonly received: { topic: string; payload: string }[] = [];

  constructor(private readonly eventFeed: EventFeed) {}

  onEvent(topic: string, payload: string): void {
    if (typeof topic !== 'string' || topic.trim() === '') {
      throw new Error('Event topic must be a non-empty string');
    }
    if (typeof payload !== 'string') {
      throw new Error('Event payload must be a string');
    }
    this.received.push({ topic, payload });
  }
}
