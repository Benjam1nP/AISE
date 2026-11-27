import { TimeSlotPolicy } from './TimeSlotPolicy.js';
import { BookingRepository } from '../persistence/BookingRepository.js';

/**
 * Single rule check shared by booking and rescheduling: slot validation, then overlap rejection.
 *
 * @trace DSN-024 REQ-003 REQ-007 REQ-002 REQ-010
 */
export class BookingRuleChecker {
  constructor(private readonly timeSlotPolicy: TimeSlotPolicy, private readonly bookingRepository: BookingRepository) {}

  /**
   * Validates the slot and rejects overlaps with non-cancelled bookings of the room, ignoring excludeId; throws an Error on violation.
   */
  async check(roomId: string, start: Date, end: Date, now: Date, excludeId: string | null): Promise<void> {
    this.timeSlotPolicy.validate(start, end, now);
    const overlapping = await this.bookingRepository.findOverlapping(roomId, start, end, excludeId);
  }
}
