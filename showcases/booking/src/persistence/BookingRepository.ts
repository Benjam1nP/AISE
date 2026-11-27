import { DatabaseSync } from 'node:sqlite';
import { Booking } from '../domain-model/Booking.js';

/**
 * SQLite persistence of bookings; saveIfFree performs the overlap check and insert atomically.
 *
 * @trace DSN-012 REQ-003 REQ-001 REQ-002 REQ-004 REQ-005
 */
export class BookingRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      creator_name TEXT NOT NULL,
      creator_email TEXT NOT NULL,
      cancelled INTEGER NOT NULL DEFAULT 0
    )`);
  }

  async findOverlapping(roomId: string, start: Date, end: Date, excludeId: string | null): Promise<Booking[]> {
    const rows = this.db
      .prepare(
        `SELECT id, room_id, start_time, end_time, creator_name, creator_email, cancelled
         FROM bookings
         WHERE room_id = ? AND cancelled = 0 AND start_time < ? AND end_time > ? AND id != ?`,
      )
      .all(roomId, end.getTime(), start.getTime(), excludeId === null ? -1 : Number(excludeId)) as unknown as {
      id: number;
      room_id: string;
      start_time: number;
      end_time: number;
      creator_name: string;
      creator_email: string;
      cancelled: number;
    }[];
    return rows.map((r) => this.toBooking(r));
  }

  async saveIfFree(booking: Booking): Promise<Booking> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const overlaps = await this.findOverlapping(
        booking.roomId,
        booking.startTime,
        booking.endTime,
        null,
      );
      if (overlaps.length > 0) {
        throw new Error(`Room ${booking.roomId} is already booked for the requested time range`);
      }
      const result = this.db
        .prepare(
          `INSERT INTO bookings (room_id, start_time, end_time, creator_name, creator_email, cancelled)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          booking.roomId,
          booking.startTime.getTime(),
          booking.endTime.getTime(),
          booking.creatorName,
          booking.creatorEmail,
          booking.cancelled ? 1 : 0,
        );
      this.db.exec('COMMIT');
      booking.id = String(Number(result.lastInsertRowid));
      return booking;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async findById(id: string): Promise<Booking | null> {
    const rows = this.db
      .prepare(
        `SELECT id, room_id, start_time, end_time, creator_name, creator_email, cancelled
         FROM bookings WHERE id = ?`,
      )
      .all(Number(id)) as unknown as {
      id: number;
      room_id: string;
      start_time: number;
      end_time: number;
      creator_name: string;
      creator_email: string;
      cancelled: number;
    }[];
    return rows.length === 0 ? null : this.toBooking(rows[0]);
  }

  async findByEmail(email: string): Promise<Booking[]> {
    const rows = this.db
      .prepare(
        `SELECT id, room_id, start_time, end_time, creator_name, creator_email, cancelled
         FROM bookings WHERE creator_email = ? ORDER BY start_time`,
      )
      .all(email) as unknown as {
      id: number;
      room_id: string;
      start_time: number;
      end_time: number;
      creator_name: string;
      creator_email: string;
      cancelled: number;
    }[];
    return rows.map((r) => this.toBooking(r));
  }

  async findByRoomAndDay(roomId: string, dayStart: Date, dayEnd: Date): Promise<Booking[]> {
    const rows = this.db
      .prepare(
        `SELECT id, room_id, start_time, end_time, creator_name, creator_email, cancelled
         FROM bookings
         WHERE room_id = ? AND cancelled = 0 AND start_time < ? AND end_time > ?
         ORDER BY start_time`,
      )
      .all(roomId, dayEnd.getTime(), dayStart.getTime()) as unknown as {
      id: number;
      room_id: string;
      start_time: number;
      end_time: number;
      creator_name: string;
      creator_email: string;
      cancelled: number;
    }[];
    return rows.map((r) => this.toBooking(r));
  }

  async countFutureByRoom(roomId: string): Promise<number> {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS cnt FROM bookings WHERE room_id = ? AND cancelled = 0 AND start_time > ?`)
      .get(roomId, Date.now()) as unknown as { cnt: number };
    return Number(row.cnt);
  }

  async update(booking: Booking): Promise<Booking> {
    const id = Number(booking.id);
    const result = this.db
      .prepare(
        `UPDATE bookings SET room_id = ?, start_time = ?, end_time = ?, creator_name = ?, creator_email = ?, cancelled = ?
         WHERE id = ?`,
      )
      .run(
        booking.roomId,
        booking.startTime.getTime(),
        booking.endTime.getTime(),
        booking.creatorName,
        booking.creatorEmail,
        booking.cancelled ? 1 : 0,
        id,
      );
    if (Number(result.changes) === 0) {
      throw new Error(`Booking ${booking.id} not found`);
    }
    return booking;
  }

  private toBooking(r: {
    id: number;
    room_id: string;
    start_time: number;
    end_time: number;
    creator_name: string;
    creator_email: string;
    cancelled: number;
  }): Booking {
    return new Booking(
      String(r.id),
      r.room_id,
      new Date(Number(r.start_time)),
      new Date(Number(r.end_time)),
      r.creator_name,
      r.creator_email,
      Number(r.cancelled) === 1,
    );
  }
}
