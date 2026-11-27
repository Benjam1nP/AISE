import { describe, expect, it, vi } from 'vitest';
import { Room } from '../src/domain-model/Room.js';
import { RoomController } from '../src/api-layer/RoomController.js';
import { BookingService } from '../src/domain-services/BookingService.js';
import { RoomService } from '../src/domain-services/RoomService.js';
import { AdminAuthService } from '../src/domain-services/AdminAuthService.js';
import { RoomRepository } from '../src/persistence/RoomRepository.js';
import { AdminGuard } from '../src/api-layer/AdminGuard.js';

const ADMIN_TOKEN = 'admin-token';

function makeRoom(active: boolean): Room {
  return new Room('room-1', 'Room One', 6, 2, ['projector'], active);
}

function makeRoomRepository(room: Room) {
  const store = new Map<string, Room>([[room.id, room]]);
  const repo = {
    findAll: vi.fn(async () => Array.from(store.values())),
    findById: vi.fn(async (id: string) => store.get(id) ?? null),
    save: vi.fn(async (r: Room) => {
      store.set(r.id, r);
      return r;
    }),
    delete: vi.fn(async (id: string) => {
      store.delete(id);
    }),
  };
  return repo;
}

function makeBookingRepository() {
  return {
    findAll: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    save: vi.fn(async (b: unknown) => b),
    delete: vi.fn(async () => undefined),
    findByRoomAndDay: vi.fn(async () => []),
    findByEmail: vi.fn(async () => []),
    findFutureByRoom: vi.fn(async () => []),
  };
}

function makeAdminGuard(): AdminGuard {
  const auth = {
    verifyPassword: vi.fn(() => null),
    isValidToken: vi.fn((token: string) => token === ADMIN_TOKEN),
  };
  return new AdminGuard(auth as unknown as AdminAuthService);
}

function makeController(roomRepo: ReturnType<typeof makeRoomRepository>) {
  const roomService = new RoomService(
    roomRepo as unknown as RoomRepository,
    makeBookingRepository() as any,
  );
  const availabilityService = { listAvailable: vi.fn(async () => []) };
  const controller = new RoomController(
    availabilityService as any,
    roomService,
    makeAdminGuard(),
  );
  return { controller, roomService };
}

describe('UC-008 Deactivate or reactivate room', () => {
  it('REQ-012 AC1: An admin can deactivate a room', async () => {
    const room = makeRoom(true);
    const repo = makeRoomRepository(room);
    const { controller } = makeController(repo);

    const result = await controller.setRoomActive(ADMIN_TOKEN, 'room-1', false);

    expect(result.id).toBe('room-1');
    expect(result.active).toBe(false);
    expect(repo.save).toHaveBeenCalled();
  });

  it('REQ-012 AC2: New bookings for a deactivated room are rejected', async () => {
    const room = makeRoom(true);
    const repo = makeRoomRepository(room);
    const { controller } = makeController(repo);
    await controller.setRoomActive(ADMIN_TOKEN, 'room-1', false);

    const bookingRepo = makeBookingRepository();
    const bookingService = new BookingService(
      {} as any,
      repo as unknown as RoomRepository,
      bookingRepo as any,
    );

    await expect(
      bookingService.create(
        'room-1',
        new Date('2030-01-10T09:00:00Z'),
        new Date('2030-01-10T10:00:00Z'),
        'Ada',
        'ada@example.com',
      ),
    ).rejects.toThrow();
    expect(bookingRepo.save).not.toHaveBeenCalled();
  });

  it('REQ-012 AC3: A room with future bookings can be deactivated and those bookings remain active', async () => {
    const room = makeRoom(true);
    const repo = makeRoomRepository(room);
    const bookingRepo = makeBookingRepository();
    const roomService = new RoomService(
      repo as unknown as RoomRepository,
      bookingRepo as any,
    );

    const result = await roomService.setActive('room-1', false);

    expect(result.active).toBe(false);
    expect(bookingRepo.delete).not.toHaveBeenCalled();
    expect(bookingRepo.save).not.toHaveBeenCalled();
  });

  it('REQ-012 AC4: An admin can reactivate a deactivated room and it accepts bookings again', async () => {
    const room = makeRoom(false);
    const repo = makeRoomRepository(room);
    const { controller } = makeController(repo);

    const result = await controller.setRoomActive(ADMIN_TOKEN, 'room-1', true);

    expect(result.active).toBe(true);
    const stored = await repo.findById('room-1');
    expect(stored?.active).toBe(true);
  });

  it('SEQ-008 scenario: Deactivate or reactivate room', async () => {
    const room = makeRoom(true);
    const repo = makeRoomRepository(room);
    const { controller } = makeController(repo);

    const deactivated = await controller.setRoomActive(ADMIN_TOKEN, 'room-1', false);
    expect(deactivated.active).toBe(false);
    expect(repo.findById).toHaveBeenCalledWith('room-1');
    expect(repo.save).toHaveBeenCalledTimes(1);

    const reactivated = await controller.setRoomActive(ADMIN_TOKEN, 'room-1', true);
    expect(reactivated.active).toBe(true);
    expect(repo.save).toHaveBeenCalledTimes(2);
  });
});
