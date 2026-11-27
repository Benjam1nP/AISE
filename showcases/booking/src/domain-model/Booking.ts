import { Room } from './Room.js';

/**
 * Booking of a room for a time range, with creator name and email.
 *
 * @trace DSN-002 REQ-002 REQ-003 REQ-004 REQ-008
 */
export class Booking {
  constructor(public id: string, public roomId: string, public startTime: Date, public endTime: Date, public creatorName: string, public creatorEmail: string, public cancelled: boolean) {
  }

  /** Returns true when this booking belongs to the given room. */
  private belongsTo(room: Room): boolean {
    return this.roomId === room.id;
  }
}
