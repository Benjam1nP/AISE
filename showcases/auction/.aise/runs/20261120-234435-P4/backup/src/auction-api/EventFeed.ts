import { EventSubscriber } from '../live-updates/EventSubscriber.js';

/**
 * Internal ws endpoint on the API server; live update server instances connect to it and every published event is sent to all connected instances.
 *
 * @trace DSN-034 REQ-003 REQ-007 REQ-011
 */
export class EventFeed {
  constructor(private readonly eventSubscriber: EventSubscriber) {}

  /**
   * Publishes an event on a topic to every connected live update instance.
   * Invalid input is rejected before anything is forwarded.
   */
  publish(topic: string, payload: string): void {
    if (typeof topic !== 'string' || topic.trim().length === 0) {
      throw new Error('Event topic must be a non-empty string');
    }
    if (typeof payload !== 'string') {
      throw new Error('Event payload must be a string');
    }
    this.eventSubscriber.onEvent(topic, payload);
  }
}
