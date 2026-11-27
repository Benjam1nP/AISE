import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app/app.js';
import { TaskController } from '../src/tasks-app/TaskController.js';
import { TaskService } from '../src/tasks-app/TaskService.js';
import { TaskStore } from '../src/tasks-app/TaskStore.js';

async function createTask(app: ReturnType<typeof createApp>, text: string): Promise<string> {
  const res = await request(app).post('/api/tasks').send({ text });
  return res.body.id as string;
}

describe('UC-005 Delete task', () => {
  it('REQ-006 AC1: After deleting, the task no longer appears in the list', async () => {
    const app = createApp();
    const id = await createTask(app, 'Buy milk');
    const del = await request(app).delete(`/api/tasks/${id}`);
    expect(del.status).toBe(200);
    const list = await request(app).get('/api/tasks');
    const ids = (list.body as Array<{ id: string }>).map((t) => t.id);
    expect(ids).not.toContain(id);
  });

  it('REQ-006 AC2: The task is still gone after reopening the app', async () => {
    const db = new DatabaseSync(':memory:');
    const first = createApp(db);
    const id = await createTask(first, 'Pay rent');
    await request(first).delete(`/api/tasks/${id}`);
    const reopened = createApp(db);
    const list = await request(reopened).get('/api/tasks');
    const ids = (list.body as Array<{ id: string }>).map((t) => t.id);
    expect(ids).not.toContain(id);
  });

  it('SEQ-005 scenario: Delete task', async () => {
    const db = new DatabaseSync(':memory:');
    createApp(db);
    const store = new TaskStore(db);
    const service = new TaskService(store);
    const controller = new TaskController(service);
    const task = await service.add('Write report');
    await controller.remove(task.id);
    const found = await store.findById(task.id);
    expect(found).toBeNull();
  });
});
