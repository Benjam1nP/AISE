import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app/app.js';
import { Booking } from '../src/domain-model/Booking.js';
import { BookingRepository } from '../src/persistence/BookingRepository.js';

describe('UC-010 View room schedule', () => {
  it('SEQ-010 scenario: View room schedule', async () => {
    const db = new DatabaseSync(':memory:');
    const repository = new BookingRepository(db);
    const target = await repository.saveIfFree(
      new Booking(
        'b-target',
        'room-A',
        new Date('2030-06-10T10:00:00Z'),
        new Date('2030-06-10T11:00:00Z'),
        'Ada',
        'ada@example.com',
        false,
      ),
    );
    await repository.saveIfFree(
      new Booking(
        'b-other',
        'room-B',
        new Date('2030-06-10T10:00:00Z'),
        new Date('2030-06-10T11:00:00Z'),
        'Bob',
        'bob@example.com',
        false,
      ),
    );

    const response = await request(createApp(db)).get('/api/rooms/room-A/schedule').query({ date: '2030-06-10' });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.map((b: { id: string }) => b.id)).toEqual([target.id]);
    expect(response.body[0].roomId).toBe('room-A');
  });
});
