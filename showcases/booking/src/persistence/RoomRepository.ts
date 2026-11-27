import { DatabaseSync } from 'node:sqlite';
import { Room } from '../domain-model/Room.js';

/**
 * SQLite persistence of rooms.
 *
 * @trace DSN-011 REQ-001 REQ-005 REQ-012
 */
export class RoomRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      floor INTEGER NOT NULL,
      equipment TEXT NOT NULL,
      active INTEGER NOT NULL
    )`);
  }

  async findAll(): Promise<Room[]> {
    const rows = this.db
      .prepare('SELECT id, name, capacity, floor, equipment, active FROM rooms ORDER BY id')
      .all() as unknown as { id: number; name: string; capacity: number; floor: number; equipment: string; active: number }[];
    return rows.map((r) => this.toRoom(r));
  }

  async findById(id: string): Promise<Room | null> {
    const rows = this.db
      .prepare('SELECT id, name, capacity, floor, equipment, active FROM rooms WHERE id = ?')
      .all(Number(id)) as unknown as { id: number; name: string; capacity: number; floor: number; equipment: string; active: number }[];
    if (rows.length === 0) {
      return null;
    }
    return this.toRoom(rows[0]);
  }

  async save(room: Room): Promise<Room> {
    const equipment = JSON.stringify(room.equipment);
    const active = room.active ? 1 : 0;
    if (room.id === '' || room.id === undefined || room.id === null) {
      const result = this.db
        .prepare('INSERT INTO rooms (name, capacity, floor, equipment, active) VALUES (?, ?, ?, ?, ?)')
        .run(room.name, room.capacity, room.floor, equipment, active);
      room.id = String(Number(result.lastInsertRowid));
      return room;
    }
    const existing = await this.findById(room.id);
    if (existing === null) {
      throw new Error(`Room ${room.id} not found`);
    }
    this.db
      .prepare('UPDATE rooms SET name = ?, capacity = ?, floor = ?, equipment = ?, active = ? WHERE id = ?')
      .run(room.name, room.capacity, room.floor, equipment, active, Number(room.id));
    return room;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.findById(id);
    if (existing === null) {
      throw new Error(`Room ${id} not found`);
    }
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(Number(id));
  }

  private toRoom(r: { id: number; name: string; capacity: number; floor: number; equipment: string; active: number }): Room {
    return new Room(
      String(r.id),
      r.name,
      r.capacity,
      r.floor,
      JSON.parse(r.equipment) as string[],
      r.active === 1,
    );
  }
}
