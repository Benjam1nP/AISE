import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { BookingController } from '../src/api-layer/BookingController.js';
import { AdminGuard } from '../src/api-layer/AdminGuard.js';
import { AdminAuthService } from '../src/domain-services/AdminAuthService.js';
import { BookingService } from '../src/domain-services/BookingService.js';
import { Booking } from '../src/domain-model/Booking.js';
import { BookingRepository } from '../src/persistence/BookingRepository.js';

const ROOM_ID = 'room-1';
const OTHER_USER = 'guest@example.com';

function makeStack() {
  const db = new DatabaseSync(':memory:');
  const bookingRepository = new BookingRepository(db);
  const roomRepository = {
    findById: async () => ({ id: ROOM_ID, active: true }),
  } as any;
  const timeSlotPolicy = { validate: () => undefined } as any;
  const bookingService = new BookingService(timeSlotPolicy, roomRepository, bookingRepository);
  return { bookingRepository, bookingService };
}

// The repository assigns the stored id, so tests use the id of the returned booking.
async function seed(repo: BookingRepository, start: Date, end: Date): Promise<Booking> {
  return repo.saveIfFree(new Booking('seed', ROOM_ID, start, end, 'Guest', OTHER_USER, false));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('UC-007 Admin cancels any booking', () => {
  it('REQ-011 AC1: An admin can cancel a not-yet-started booking created by any user', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T08:00:00Z'));
    const { bookingRepository, bookingService } = makeStack();
    const b = await seed(bookingRepository, new Date('2030-01-01T10:00:00Z'), new Date('2030-01-01T11:00:00Z'));

    await bookingService.cancelByAdmin(b.id);

    expect((await bookingRepository.findById(b.id))?.cancelled).toBe(true);
  });

  it('REQ-011 AC2: An admin can cancel a booking that is currently in progress', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T10:30:00Z'));
    const { bookingRepository, bookingService } = makeStack();
    const b = await seed(bookingRepository, new Date('2030-01-01T10:00:00Z'), new Date('2030-01-01T11:00:00Z'));

    await bookingService.cancelByAdmin(b.id);

    expect((await bookingRepository.findById(b.id))?.cancelled).toBe(true);
  });

  it('REQ-011 AC3: After cancellation the time slot is shown as free', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T08:00:00Z'));
    const start = new Date('2030-01-01T10:00:00Z');
    const end = new Date('2030-01-01T11:00:00Z');
    const { bookingRepository, bookingService } = makeStack();
    const b = await seed(bookingRepository, start, end);

    await bookingService.cancelByAdmin(b.id);

    const overlapping = await bookingRepository.findOverlapping(ROOM_ID, start, end, null);
    expect(overlapping.filter((o) => !o.cancelled)).toEqual([]);
  });

  it('REQ-011 AC4: Cancelling a booking that has already ended is rejected and the booking remains unchanged', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));
    const { bookingRepository, bookingService } = makeStack();
    const start = new Date('2030-01-01T10:00:00Z');
    const end = new Date('2030-01-01T11:00:00Z');
    const b = await seed(bookingRepository, start, end);

    await expect(bookingService.cancelByAdmin(b.id)).rejects.toThrow(Error);

    const still = await bookingRepository.findById(b.id);
    expect(still).not.toBeNull();
    expect(still?.cancelled).toBe(false);
    expect(still?.startTime.getTime()).toBe(start.getTime());
    expect(still?.endTime.getTime()).toBe(end.getTime());
  });

  it('SEQ-007 scenario: Admin cancels any booking', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T08:00:00Z'));
    const { bookingRepository, bookingService } = makeStack();
    const b = await seed(bookingRepository, new Date('2030-01-01T10:00:00Z'), new Date('2030-01-01T11:00:00Z'));
    const adminAuthService = {
      isValidToken: (token: string) => token === 'admin-token',
      verifyPassword: () => null,
    } as unknown as AdminAuthService;
    const adminGuard = new AdminGuard(adminAuthService);
    const controller = new BookingController(bookingService, adminGuard);

    await controller.adminCancelBooking('admin-token', b.id);

    expect((await bookingRepository.findById(b.id))?.cancelled).toBe(true);
  });
});
