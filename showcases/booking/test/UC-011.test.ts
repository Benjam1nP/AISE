import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Room } from '../src/domain-model/Room.js';
import { RoomController } from '../src/api-layer/RoomController.js';
import { RoomService } from '../src/domain-services/RoomService.js';
import { AdminAuthService } from '../src/domain-services/AdminAuthService.js';
import { RoomRepository } from '../src/persistence/RoomRepository.js';
import { BookingRepository } from '../src/persistence/BookingRepository.js';
import { AdminGuard } from '../src/api-layer/AdminGuard.js';

describe('UC-011 List all rooms', () => {
  it('SEQ-011 scenario: List all rooms', async () => {
    const auth = new AdminAuthService();
    const isValid = vi.spyOn(auth, 'isValidToken').mockReturnValue(true);
    const guard = new AdminGuard(auth);
    const roomRepo = new RoomRepository(new DatabaseSync(':memory:'));
    const bookingRepo = new BookingRepository(new DatabaseSync(':memory:'));
    const rooms = [
      new Room('r1', 'Alpha', 4, 1, [], true),
      new Room('r2', 'Beta', 6, 2, ['projector'], false),
    ];
    const findAll = vi.spyOn(roomRepo, 'findAll').mockResolvedValue(rooms);
    const roomService = new RoomService(roomRepo, bookingRepo);
    const controller = new RoomController({} as never, roomService, guard);

    const result = await controller.listAllRooms('token-x');

    expect(isValid).toHaveBeenCalledWith('token-x');
    expect(findAll).toHaveBeenCalledTimes(1);
    expect(isValid.mock.invocationCallOrder[0]).toBeLessThan(
      findAll.mock.invocationCallOrder[0],
    );
    expect(result.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(result.some((r) => r.active === false)).toBe(true);
  });
});
