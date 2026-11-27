import { describe, expect, it } from 'vitest';
import { Booking } from '../src/domain-model/Booking.js';
import { BookingController } from '../src/api-layer/BookingController.js';
import { BookingService } from '../src/domain-services/BookingService.js';
import { BookingRuleChecker } from '../src/domain-services/BookingRuleChecker.js';
import { TimeSlotPolicy } from '../src/domain-services/TimeSlotPolicy.js';

describe('UC-009 View my bookings', () => {
  it('SEQ-009 scenario: View my bookings', async () => {
    const email = 'alice@example.com';
    const own = new Booking(
      'b1',
      'room-1',
      new Date('2030-01-10T09:00:00Z'),
      new Date('2030-01-10T10:00:00Z'),
      'Alice',
      email,
      false,
    );
    const calls: string[] = [];
    const repository = {
      findByEmail: async (address: string): Promise<Booking[]> => {
        calls.push('findByEmail');
        expect(address).toBe(email);
        return [own];
      },
    };
    const checker = new BookingRuleChecker(new TimeSlotPolicy(), repository as never);
    const service = new BookingService(checker, {} as never, repository as never);
    const originalListByEmail = service.listByEmail.bind(service);
    service.listByEmail = async (address: string): Promise<Booking[]> => {
      calls.push('listByEmail');
      return originalListByEmail(address);
    };
    const controller = new BookingController(service, {} as never);

    const result = await controller.listMyBookings(email);

    expect(calls).toEqual(['listByEmail', 'findByEmail']);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b1');
    expect(result[0].creatorEmail).toBe(email);
  });
});
