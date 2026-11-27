import { RoomController } from '../api-layer/RoomController.js';
import { BookingController } from '../api-layer/BookingController.js';
import { AdminController } from '../api-layer/AdminController.js';
import { IdentityStore } from './IdentityStore.js';

/**
 * Browser UI that calls the HTTP API for users and admins.
 *
 * @trace DSN-015 REQ-006 REQ-008
 */
export class WebClient {
  private readonly identity: IdentityStore = new IdentityStore(null, null);

  constructor(
    private readonly roomController: RoomController,
    private readonly bookingController: BookingController,
    private readonly adminController: AdminController,
    public adminToken: string | null,
  ) {}

  async showAvailability(start: string, end: string): Promise<void> {
    const rooms = await this.roomController.listAvailable(start, end);
    console.log(JSON.stringify(rooms));
  }

  async bookRoom(roomId: string, start: string, end: string): Promise<void> {
    const { name, email } = this.requireIdentity();
    const booking = await this.bookingController.createBooking(roomId, start, end, name, email);
    console.log(JSON.stringify(booking));
  }

  async showMyBookings(): Promise<void> {
    const { email } = this.requireIdentity();
    const bookings = await this.bookingController.listMyBookings(email);
    console.log(JSON.stringify(bookings));
  }

  async showRoomSchedule(roomId: string, date: string): Promise<void> {
    const bookings = await this.bookingController.getRoomSchedule(roomId, date);
    console.log(JSON.stringify(bookings));
  }

  async cancelMyBooking(id: string): Promise<void> {
    const { email } = this.requireIdentity();
    await this.bookingController.cancelBooking(id, email);
  }

  async changeMyBooking(id: string, start: string, end: string): Promise<void> {
    const { email } = this.requireIdentity();
    const booking = await this.bookingController.changeBooking(id, email, start, end);
    console.log(JSON.stringify(booking));
  }

  async adminLogin(password: string): Promise<void> {
    if (!password) {
      throw new Error('Password is required');
    }
    this.adminToken = await this.adminController.login(password);
  }

  async showAllRooms(): Promise<void> {
    const token = this.requireAdminToken();
    const rooms = await this.roomController.listAllRooms(token);
    console.log(JSON.stringify(rooms));
  }

  async manageRoom(action: "create" | "update" | "delete", id: string | null): Promise<void> {
    const token = this.requireAdminToken();
    if (action === 'create') {
      throw new Error('Room details are required to create a room');
    }
    if (id === null || id === '') {
      throw new Error(`Room id is required for ${action}`);
    }
    if (action === 'update') {
      throw new Error('Room details are required to update a room');
    }
    await this.roomController.deleteRoom(token, id);
  }

  async adminCancel(id: string): Promise<void> {
    const token = this.requireAdminToken();
    await this.bookingController.adminCancelBooking(token, id);
  }

  async toggleRoomActive(id: string, active: boolean): Promise<void> {
    const token = this.requireAdminToken();
    const room = await this.roomController.setRoomActive(token, id, active);
    console.log(JSON.stringify(room));
  }

  private requireIdentity(): { name: string; email: string } {
    const stored = this.identity.load();
    if (!stored || !stored.name || !stored.email) {
      throw new Error('Name and email are required before booking');
    }
    return stored;
  }

  private requireAdminToken(): string {
    if (!this.adminToken) {
      throw new Error('Admin login required');
    }
    return this.adminToken;
  }
}
