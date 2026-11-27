import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app/app.js';

const FUTURE_END = '2030-01-01T00:00:00.000Z';

async function registerSeller(app: ReturnType<typeof createApp>, name: string): Promise<string> {
  const res = await request(app).post('/api/users').send({ displayName: name });
  return res.body.id as string;
}

describe("UC-002 List item", () => {
  it("REQ-001 AC1: A seller can submit an item with a starting price, an end time and a currency (CHF, EUR or USD) and it then appears as an open auction.", async () => {
    const app = createApp();
    const sellerId = await registerSeller(app, 'Seller One');
    const created = await request(app).post('/api/items').send({
      userId: sellerId,
      title: 'Vintage clock',
      startingPrice: 50,
      endTime: FUTURE_END,
      currency: 'CHF',
    });
    expect(created.status).toBe(201);
    const listed = await request(app).get('/api/items');
    expect(listed.status).toBe(200);
    const found = (listed.body as Array<{ id: string; status: string }>).find(
      (item) => item.id === created.body.id,
    );
    expect(found).toBeDefined();
    expect(found?.status).toBe('open');
  });

  it("REQ-001 AC2: A listing without a starting price, end time or currency is rejected with an error message.", async () => {
    const app = createApp();
    const sellerId = await registerSeller(app, 'Seller Two');
    const res = await request(app).post('/api/items').send({
      userId: sellerId,
      title: 'Incomplete listing',
    });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it("REQ-001 AC3: A listing with a currency other than CHF, EUR or USD is rejected.", async () => {
    const app = createApp();
    const sellerId = await registerSeller(app, 'Seller Three');
    const res = await request(app).post('/api/items').send({
      userId: sellerId,
      title: 'Yen item',
      startingPrice: 100,
      endTime: FUTURE_END,
      currency: 'JPY',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("SEQ-002 scenario: List item", async () => {
    const app = createApp();
    const sellerId = await registerSeller(app, 'Seller Four');
    const created = await request(app).post('/api/items').send({
      userId: sellerId,
      title: 'Desk lamp',
      startingPrice: 20,
      endTime: FUTURE_END,
      currency: 'EUR',
    });
    expect(created.status).toBe(201);
    expect(typeof created.body.id).toBe('string');
    const fetched = await request(app).get(`/api/items/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.item.title).toBe('Desk lamp');
  });
});
