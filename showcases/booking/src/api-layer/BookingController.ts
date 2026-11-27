import { Booking } from '../domain-model/Booking.js';
import { BookingService } from '../domain-services/BookingService.js';
import { AdminGuard } from './AdminGuard.js';

/**
 * HTTP routes for creating, listing, changing and cancelling bookings.
 *
 * @trace DSN-004 REQ-002 REQ-004 REQ-010 REQ-011 REQ-009
 */
export class BookingController {
  constructor(private readonly bookingService: BookingService, private readonly adminGuard: AdminGuard) {}

  async createBooking(roomId: string, start: string, end: string, name: string, email: string): Promise<Booking> {
    const startDate = this.parseDate(start, 'start');
    const endDate = this.parseDate(end, 'end');
    if (!roomId || !name || !email) {
      throw new Error('roomId, name and email are required');
    }
    return this.bookingService.create(roomId, startDate, endDate, name, email);
  }

  async listMyBookings(email: string): Promise<Booking[]> {
    if (!email) {
      throw new Error('email is required');
    }
    return this.bookingService.listByEmail(email);
  }

  async getRoomSchedule(roomId: string, date: string): Promise<Booking[]> {
    if (!roomId || !date) {
      throw new Error('roomId and date are required');
    }
    return this.bookingService.listByRoomAndDay(roomId, date);
  }

  async changeBooking(id: string, email: string, start: string, end: string): Promise<Booking> {
    const startDate = this.parseDate(start, 'start');
    const endDate = this.parseDate(end, 'end');
    if (!email) {
      throw new Error('email is required');
    }
    return this.bookingService.changeTime(id, email, startDate, endDate);
  }

  async cancelBooking(id: string, email: string): Promise<void> {
    if (!email) {
      throw new Error('email is required');
    }
    await this.bookingService.cancelByUser(id, email);
  }

  async adminCancelBooking(token: string, id: string): Promise<void> {
    this.adminGuard.requireAdmin(token);
    await this.bookingService.cancelByAdmin(id);
  }

  private parseDate(value: string, label: string): Date {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) {
      throw new Error(`Invalid ${label} date: ${value}`);
    }
    return date;
  }
}
