import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app/app.js';
import { User } from '../src/auction-api/User.js';
import { UserController } from '../src/auction-api/UserController.js';
import { UserService } from '../src/auction-api/UserService.js';
import { UserStore } from '../src/auction-api/UserStore.js';

function makeStore(): UserStore {
  return new UserStore(new DatabaseSync(':memory:'));
}

function makeService(): UserService {
  return new UserService(makeStore());
}

describe('UC-001 Register display name', () => {
  it('REQ-008 AC1: A user can enter a display name of 2 to 20 characters and use the system without a password.', async () => {
    const res = await request(createApp())
      .post('/api/users')
      .send({ displayName: 'Ann' });
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.displayName).toBe('Ann');
  });

  it('REQ-008 AC2: A display name shorter than 2 or longer than 20 characters is rejected.', async () => {
    const service = makeService();
    await expect(service.register('A')).rejects.toThrow();
    await expect(service.register('X'.repeat(21))).rejects.toThrow();
  });

  it('REQ-008 AC3: A display name already taken is rejected and the user must pick another.', async () => {
    const service = makeService();
    await service.register('Cara');
    await expect(service.register('Cara')).rejects.toThrow();
    const other = await service.register('Dana');
    expect(other.displayName).toBe('Dana');
  });

  it('REQ-008 AC4: The server assigns and stores one user id per display name and the browser keeps the user id it received, so the user is recognised on later visits.', async () => {
    const store = makeStore();
    const service = new UserService(store);
    const user = await service.register('Eve');
    expect(typeof user.id).toBe('string');
    expect(user.id.length).toBeGreaterThan(0);
    const stored = await store.findById(user.id);
    expect(stored?.displayName).toBe('Eve');
    const byName = await store.findByName('Eve');
    expect(byName?.id).toBe(user.id);
  });

  it.todo('REQ-008 AC5: manual: listing items and placing bids spans the item and bid features, which are not part of this use case test file');

  it('REQ-008 AC6: The system has no admin role.', async () => {
    const user: User = await makeService().register('Finn');
    expect(user).not.toHaveProperty('role');
    expect(user).not.toHaveProperty('isAdmin');
    expect(user).not.toHaveProperty('admin');
  });

  it("REQ-008 AC7: Leading and trailing spaces are removed from a display name before the length and uniqueness checks, so 'Bob ' is the same name as 'Bob'.", async () => {
    const service = makeService();
    const first = await service.register('Bob ');
    expect(first.displayName).toBe('Bob');
    await expect(service.register('Bob')).rejects.toThrow();
  });

  it('SEQ-001 scenario: Register display name', async () => {
    const store = makeStore();
    const controller = new UserController(new UserService(store));
    const user = await controller.register('Alice');
    expect(user.id.length).toBeGreaterThan(0);
    const found = await store.findByName('Alice');
    expect(found?.id).toBe(user.id);
  });
});
