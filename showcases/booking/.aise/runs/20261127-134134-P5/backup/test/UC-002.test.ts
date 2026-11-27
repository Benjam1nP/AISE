import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Booking } from '../src/domain-model/Booking.js';
import { BookingController } from '../src/api-layer/BookingController.js';
import { BookingService } from '../src/domain-services/BookingService.js';
import { TimeSlotPolicy } from '../src/domain-services/TimeSlotPolicy.js';

// Fixed "now": Monday 2030-01-07 09:00 Europe/Zurich (January, UTC+1).
const NOW = new Date('2030-01-07T08:00:00Z');

function zurich(local: string): Date {
  return new Date(`${local}+01:00`);
}

class FakeRoomRepository {
  private rooms: Record<string, { id: string; active: boolean }> = {
    'room-1': { id: 'room-1', active: true },
    'room-2': { id: 'room-2', active: true },
    'room-off': { id: 'room-off', active: false },
  };

  async findAll(): Promise<any[]> {
    return Object.values(this.rooms);
  }

  async findById(id: string): Promise<any | null> {
    return this.rooms[id] ?? null;
  }

  async save(room: any): Promise<any> {
    this.rooms[room.id] = room;
    return room;
  }

  async delete(id: string): Promise<void> {
    delete this.rooms[id];
  }
}

class FakeBookingRepository {
  items: Booking[] = [];

  private overlaps(b: Booking, roomId: string, start: Date, end: Date, excludeId: string | null): boolean {
    return !b.cancelled && b.roomId === roomId && b.id !== excludeId && b.startTime < end && b.endTime > start;
  }

  async findOverlapping(roomId: string, start: Date, end: Date, excludeId: string | null): Promise<Booking[]> {
    return this.items.filter((b) => this.overlaps(b, roomId, start, end, excludeId));
  }

  async saveIfFree(booking: Booking): Promise<Booking> {
    const clash = this.items.some((b) => this.overlaps(b, booking.roomId, booking.startTime, booking.endTime, null));
    if (clash) {
      throw new Error('Time slot overlaps an existing booking');
    }
    this.items.push(booking);
    return booking;
  }

  async findById(id: string): Promise<Booking | null> {
    return this.items.find((b) => b.id === id) ?? null;
  }

  async findByEmail(email: string): Promise<Booking[]> {
    return this.items.filter((b) => b.creatorEmail === email);
  }

  async findByRoomAndDay(roomId: string, dayStart: Date, dayEnd: Date): Promise<Booking[]> {
    return this.items.filter(
      (b) => b.roomId === roomId && !b.cancelled && b.startTime >= dayStart && b.startTime < dayEnd,
    );
  }

  async countFutureByRoom(roomId: string): Promise<number> {
    return this.items.filter((b) => b.roomId === roomId && !b.cancelled && b.startTime > NOW).length;
  }

  async update(booking: Booking): Promise<Booking> {
    this.items = this.items.map((b) => (b.id === booking.id ? booking : b));
    return booking;
  }
}

function setup() {
  const bookingRepo = new FakeBookingRepository();
  const roomRepo = new FakeRoomRepository();
  const service = new BookingService(new TimeSlotPolicy(), roomRepo as any, bookingRepo as any);
  const controller = new BookingController(service, {} as any);
  return { service, controller, bookingRepo, roomRepo };
}

