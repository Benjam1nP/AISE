import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app/app.js';
import { Booking } from '../src/domain-model/Booking.js';
import { BookingRepository } from '../src/persistence/BookingRepository.js';

const FUTURE_START = new Date('2099-01-01T10:00:00.000Z');
const FUTURE_END = new Date('2099-01-01T11:00:00.000Z');
const PAST_START = new Date('2000-01-01T10:00:00.000Z');
const PAST_END = new Date('2000-01-01T11:00:00.000Z');
const OWNER = 'owner@example.com';

// The repository assigns the stored id, so tests use the id of the returned booking.
async function seedBooking(
  db: DatabaseSync,
  start: Date,
  end: Date,
  email: string,
  roomId = 'room-1',
): Promise<Booking> {
  const repo = new BookingRepository(db);
  return repo.saveIfFree(new Booking('seed', roomId, start, end, 'Owner', email, false));
}

describe('UC-003 Cancel own booking', () => {
  it('REQ-004 AC1: A user can cancel a not-yet-started booking created with their email', async () => {
    const db = new DatabaseSync(':memory:');
    const seeded = await seedBooking(db, FUTURE_START, FUTURE_END, OWNER);
    const app = createApp(db);
    const res = await request(app).delete(`/api/bookings/${seeded.id}`).query({ email: OWNER });
    expect(res.status).toBe(200);
    const stored = await new BookingRepository(db).findById(seeded.id);
    expect(stored?.cancelled).toBe(true);
  });

  it('REQ-004 AC2: After cancellation the time slot is shown as free', async () => {
    const db = new DatabaseSync(':memory:');
    const seeded = await seedBooking(db, FUTURE_START, FUTURE_END, OWNER);
    const app = createApp(db);
    const res = await request(app).delete(`/api/bookings/${seeded.id}`).query({ email: OWNER });
    expect(res.status).toBe(200);
    const overlapping = await new BookingRepository(db).findOverlapping('room-1', FUTURE_START, FUTURE_END, null);
    expect(overlapping.filter((b) => !b.cancelled)).toHaveLength(0);
  });

  it('REQ-004 AC3: A user cannot cancel a booking created with a different email', async () => {
    const db = new DatabaseSync(':memory:');
    const seeded = await seedBooking(db, FUTURE_START, FUTURE_END, OWNER);
    const app = createApp(db);
    const res = await request(app).delete(`/api/bookings/${seeded.id}`).query({ email: 'other@example.com' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const stored = await new BookingRepository(db).findById(seeded.id);
    expect(stored?.cancelled).toBe(false);
  });

  it('REQ-004 AC4: Cancelling a booking that has already started or ended is rejected for a user', async () => {
    const db = new DatabaseSync(':memory:');
    const seeded = await seedBooking(db, PAST_START, PAST_END, OWNER);
    const app = createApp(db);
    const res = await request(app).delete(`/api/bookings/${seeded.id}`).query({ email: OWNER });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const stored = await new BookingRepository(db).findById(seeded.id);
    expect(stored?.cancelled).toBe(false);
  });

  it('SEQ-003 scenario: Cancel own booking', async () => {
    const db = new DatabaseSync(':memory:');
    const seeded = await seedBooking(db, FUTURE_START, FUTURE_END, OWNER);
    const app = createApp(db);
    const res = await request(app).delete(`/api/bookings/${seeded.id}`).query({ email: OWNER });
    expect(res.status).toBe(200);
    const stored = await new BookingRepository(db).findById(seeded.id);
    expect(stored).not.toBeNull();
    expect(stored?.cancelled).toBe(true);
  });
});
