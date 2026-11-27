import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app/app.js';

async function createTask(app: ReturnType<typeof createApp>, text: string, dueDate?: string): Promise<string> {
  const res = await request(app).post('/api/tasks').send(dueDate === undefined ? { text } : { text, dueDate });
  return res.body.id as string;
}

describe("UC-003 Mark task done or not done", () => {
  it("REQ-002 AC1: Ticking a task changes it to the done state", async () => {
    const app = createApp();
    const id = await createTask(app, 'Buy milk');
    const res = await request(app).patch(`/api/tasks/${id}`).send({ done: true });
    expect(res.status).toBe(200);
    expect(res.body.done).toBe(true);
  });

  it("REQ-002 AC2: Unticking a done task changes it back to the not-done state", async () => {
    const app = createApp();
    const id = await createTask(app, 'Buy milk');
    await request(app).patch(`/api/tasks/${id}`).send({ done: true });
    const res = await request(app).patch(`/api/tasks/${id}`).send({ done: false });
    expect(res.status).toBe(200);
    expect(res.body.done).toBe(false);
  });

  it.todo("REQ-002 AC3: manual: the visual difference between ticked and empty checkbox and struck-through and plain text needs a rendered browser review");

  it("REQ-010 AC7: Unticking a done task whose due date is past marks it overdue", async () => {
    const app = createApp();
    const id = await createTask(app, 'Late task', '2024-06-01');
    await request(app).patch(`/api/tasks/${id}`).send({ done: true });
    const whileDone = await request(app).get('/api/tasks').query({ today: '2024-06-15' });
    expect(whileDone.body.find((t: { id: string }) => t.id === id).overdue).toBe(false);
    await request(app).patch(`/api/tasks/${id}`).send({ done: false });
    const after = await request(app).get('/api/tasks').query({ today: '2024-06-15' });
    expect(after.body.find((t: { id: string }) => t.id === id).overdue).toBe(true);
  });

  it("SEQ-003 scenario: Mark task done or not done", async () => {
    const app = createApp();
    const id = await createTask(app, 'Write report');
    const marked = await request(app).patch(`/api/tasks/${id}`).send({ done: true });
    expect(marked.status).toBe(200);
    expect(marked.body.id).toBe(id);
    expect(marked.body.done).toBe(true);
    const list = await request(app).get('/api/tasks');
    const found = list.body.find((t: { id: string }) => t.id === id);
    expect(found.done).toBe(true);
    const unmarked = await request(app).patch(`/api/tasks/${id}`).send({ done: false });
    expect(unmarked.status).toBe(200);
    expect(unmarked.body.done).toBe(false);
  });
});
