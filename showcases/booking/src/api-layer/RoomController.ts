import { Room } from '../domain-model/Room.js';
import { AvailabilityService } from '../domain-services/AvailabilityService.js';
import { RoomService } from '../domain-services/RoomService.js';
import { AdminGuard } from './AdminGuard.js';

/**
 * HTTP routes for rooms, availability and admin room management.
 *
 * @trace DSN-003 REQ-001 REQ-005 REQ-012 REQ-009
 */
export class RoomController {
  constructor(private readonly availabilityService: AvailabilityService, private readonly roomService: RoomService, private readonly adminGuard: AdminGuard) {}

  /**
   * Lists active rooms that are free in the given range.
   */
  async listAvailable(start: string, end: string): Promise<Room[]> {
    const startDate = this.parseDate(start, 'start');
    const endDate = this.parseDate(end, 'end');
    if (endDate.getTime() <= startDate.getTime()) {
      throw new Error('End must be after start');
    }
    const rooms = await this.availabilityService.findFreeRooms(startDate, endDate);
    return rooms.filter((room) => room.active);
  }

  /**
   * Lists all rooms for an admin.
   */
  async listAllRooms(token: string): Promise<Room[]> {
    this.adminGuard.requireAdmin(token);
    return this.roomService.listAll();
  }

  /**
   * Creates a room for an admin.
   */
  async createRoom(token: string, room: Omit<Room, "id">): Promise<Room> {
    this.adminGuard.requireAdmin(token);
    return this.roomService.addRoom(room);
  }

  /**
   * Edits a room for an admin.
   */
  async updateRoom(token: string, id: string, room: Partial<Room>): Promise<Room> {
    this.adminGuard.requireAdmin(token);
    return this.roomService.editRoom(id, room);
  }

  /**
   * Deletes a room for an admin.
   */
  async deleteRoom(token: string, id: string): Promise<void> {
    this.adminGuard.requireAdmin(token);
    await this.roomService.deleteRoom(id);
  }

  /**
   * Activates or deactivates a room for an admin.
   */
  async setRoomActive(token: string, id: string, active: boolean): Promise<Room> {
    this.adminGuard.requireAdmin(token);
    return this.roomService.setActive(id, active);
  }

  private parseDate(value: string, label: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid ${label} date`);
    }
    return date;
  }
}
