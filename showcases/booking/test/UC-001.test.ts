import { describe, expect, it, vi } from 'vitest';
import { Room } from '../src/domain-model/Room.js';
import { RoomController } from '../src/api-layer/RoomController.js';
import { AvailabilityService } from '../src/domain-services/AvailabilityService.js';
import { RoomRepository } from '../src/persistence/RoomRepository.js';
import { BookingRepository } from '../src/persistence/BookingRepository.js';

const START = '2030-01-01T10:00:00.000Z';
const END = '2030-01-01T11:00:00.000Z';

function makeRooms(): Room[] {
  return [
    new Room('r1', 'Alpha', 8, 1, ['projector', 'whiteboard'], true),
    new Room('r2', 'Beta', 4, 2, ['screen'], true),
  ];
}

function makeRoomRepo(rooms: Room[]) {
  const findAll = vi.fn(async () => rooms);
  const repo = { findAll, findById: vi.fn(), save: vi.fn(), delete: vi.fn() };
  return { repo: repo as unknown as RoomRepository, findAll };
}

function makeBookingRepo(busyRoomIds: string[]) {
  const findOverlapping = vi.fn(async (roomId: string) =>
    busyRoomIds.includes(roomId) ? [{ id: 'b1', roomId }] : [],
  );
  const repo = { findOverlapping, saveIfFree: vi.fn(), findById: vi.fn(), findByEmail: vi.fn(), findByRoomAndDay: vi.fn(), countFutureByRoom: vi.fn(), update: vi.fn() };
  return { repo: repo as unknown as BookingRepository, findOverlapping };
}

function makeService(rooms: Room[], busyRoomIds: string[]) {
  const roomRepo = makeRoomRepo(rooms);
  const bookingRepo = makeBookingRepo(busyRoomIds);
  const service = new AvailabilityService(roomRepo.repo, bookingRepo.repo);
  return { service, roomRepo, bookingRepo };
}

describe('UC-001 View room availability', () => {
  it("REQ-001 AC1: Given a date and time range, rooms with no booking overlapping that range are listed as free", async () => {
    const { service } = makeService(makeRooms(), ['r2']);
    const free = await service.findFreeRooms(new Date(START), new Date(END));
    expect(free.map((r) => r.id)).toContain('r1');
  });

  it("REQ-001 AC2: Rooms with an overlapping booking are not shown as free", async () => {
    const { service } = makeService(makeRooms(), ['r2']);
    const free = await service.findFreeRooms(new Date(START), new Date(END));
    expect(free.map((r) => r.id)).not.toContain('r2');
  });

  it("REQ-001 AC3: Each listed room shows name, capacity, floor and equipment", async () => {
    const { service } = makeService(makeRooms(), []);
    const free = await service.findFreeRooms(new Date(START), new Date(END));
    const alpha = free.find((r) => r.id === 'r1');
    expect(alpha).toBeDefined();
    expect(alpha?.name).toBe('Alpha');
    expect(alpha?.capacity).toBe(8);
    expect(alpha?.floor).toBe(1);
    expect(alpha?.equipment).toEqual(['projector', 'whiteboard']);
  });

  it("REQ-001 AC4: Deactivated rooms are not listed as bookable", async () => {
    const rooms = [
      new Room('r1', 'Alpha', 8, 1, [], true),
      new Room('r3', 'Gamma', 6, 3, [], false),
    ];
    const { service } = makeService(rooms, []);
    const free = await service.findFreeRooms(new Date(START), new Date(END));
    expect(free.map((r) => r.id)).not.toContain('r3');
  });

  it.todo("REQ-006 AC1: manual: browser usability requires a person to open the app in a web browser without installing client software");

  it("SEQ-001 scenario: View room availability", async () => {
    const { service, roomRepo, bookingRepo } = makeService(makeRooms(), ['r2']);
    const controller = new RoomController(service, null as any, null as any);
    const result = await controller.listAvailable(START, END);
    expect(roomRepo.findAll).toHaveBeenCalledTimes(1);
    expect(bookingRepo.findOverlapping).toHaveBeenCalled();
    expect(result.map((r) => r.id)).toEqual(['r1']);
  });
});
