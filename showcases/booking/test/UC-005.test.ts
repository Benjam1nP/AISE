import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app/app.js';
import { AdminController } from '../src/api-layer/AdminController.js';
import { AdminAuthService } from '../src/domain-services/AdminAuthService.js';
import { AdminGuard } from '../src/api-layer/AdminGuard.js';

const ENV_NAME = 'ADMIN_PASSWORD';
const CORRECT = 'correct-horse-battery';
const WRONG = 'definitely-not-the-password';

let previous: string | undefined;

beforeEach(() => {
  previous = process.env[ENV_NAME];
  process.env[ENV_NAME] = CORRECT;
});

afterEach(() => {
  if (previous === undefined) {
    delete process.env[ENV_NAME];
  } else {
    process.env[ENV_NAME] = previous;
  }
});

function buildAuth(): AdminAuthService {
  return new AdminAuthService();
}

describe('UC-005 Admin login', () => {
  it('REQ-009 AC1: Entering the correct password enables admin functions', async () => {
    const auth = buildAuth();
    const token = auth.verifyPassword(CORRECT);
    expect(token).not.toBeNull();
    expect(auth.isValidToken(token as string)).toBe(true);
    const guard = new AdminGuard(auth);
    expect(() => guard.requireAdmin(token as string)).not.toThrow();
  });

  it('REQ-009 AC2: Entering a wrong password does not enable admin functions', async () => {
    const auth = buildAuth();
    const token = auth.verifyPassword(WRONG);
    expect(token).toBeNull();
    const guard = new AdminGuard(auth);
    expect(() => guard.requireAdmin('')).toThrow();
  });

  it('REQ-009 AC3: Admin actions called without valid admin authentication are rejected by the server', async () => {
    const app = createApp();
    const list = await request(app)
      .get('/api/admin/rooms')
      .send({ token: 'invalid-token' });
    expect(list.status).toBeGreaterThanOrEqual(400);
    expect(typeof list.body.error).toBe('string');

    const create = await request(app)
      .post('/api/admin/rooms')
      .send({
        token: 'invalid-token',
        room: { name: 'Room X', capacity: 4, active: true },
      });
    expect(create.status).toBeGreaterThanOrEqual(400);
    expect(typeof create.body.error).toBe('string');

    const cancel = await request(app)
      .delete('/api/admin/bookings/some-booking-id')
      .send({ token: 'invalid-token' });
    expect(cancel.status).toBeGreaterThanOrEqual(400);
    expect(typeof cancel.body.error).toBe('string');
  });

  it('REQ-009 AC4: The password is read from an environment variable and is not stored in the source code', async () => {
    const first = 'env-secret-first-value';
    process.env[ENV_NAME] = first;
    const authFirst = buildAuth();
    expect(authFirst.verifyPassword(first)).not.toBeNull();

    const second = 'env-secret-second-value';
    process.env[ENV_NAME] = second;
    const authSecond = buildAuth();
    expect(authSecond.verifyPassword(second)).not.toBeNull();
    expect(authSecond.verifyPassword(first)).toBeNull();
  });

  it('SEQ-005 scenario: Admin login', async () => {
    const auth = buildAuth();
    const controller = new AdminController(auth);
    const token = await controller.login(CORRECT);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(auth.isValidToken(token)).toBe(true);

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/login')
      .send({ password: CORRECT });
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
  });
});
