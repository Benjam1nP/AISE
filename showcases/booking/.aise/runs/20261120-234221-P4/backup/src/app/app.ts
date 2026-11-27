import express, { Express, NextFunction, Request, Response } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { RoomRepository } from '../persistence/RoomRepository.js';
import { BookingRepository } from '../persistence/BookingRepository.js';
import { TimeSlotPolicy } from '../domain-services/TimeSlotPolicy.js';
import { AdminAuthService } from '../domain-services/AdminAuthService.js';
import { AvailabilityService } from '../domain-services/AvailabilityService.js';
import { BookingService } from '../domain-services/BookingService.js';
import { RoomService } from '../domain-services/RoomService.js';
import { AdminGuard } from '../api-layer/AdminGuard.js';
import { RoomController } from '../api-layer/RoomController.js';
import { BookingController } from '../api-layer/BookingController.js';
import { AdminController } from '../api-layer/AdminController.js';

function token(req: Request): string {
  return String(req.header('x-admin-token') ?? '');
}

function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

export function createApp(): Express {
  const db = new DatabaseSync(':memory:');
  const roomRepository = new RoomRepository(db);
  const bookingRepository = new BookingRepository(db);
  const timeSlotPolicy = new TimeSlotPolicy();
  const adminAuthService = new AdminAuthService();
  const availabilityService = new AvailabilityService(roomRepository, bookingRepository);
  const bookingService = new BookingService(timeSlotPolicy, roomRepository, bookingRepository);
  const roomService = new RoomService(roomRepository, bookingRepository);
  const adminGuard = new AdminGuard(adminAuthService);
  const roomController = new RoomController(availabilityService, roomService, adminGuard);
  const bookingController = new BookingController(bookingService, adminGuard);
  const adminController = new AdminController(adminAuthService);

  const app = express();
  app.use(express.json());
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(express.static(fileURLToPath(new URL('../../public', import.meta.url))));

  app.get('/api/rooms/available', async (req, res) => {
    res.json(await roomController.listAvailable(str(req.query.start), str(req.query.end)));
  });
  app.get('/api/admin/rooms', async (req, res) => {
    res.json(await roomController.listAllRooms(token(req)));
  });
  app.post('/api/admin/rooms', async (req, res) => {
    const b = req.body ?? {};
    const room = await roomController.createRoom(token(req), {
      name: b.name,
      capacity: b.capacity,
      floor: b.floor,
      equipment: b.equipment ?? [],
      active: b.active ?? true,
    });
    res.status(201).json(room);
  });
  app.put('/api/admin/rooms/:id', async (req, res) => {
    res.json(await roomController.updateRoom(token(req), String(req.params.id), req.body ?? {}));
  });
  app.delete('/api/admin/rooms/:id', async (req, res) => {
    await roomController.deleteRoom(token(req), String(req.params.id));
    res.json({ ok: true });
  });
  app.put('/api/admin/rooms/:id/active', async (req, res) => {
    res.json(await roomController.setRoomActive(token(req), String(req.params.id), Boolean(req.body?.active)));
  });

  app.post('/api/bookings', async (req, res) => {
    const b = req.body ?? {};
    const booking = await bookingController.createBooking(str(b.roomId), str(b.start), str(b.end), str(b.name), str(b.email));
    res.status(201).json(booking);
  });
  app.get('/api/bookings', async (req, res) => {
    res.json(await bookingController.listMyBookings(str(req.query.email)));
  });
  app.get('/api/rooms/:roomId/schedule', async (req, res) => {
    res.json(await bookingController.getRoomSchedule(String(req.params.roomId), str(req.query.date)));
  });
  app.put('/api/bookings/:id', async (req, res) => {
    const b = req.body ?? {};
    res.json(await bookingController.changeBooking(String(req.params.id), str(b.email), str(b.start), str(b.end)));
  });
  app.delete('/api/bookings/:id', async (req, res) => {
    await bookingController.cancelBooking(String(req.params.id), str(req.query.email));
    res.json({ ok: true });
  });
  app.delete('/api/admin/bookings/:id', async (req, res) => {
    await bookingController.adminCancelBooking(token(req), String(req.params.id));
    res.json({ ok: true });
  });

  app.post('/api/admin/login', async (req, res) => {
    res.json({ token: await adminController.login(str(req.body?.password)) });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.endsWith('not found') ? 404 : 400).json({ error: message });
  });
  return app;
}
