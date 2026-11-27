import { Booking } from '../domain-model/Booking.js';
import { Room } from '../domain-model/Room.js';
import { TimeSlotPolicy } from './TimeSlotPolicy.js';
import { RoomRepository } from '../persistence/RoomRepository.js';
import { BookingRepository } from '../persistence/BookingRepository.js';

const ZURICH_TZ = 'Europe/Zurich';

/**
 * Returns the offset in minutes of Europe/Zurich local time relative to UTC at the given instant.
 */
function zurichOffsetMinutes(at: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ZURICH_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(at)) {
    if (p.type !== 'literal') {
      parts[p.type] = Number(p.value);
    }
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const truncated = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
}

/**
 * Returns the instant at which the Europe/Zurich calendar day (year, month0, day) starts.
 */
function zurichMidnight(year: number, month0: number, day: number): Date {
  const guess = Date.UTC(year, month0, day);
  const off1 = zurichOffsetMinutes(new Date(guess));
  const first = guess - off1 * 60000;
  const off2 = zurichOffsetMinutes(new Date(first));
  return new Date(guess - off2 * 60000);
}

/**
 * Booking rules: creation, listing, time change, cancellation; enforces slot rules, ownership and atomic overlap check. Listings exclude cancelled bookings; a day is a calendar day in Europe/Zurich.
 *
 * @trace DSN-007 REQ-002 REQ-003 REQ-004 REQ-007 REQ-010 REQ-011 REQ-012
 */
export class BookingService {
  constructor(private readonly timeSlotPolicy: TimeSlotPolicy, private readonly roomRepository: RoomRepository, private readonly bookingRepository: BookingRepository) {}

  /**
   * Creates a booking for an active room after validating slot rules and checking for overlaps atomically.
   */
  async create(roomId: string, start: Date, end: Date, name: string, email: string): Promise<Booking> {
    this.requireText(name, 'Name');
    this.requireText(email, 'Email');
    this.timeSlotPolicy.validate(start, end, new Date());
    const room = await this.getRoom(roomId);
    if (!room.active) {
      throw new Error(`Room ${roomId} is deactivated`);
    }
    const overlapping = await this.bookingRepository.findOverlapping(roomId, start, end, null);
    const conflict = overlapping.some((b) => !b.cancelled);
    if (conflict) {
      throw new Error(`Booking overlaps an existing booking in room ${roomId}`);
    }
    const booking = new Booking('', roomId, start, end, name.trim(), this.normalizeEmail(email), false);
    return this.bookingRepository.saveIfFree(booking);
  }

  /**
   * Lists non-cancelled bookings created with the given email.
   */
  async listByEmail(email: string): Promise<Booking[]> {
    const normalized = this.normalizeEmail(email);
    const bookings = await this.bookingRepository.findByEmail(normalized);
    return bookings.filter((b) => !b.cancelled);
  }

  /**
   * Lists non-cancelled bookings of a room for a Europe/Zurich calendar day given as YYYY-MM-DD.
   */
  async listByRoomAndDay(roomId: string, date: string): Promise<Booking[]> {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) {
      throw new Error(`Invalid date ${date}, expected YYYY-MM-DD`);
    }
    const year = Number(match[1]);
    const month0 = Number(match[2]) - 1;
    const day = Number(match[3]);
    const dayStart = zurichMidnight(year, month0, day);
    const dayEnd = zurichMidnight(year, month0, day + 1);
    const bookings = await this.bookingRepository.findByRoomAndDay(roomId, dayStart, dayEnd);
    return bookings.filter((b) => !b.cancelled);
  }

  /**
   * Changes start and end of an own, not yet started booking, applying slot and overlap rules.
   */
  async changeTime(id: string, email: string, start: Date, end: Date): Promise<Booking> {
    const booking = await this.getBooking(id);
    this.assertOwner(booking, email);
    const now = new Date();
    this.assertActive(booking, now);
    this.timeSlotPolicy.validate(start, end, now);
    const overlapping = await this.bookingRepository.findOverlapping(booking.roomId, start, end, id);
    const conflict = overlapping.some((b) => !b.cancelled && b.id !== id);
    if (conflict) {
      throw new Error(`Booking overlaps an existing booking in room ${booking.roomId}`);
    }
    booking.startTime = start;
    booking.endTime = end;
    return this.bookingRepository.update(booking);
  }

  /**
   * Cancels an own booking that has not yet started.
   */
  async cancelByUser(id: string, email: string): Promise<void> {
    const booking = await this.getBooking(id);
    this.assertOwner(booking, email);
    this.assertActive(booking, new Date());
    booking.cancelled = true;
    await this.bookingRepository.update(booking);
  }

  /**
   * Cancels any booking that has not yet ended, including one in progress.
   */
  async cancelByAdmin(id: string): Promise<void> {
    const booking = await this.getBooking(id);
    const now = new Date();
    if (booking.endTime.getTime() <= now.getTime()) {
      throw new Error(`Booking ${id} has already ended and cannot be cancelled`);
    }
    booking.cancelled = true;
    await this.bookingRepository.update(booking);
  }

  private async getRoom(roomId: string): Promise<Room> {
    const room = await this.roomRepository.findById(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }
    return room;
  }

  private async getBooking(id: string): Promise<Booking> {
    const booking = await this.bookingRepository.findById(id);
    if (!booking || booking.cancelled) {
      throw new Error(`Booking ${id} not found`);
    }
    return booking;
  }

  private assertOwner(booking: Booking, email: string): void {
    if (this.normalizeEmail(email) !== this.normalizeEmail(booking.creatorEmail)) {
      throw new Error(`Booking ${booking.id} does not belong to this email`);
    }
  }

  private assertActive(booking: Booking, now: Date): void {
    if (booking.startTime.getTime() <= now.getTime()) {
      throw new Error(`Booking ${booking.id} has already started and cannot be changed`);
    }
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private requireText(value: string, field: string): void {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${field} is required`);
    }
  }
}
