import { describe, expect, it } from 'vitest';
import { Room } from '../src/domain-model/Room.js';
import { RoomController } from '../src/api-layer/RoomController.js';
import { RoomService } from '../src/domain-services/RoomService.js';
import { RoomRepository } from '../src/persistence/RoomRepository.js';
import { BookingRepository } from '../src/persistence/BookingRepository.js';
import { AdminGuard } from '../src/api-layer/AdminGuard.js';

const ADMIN_TOKEN = 'admin-token';
const USER_TOKEN = 'user-token';

function makeGuard(): AdminGuard {
  return {
    requireAdmin(token: string): void {
      if (token !== ADMIN_TOKEN) {
        throw new Error('Unauthorized');
      }
    },
  } as unknown as AdminGuard;
}

function makeRoomRepo(): { rooms: Map<string, Room>; repo: RoomRepository } {
  const rooms = new Map<string, Room>();
  const repo = {
    findAll: async (): Promise<Room[]> => [...rooms.values()],
    findById: async (id: string): Promise<Room | null> => rooms.get(id) ?? null,
    save: async (room: Room): Promise<Room> => {
      rooms.set(room.id, room);
      return room;
    },
    delete: async (id: string): Promise<void> => {
      rooms.delete(id);
    },
  } as unknown as RoomRepository;
  return { rooms, repo };
}

function makeBookingRepo(futureCount: number): BookingRepository {
  return {
    countFutureByRoom: async (_roomId: string): Promise<number> => futureCount,
  } as unknown as BookingRepository;
}

function build(futureCount = 0): {
  controller: RoomController;
  rooms: Map<string, Room>;
} {
  const { rooms, repo } = makeRoomRepo();
  const service = new RoomService(repo, makeBookingRepo(futureCount));
  const controller = new RoomController(
    {} as never,
    service,
    makeGuard(),
  );
  return { controller, rooms };
}

function seedRoom(rooms: Map<string, Room>, id = 'room-1'): Room {
  const room = new Room(id, 'Alpha', 10, 2, ['projector'], true);
  rooms.set(id, room);
  return room;
}

describe('UC-006 Manage rooms', () => {
  it('REQ-005 AC1: An admin can add a room with name, capacity, floor and equipment list, and it becomes available for booking', async () => {
    const { controller } = build();
    const created = await controller.createRoom(ADMIN_TOKEN, {
      name: 'Beta',
      capacity: 6,
      floor: 3,
      equipment: ['whiteboard', 'screen'],
      active: true,
    } as Omit<Room, 'id'>);
    expect(created.name).toBe('Beta');
    expect(created.capacity).toBe(6);
    expect(created.floor).toBe(3);
    expect(created.equipment).toEqual(['whiteboard', 'screen']);
    const all = await controller.listAllRooms(ADMIN_TOKEN);
    expect(all.some((r) => r.id === created.id && r.active === true)).toBe(true);
  });

  it('REQ-005 AC2: An admin can edit a room\'s name, capacity, floor and equipment', async () => {
    const { controller, rooms } = build();
    const room = seedRoom(rooms);
    const updated = await controller.updateRoom(ADMIN_TOKEN, room.id, {
      name: 'Gamma',
      capacity: 12,
      floor: 4,
      equipment: ['projector', 'phone'],
    });
    expect(updated.name).toBe('Gamma');
    expect(updated.capacity).toBe(12);
    expect(updated.floor).toBe(4);
    expect(updated.equipment).toEqual(['projector', 'phone']);
  });

  it('REQ-005 AC3: An admin can delete a room that has no future bookings', async () => {
    const { controller, rooms } = build(0);
    const room = seedRoom(rooms);
    await controller.deleteRoom(ADMIN_TOKEN, room.id);
    expect(rooms.has(room.id)).toBe(false);
  });

  it('REQ-005 AC4: Deleting a room with one or more future bookings is rejected with an error message', async () => {
    const { controller, rooms } = build(2);
    const room = seedRoom(rooms);
    await expect(controller.deleteRoom(ADMIN_TOKEN, room.id)).rejects.toThrow(
      /.+/,
    );
    expect(rooms.has(room.id)).toBe(true);
  });

  it('REQ-005 AC5: Non-admin users cannot perform these actions', async () => {
    const { controller, rooms } = build(0);
    const room = seedRoom(rooms);
    await expect(
      controller.createRoom(USER_TOKEN, {
        name: 'Delta',
        capacity: 4,
        floor: 1,
        equipment: [],
        active: true,
      } as Omit<Room, 'id'>),
    ).rejects.toThrow();
    await expect(
      controller.updateRoom(USER_TOKEN, room.id, { name: 'Hacked' }),
    ).rejects.toThrow();
    await expect(controller.deleteRoom(USER_TOKEN, room.id)).rejects.toThrow();
    expect(rooms.has(room.id)).toBe(true);
    expect(rooms.get(room.id)?.name).toBe('Alpha');
  });

  it('SEQ-006 scenario: Manage rooms', async () => {
    // deleteRoom: RoomController -> AdminGuard -> RoomService -> BookingRepository -> RoomRepository
    const { controller, rooms } = build(0);
    const room = seedRoom(rooms);
    await expect(controller.deleteRoom(USER_TOKEN, room.id)).rejects.toThrow();
    expect(rooms.has(room.id)).toBe(true);
    await controller.deleteRoom(ADMIN_TOKEN, room.id);
    expect(rooms.has(room.id)).toBe(false);
  });
});