describe('UC-002 Book a room', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('REQ-002 AC1: A user can create a booking for a free room with a start and end time', async () => {
    const { service } = setup();
    const booking = await service.create('room-1', zurich('2030-01-08T09:00'), zurich('2030-01-08T10:00'), 'Ann', 'ann@example.com');
    expect(booking.roomId).toBe('room-1');
    expect(booking.startTime.getTime()).toBe(zurich('2030-01-08T09:00').getTime());
    expect(booking.endTime.getTime()).toBe(zurich('2030-01-08T10:00').getTime());
  });

  it('REQ-002 AC2: The new booking appears in the room\'s schedule and in the user\'s bookings', async () => {
    const { service } = setup();
    const booking = await service.create('room-1', zurich('2030-01-08T09:00'), zurich('2030-01-08T10:00'), 'Ann', 'ann@example.com');
    const mine = await service.listByEmail('ann@example.com');
    const schedule = await service.listByRoomAndDay('room-1', '2030-01-08');
    expect(mine.map((b) => b.id)).toContain(booking.id);
    expect(schedule.map((b) => b.id)).toContain(booking.id);
  });

  it('REQ-002 AC3: Booking a deactivated room is rejected', async () => {
    const { service } = setup();
    await expect(
      service.create('room-off', zurich('2030-01-08T09:00'), zurich('2030-01-08T10:00'), 'Ann', 'ann@example.com'),
    ).rejects.toThrow(Error);
  });

  it('REQ-002 AC4: A booking whose start is in the past is rejected with an error message', async () => {
    const { service } = setup();
    await expect(
      service.create('room-1', zurich('2030-01-06T09:00'), zurich('2030-01-06T10:00'), 'Ann', 'ann@example.com'),
    ).rejects.toThrow(/\S/);
  });

  it('REQ-003 AC1: A booking whose time range overlaps an existing booking for the same room is rejected with an error message', async () => {
    const { service } = setup();
    await service.create('room-1', zurich('2030-01-08T09:00'), zurich('2030-01-08T10:00'), 'Ann', 'ann@example.com');
    await expect(
      service.create('room-1', zurich('2030-01-08T09:30'), zurich('2030-01-08T10:30'), 'Bob', 'bob@example.com'),
    ).rejects.toThrow(/\S/);
  });

  it('REQ-003 AC2: Two simultaneous requests for the same room and overlapping time result in only one stored booking', async () => {
    const { service, bookingRepo } = setup();
    const results = await Promise.allSettled([
      service.create('room-1', zurich('2030-01-08T11:00'), zurich('2030-01-08T12:00'), 'Ann', 'ann@example.com'),
      service.create('room-1', zurich('2030-01-08T11:30'), zurich('2030-01-08T12:30'), 'Bob', 'bob@example.com'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(bookingRepo.items).toHaveLength(1);
  });

  it('REQ-003 AC3: Bookings in different rooms at the same time are allowed', async () => {
    const { service } = setup();
    await service.create('room-1', zurich('2030-01-08T09:00'), zurich('2030-01-08T10:00'), 'Ann', 'ann@example.com');
    const second = await service.create('room-2', zurich('2030-01-08T09:00'), zurich('2030-01-08T10:00'), 'Bob', 'bob@example.com');
    expect(second.roomId).toBe('room-2');
  });

  it('REQ-003 AC4: A booking that starts exactly when another ends in the same room is allowed', async () => {
    const { service } = setup();
    await service.create('room-1', zurich('2030-01-08T09:00'), zurich('2030-01-08T10:00'), 'Ann', 'ann@example.com');
    const next = await service.create('room-1', zurich('2030-01-08T10:00'), zurich('2030-01-08T11:00'), 'Bob', 'bob@example.com');
    expect(next.startTime.getTime()).toBe(zurich('2030-01-08T10:00').getTime());
  });

  it('REQ-007 AC1: A booking with a start or end not on a 15-minute step is rejected', () => {
    const policy = new TimeSlotPolicy();
    expect(() => policy.validate(zurich('2030-01-08T09:07'), zurich('2030-01-08T10:00'), NOW)).toThrow();
    expect(() => policy.validate(zurich('2030-01-08T09:00'), zurich('2030-01-08T10:08'), NOW)).toThrow();
  });

  it('REQ-007 AC2: A booking shorter than 15 minutes or longer than 4 hours is rejected', () => {
    const policy = new TimeSlotPolicy();
    expect(() => policy.validate(zurich('2030-01-08T09:00'), zurich('2030-01-08T09:10'), NOW)).toThrow();
    expect(() => policy.validate(zurich('2030-01-08T09:00'), zurich('2030-01-08T13:15'), NOW)).toThrow();
  });

  it('REQ-007 AC3: A booking outside 07:00-20:00 Europe/Zurich or on a Saturday or Sunday is rejected', () => {
    const policy = new TimeSlotPolicy();
    expect(() => policy.validate(zurich('2030-01-08T06:45'), zurich('2030-01-08T07:30'), NOW)).toThrow();
    expect(() => policy.validate(zurich('2030-01-12T09:00'), zurich('2030-01-12T10:00'), NOW)).toThrow();
    expect(() => policy.validate(zurich('2030-01-13T09:00'), zurich('2030-01-13T10:00'), NOW)).toThrow();
  });

  it('REQ-007 AC4: A booking ending exactly at 20:00 is accepted; one ending after 20:00 is rejected', () => {
    const policy = new TimeSlotPolicy();
    expect(() => policy.validate(zurich('2030-01-08T19:00'), zurich('2030-01-08T20:00'), NOW)).not.toThrow();
    expect(() => policy.validate(zurich('2030-01-08T19:00'), zurich('2030-01-08T20:15'), NOW)).toThrow();
  });

  it('REQ-007 AC5: A booking starting more than 60 days ahead is rejected', () => {
    const policy = new TimeSlotPolicy();
    expect(() => policy.validate(zurich('2030-03-12T09:00'), zurich('2030-03-12T10:00'), NOW)).toThrow();
  });

  it('REQ-007 AC6: A valid 15-minute booking and a valid 4-hour booking are accepted', () => {
    const policy = new TimeSlotPolicy();
    expect(() => policy.validate(zurich('2030-01-08T09:00'), zurich('2030-01-08T09:15'), NOW)).not.toThrow();
    expect(() => policy.validate(zurich('2030-01-08T09:00'), zurich('2030-01-08T13:00'), NOW)).not.toThrow();
  });

  it.todo('REQ-008 AC1: manual: the first-visit name and email prompt is browser UI behaviour outside the API');

  it.todo('REQ-008 AC2: manual: remembering name and email in browser storage is browser UI behaviour outside the API');

  it('REQ-008 AC3: Each booking shows the name and email of its creator', async () => {
    const { service } = setup();
    const booking = await service.create('room-1', zurich('2030-01-08T09:00'), zurich('2030-01-08T10:00'), 'Ann', 'ann@example.com');
    expect(booking.creatorName).toBe('Ann');
    expect(booking.creatorEmail).toBe('ann@example.com');
  });

  it('REQ-008 AC4: Booking is not possible until name and email are provided', async () => {
    const { controller } = setup();
    await expect(
      controller.createBooking('room-1', '2030-01-08T09:00:00+01:00', '2030-01-08T10:00:00+01:00', '', ''),
    ).rejects.toThrow(/\S/);
  });

  it('REQ-008 AC5: A user who clears browser data or uses another browser cannot cancel or change earlier bookings themselves; an admin can cancel them', async () => {
    const { service, bookingRepo } = setup();
    const booking = await service.create('room-1', zurich('2030-01-08T09:00'), zurich('2030-01-08T10:00'), 'Ann', 'ann@example.com');
    await expect(service.cancelByUser(booking.id, 'someone-else@example.com')).rejects.toThrow(Error);
    await service.cancelByAdmin(booking.id);
    const stored = await bookingRepo.findById(booking.id);
    expect(stored?.cancelled).toBe(true);
  });

  it('SEQ-002 scenario: Book a room', async () => {
    const { controller } = setup();
    const booking = await controller.createBooking(
      'room-1',
      '2030-01-08T09:00:00+01:00',
      '2030-01-08T10:00:00+01:00',
      'Ann',
      'ann@example.com',
    );
    expect(booking.roomId).toBe('room-1');
    const mine = await controller.listMyBookings('ann@example.com');
    expect(mine.map((b) => b.id)).toContain(booking.id);
  });
});
