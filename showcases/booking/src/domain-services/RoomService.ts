import { Room } from '../domain-model/Room.js';
import { RoomRepository } from '../persistence/RoomRepository.js';
import { BookingRepository } from '../persistence/BookingRepository.js';

/**
 * Room administration: list all, add, edit, delete, activate/deactivate.
 *
 * @trace DSN-008 REQ-005 REQ-012
 */
export class RoomService {
  constructor(private readonly roomRepository: RoomRepository, private readonly bookingRepository: BookingRepository) {}

  async listAll(): Promise<Room[]> {
    return this.roomRepository.findAll();
  }

  async addRoom(room: Omit<Room, "id">): Promise<Room> {
    this.validateRoomFields(room.name, room.capacity, room.floor, room.equipment);
    const created = new Room(
      '',
      room.name.trim(),
      room.capacity,
      room.floor,
      [...room.equipment],
      room.active
    );
    return this.roomRepository.save(created);
  }

  async editRoom(id: string, changes: Partial<Room>): Promise<Room> {
    const existing = await this.roomRepository.findById(id);
    if (!existing) {
      throw new Error(`Room ${id} not found`);
    }
    const name = changes.name !== undefined ? changes.name : existing.name;
    const capacity = changes.capacity !== undefined ? changes.capacity : existing.capacity;
    const floor = changes.floor !== undefined ? changes.floor : existing.floor;
    const equipment = changes.equipment !== undefined ? changes.equipment : existing.equipment;
    this.validateRoomFields(name, capacity, floor, equipment);
    const updated = new Room(
      existing.id,
      name.trim(),
      capacity,
      floor,
      [...equipment],
      changes.active !== undefined ? changes.active : existing.active
    );
    return this.roomRepository.save(updated);
  }

  async deleteRoom(id: string): Promise<void> {
    const existing = await this.roomRepository.findById(id);
    if (!existing) {
      throw new Error(`Room ${id} not found`);
    }
    const futureCount = await this.bookingRepository.countFutureByRoom(id);
    if (futureCount > 0) {
      throw new Error(`Room ${id} has ${futureCount} future bookings and cannot be deleted`);
    }
    await this.roomRepository.delete(id);
  }

  async setActive(id: string, active: boolean): Promise<Room> {
    const existing = await this.roomRepository.findById(id);
    if (!existing) {
      throw new Error(`Room ${id} not found`);
    }
    const updated = new Room(
      existing.id,
      existing.name,
      existing.capacity,
      existing.floor,
      [...existing.equipment],
      active
    );
    return this.roomRepository.save(updated);
  }

  private validateRoomFields(name: string, capacity: number, floor: number, equipment: string[]): void {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('Room name is required');
    }
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('Room capacity must be a positive integer');
    }
    if (!Number.isInteger(floor)) {
      throw new Error('Room floor must be an integer');
    }
    if (!Array.isArray(equipment) || equipment.some((item) => typeof item !== 'string')) {
      throw new Error('Room equipment must be a list of strings');
    }
  }
}
