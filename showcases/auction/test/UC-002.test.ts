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

  it("REQ-001 AC4: A listing submitted without a reserve price is accepted and appears as an open auction.", async () => {
    const app = createApp();
    const sellerId = await registerSeller(app, 'Seller Five');
    const created = await request(app).post('/api/items').send({
      userId: sellerId,
      title: 'No reserve item',
      startingPrice: 50,
      endTime: FUTURE_END,
      currency: 'USD',
    });
    expect(created.status).toBe(201);
    const listed = await request(app).get('/api/items');
    const found = (listed.body as Array<{ id: string; status: string }>).find(
      (item) => item.id === created.body.id,
    );
    expect(found?.status).toBe('open');
  });

  it("REQ-001 AC5: A listing submitted with a reserve price is accepted subject to the rules in REQ-012.", async () => {
    const app = createApp();
    const sellerId = await registerSeller(app, 'Seller Six');
    const accepted = await request(app).post('/api/items').send({
      userId: sellerId,
      title: 'Reserve item',
      startingPrice: 50,
      endTime: FUTURE_END,
      currency: 'EUR',
      reservePrice: 80,
    });
    expect(accepted.status).toBe(201);
    const rejected = await request(app).post('/api/items').send({
      userId: sellerId,
      title: 'Bad reserve item',
      startingPrice: 50,
      endTime: FUTURE_END,
      currency: 'EUR',
      reservePrice: 10,
    });
    expect(rejected.status).toBe(400);
  });

  it("REQ-012 AC1: A listing with a reserve price lower than the starting price is rejected with an error message and no item is created.", async () => {
    const app = createApp();
    const sellerId = await registerSeller(app, 'Seller Seven');
    const res = await request(app).post('/api/items').send({
      userId: sellerId,
      title: 'Low reserve item',
      startingPrice: 50,
      endTime: FUTURE_END,
      currency: 'CHF',
      reservePrice: 49,
    });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    const listed = await request(app).get('/api/items');
    expect(listed.body as unknown[]).toHaveLength(0);
  });

  it("REQ-012 AC2: A listing with a reserve price equal to or higher than the starting price is accepted.", async () => {
    const app = createApp();
    const sellerId = await registerSeller(app, 'Seller Eight');
    const equal = await request(app).post('/api/items').send({
      userId: sellerId,
      title: 'Equal reserve',
      startingPrice: 50,
      endTime: FUTURE_END,
      currency: 'CHF',
      reservePrice: 50,
    });
    const higher = await request(app).post('/api/items').send({
      userId: sellerId,
      title: 'Higher reserve',
      startingPrice: 50,
      endTime: FUTURE_END,
      currency: 'CHF',
      reservePrice: 120,
    });
    expect(equal.status).toBe(201);
    expect(higher.status).toBe(201);
  });

  it("REQ-012 AC3: A listing without a reserve price is accepted and works as before.", async () => {
    const app = createApp();
    const sellerId = await registerSeller(app, 'Seller Nine');
    const res = await request(app).post('/api/items').send({
      userId: sellerId,
      title: 'Plain item',
      startingPrice: 50,
      endTime: FUTURE_END,
      currency: 'CHF',
    });
    expect(res.status).toBe(201);
  });

  it("REQ-012 AC7: No item view, item list, API response or live event sent to bidders contains the reserve amount.", async () => {
    const app = createApp();
    const sellerId = await registerSeller(app, 'Seller Ten');
    const created = await request(app).post('/api/items').send({
      userId: sellerId,
      title: 'Secret reserve',
      startingPrice: 50,
      endTime: FUTURE_END,
      currency: 'CHF',
      reservePrice: 7777,
    });
    expect(created.status).toBe(201);
    const view = await request(app).get(`/api/items/${created.body.id}`);
    const list = await request(app).get('/api/items');
    for (const text of [JSON.stringify(created.body), JSON.stringify(view.body), JSON.stringify(list.body)]) {
      expect(text).not.toContain('7777');
      expect(text).not.toContain('reservePrice');
    }
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
      reservePrice: 30,
    });
    expect(created.status).toBe(201);
    expect(typeof created.body.id).toBe('string');
    const fetched = await request(app).get(`/api/items/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.item.title).toBe('Desk lamp');
    const unknownSeller = await request(app).post('/api/items').send({
      userId: 'no-such-user',
      title: 'Ghost item',
      startingPrice: 20,
      endTime: FUTURE_END,
      currency: 'EUR',
    });
    expect(unknownSeller.status).toBeGreaterThanOrEqual(400);
  });
});
