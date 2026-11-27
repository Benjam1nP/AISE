import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app/app.js';
import { Booking } from '../src/domain-model/Booking.js';
import { BookingRepository } from '../src/persistence/BookingRepository.js';
import { RoomRepository } from '../src/persistence/RoomRepository.js';
import { RoomService } from '../src/domain-services/RoomService.js';

const EMAIL = 'alice@example.com';
const OTHER_EMAIL = 'mallory@example.com';

// A weekday inside the 60 day window: the first Monday at least 8 days ahead, plus dayOffset (0-4).
function iso(dayOffset: number, hour: number, minute = 0): string {
  const d = new Date(Date.now() + 8 * 86400000);
  d.setUTCHours(0, 0, 0, 0);
  while (d.getUTCDay() !== 1) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

// The repository assigns the stored id, so use the id of the room returned by the service.
async function makeRoom(db: DatabaseSync): Promise<string> {
  const service = new RoomService(new RoomRepository(db), new BookingRepository(db));
  const room = await service.addRoom({ name: 'Room A', capacity: 6, floor: 1, equipment: [], active: true });
  return room.id;
}

async function createOwnBooking(
  app: ReturnType<typeof createApp>,
  roomId: string,
  start: string,
  end: string,
  email = EMAIL,
) {
  return request(app).post('/api/bookings').send({ roomId, start, end, name: 'Alice', email });
}

describe('UC-004 Change own booking time', () => {
  it('REQ-010 AC1: A user can change the time of their own not-yet-started booking to a free valid slot in the same room', async () => {
    const db = new DatabaseSync(':memory:');
    const app = createApp(db);
    const roomId = await makeRoom(db);
    const created = await createOwnBooking(app, roomId, iso(0, 10), iso(0, 11));
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const res = await request(app)
      .put(`/api/bookings/${id}`)
      .send({ email: EMAIL, start: iso(0, 13), end: iso(0, 14) });

    expect(res.status).toBe(200);
    expect(new Date(res.body.startTime).toISOString()).toBe(iso(0, 13));
    expect(new Date(res.body.endTime).toISOString()).toBe(iso(0, 14));
    expect(res.body.roomId).toBe(roomId);
  });

  it('REQ-010 AC2: A change that violates the overlap rule or time slot rules is rejected and the original booking stays unchanged', async () => {
    const db = new DatabaseSync(':memory:');
    const app = createApp(db);
    const roomId = await makeRoom(db);
    const first = await createOwnBooking(app, roomId, iso(1, 10), iso(1, 11));
    const second = await createOwnBooking(app, roomId, iso(1, 12), iso(1, 13));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const id = second.body.id as string;

    const res = await request(app)
      .put(`/api/bookings/${id}`)
      .send({ email: EMAIL, start: iso(1, 10, 30), end: iso(1, 11, 30) });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');

    const stored = await new BookingRepository(db).findById(id);
    expect(stored).not.toBeNull();
    expect(stored?.startTime.toISOString()).toBe(iso(1, 12));
    expect(stored?.endTime.toISOString()).toBe(iso(1, 13));
  });

  it('REQ-010 AC3: A user cannot change a booking created with a different email', async () => {
    const db = new DatabaseSync(':memory:');
    const app = createApp(db);
    const roomId = await makeRoom(db);
    const created = await createOwnBooking(app, roomId, iso(2, 10), iso(2, 11), EMAIL);
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const res = await request(app)
      .put(`/api/bookings/${id}`)
      .send({ email: OTHER_EMAIL, start: iso(2, 13), end: iso(2, 14) });
    expect([400, 404]).toContain(res.status);

    const stored = await new BookingRepository(db).findById(id);
    expect(stored?.startTime.toISOString()).toBe(iso(2, 10));
  });

  it('REQ-010 AC4: Changing a booking that has already started or ended is rejected', async () => {
    const db = new DatabaseSync(':memory:');
    const app = createApp(db);
    const roomId = await makeRoom(db);
    const past = await new BookingRepository(db).saveIfFree(
      new Booking(
        'b-past',
        roomId,
        new Date('2020-01-06T10:00:00.000Z'),
        new Date('2020-01-06T11:00:00.000Z'),
        'Alice',
        EMAIL,
        false,
      ),
    );

    const res = await request(app)
      .put(`/api/bookings/${past.id}`)
      .send({ email: EMAIL, start: iso(3, 13), end: iso(3, 14) });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('REQ-010 AC5: A change moving the start into the past is rejected', async () => {
    const db = new DatabaseSync(':memory:');
    const app = createApp(db);
    const roomId = await makeRoom(db);
    const created = await createOwnBooking(app, roomId, iso(3, 10), iso(3, 11));
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const res = await request(app)
      .put(`/api/bookings/${id}`)
      .send({ email: EMAIL, start: '2020-05-06T10:00:00.000Z', end: '2020-05-06T11:00:00.000Z' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('SEQ-004 scenario: Change own booking time', async () => {
    const db = new DatabaseSync(':memory:');
    const app = createApp(db);
    const roomId = await makeRoom(db);
    const created = await createOwnBooking(app, roomId, iso(4, 9), iso(4, 10));
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const changed = await request(app)
      .put(`/api/bookings/${id}`)
      .send({ email: EMAIL, start: iso(4, 15), end: iso(4, 16) });
    expect(changed.status).toBe(200);

    const listed = await request(app).get('/api/bookings').query({ email: EMAIL });
    expect(listed.status).toBe(200);
    const mine = (listed.body as Array<{ id: string; startTime: string }>).find((b) => b.id === id);
    expect(mine).toBeDefined();
    expect(new Date(mine!.startTime).toISOString()).toBe(iso(4, 15));
  });
});
