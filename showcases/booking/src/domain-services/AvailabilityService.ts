import { Room } from '../domain-model/Room.js';
import { RoomRepository } from '../persistence/RoomRepository.js';
import { BookingRepository } from '../persistence/BookingRepository.js';

/**
 * Finds active rooms without overlapping bookings.
 * @trace DSN-006 REQ-001
 */
export class AvailabilityService {
  constructor(private readonly roomRepository: RoomRepository, private readonly bookingRepository: BookingRepository) {}

  /**
   * Returns the active rooms that have no booking overlapping the given range.
   */
  async findFreeRooms(start: Date, end: Date): Promise<Room[]> {
    if (!(start instanceof Date) || isNaN(start.getTime())) {
      throw new Error('Invalid start date');
    }
    if (!(end instanceof Date) || isNaN(end.getTime())) {
      throw new Error('Invalid end date');
    }
    if (start.getTime() >= end.getTime()) {
      throw new Error('Start must be before end');
    }

    const rooms = await this.roomRepository.findAll();
    const activeRooms = rooms.filter((room) => room.active);

    const free: Room[] = [];
    for (const room of activeRooms) {
      const overlapping = await this.bookingRepository.findOverlapping(room.id, start, end, null);
      if (overlapping.length === 0) {
        free.push(room);
      }
    }
    return free;
  }
}
