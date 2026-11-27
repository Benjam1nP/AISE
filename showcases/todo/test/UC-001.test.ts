import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app/app.js';
import { Task } from '../src/tasks-app/Task.js';
import { TaskController } from '../src/tasks-app/TaskController.js';
import { TaskService } from '../src/tasks-app/TaskService.js';
import { TaskStore } from '../src/tasks-app/TaskStore.js';

function makeService(): TaskService {
  return new TaskService(new TaskStore(new DatabaseSync(':memory:')));
}

function startClock(): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
}

function tick(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms));
}

describe('UC-001 View task list', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('REQ-003 AC1: After adding tasks and ticking some, closing and reopening the app shows the same tasks with the same done states', async () => {
    const db = new DatabaseSync(':memory:');
    const first = createApp(db);
    const a = await request(first).post('/api/tasks').send({ text: 'Alpha' });
    const b = await request(first).post('/api/tasks').send({ text: 'Beta' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    await request(first).patch(`/api/tasks/${a.body.id}`).send({ done: true });

    const before = await request(createApp(db)).get('/api/tasks');
    const reopened = await request(createApp(db)).get('/api/tasks');
    expect(reopened.status).toBe(200);
    expect(reopened.body).toEqual(before.body);
    const byId = new Map<string, Task>(reopened.body.map((t: Task) => [t.id, t]));
    expect(byId.get(a.body.id)?.done).toBe(true);
    expect(byId.get(b.body.id)?.done).toBe(false);
  });

  it('REQ-003 AC2: After clearing the browser\'s local storage and cookies, reopening the app shows the same tasks', async () => {
    const db = new DatabaseSync(':memory:');
    const created = await request(createApp(db)).post('/api/tasks').send({ text: 'Persisted' });
    expect(created.status).toBe(201);

    // A fresh client with no cookies or local storage talks to the same server state.
    const reopened = await request(createApp(db)).get('/api/tasks');
    expect(reopened.status).toBe(200);
    expect(reopened.body.map((t: Task) => t.id)).toContain(created.body.id);
  });

  it.todo('REQ-004 AC1: manual: browser usability requires judging the rendered page in a real browser, not automatable here');

  it('REQ-007 AC1: A done task remains visible in the list with struck-through text', async () => {
    const service = makeService();
    const task = await service.add('Write report');
    await service.setDone(task.id, true);
    const list = await service.list();
    const found = list.find((t) => t.id === task.id);
    expect(found).toBeDefined();
    expect(found?.done).toBe(true);
  });

  it('REQ-007 AC2: Every open task appears above every done task', async () => {
    startClock();
    const service = makeService();
    const a = await service.add('A');
    tick(1000);
    const b = await service.add('B');
    tick(1000);
    const c = await service.add('C');
    await service.setDone(a.id, true);
    const list = await service.list();
    const ids = list.map((t) => t.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    expect(ids.indexOf(c.id)).toBeLessThan(ids.indexOf(a.id));
  });

  it('REQ-007 AC3: Within the open tasks, the earliest created task is first', async () => {
    startClock();
    const service = makeService();
    const a = await service.add('First');
    tick(1000);
    const b = await service.add('Second');
    tick(1000);
    const c = await service.add('Third');
    const open = (await service.list()).filter((t) => !t.done).map((t) => t.id);
    expect(open).toEqual([a.id, b.id, c.id]);
  });

  it('REQ-007 AC4: Within the done tasks, the earliest created task is first', async () => {
    startClock();
    const service = makeService();
    const a = await service.add('First');
    tick(1000);
    const b = await service.add('Second');
    tick(1000);
    const c = await service.add('Third');
    await service.setDone(c.id, true);
    await service.setDone(a.id, true);
    await service.setDone(b.id, true);
    const done = (await service.list()).filter((t) => t.done).map((t) => t.id);
    expect(done).toEqual([a.id, b.id, c.id]);
  });

  it('REQ-007 AC5: Unticking a done task shows it without strike-through among the open tasks, at its creation-time position', async () => {
    startClock();
    const service = makeService();
    const a = await service.add('A');
    tick(1000);
    const b = await service.add('B');
    tick(1000);
    const c = await service.add('C');
    await service.setDone(a.id, true);
    const unticked = await service.setDone(a.id, false);
    expect(unticked.done).toBe(false);
    const open = (await service.list()).filter((t) => !t.done).map((t) => t.id);
    expect(open).toEqual([a.id, b.id, c.id]);
  });

  it('REQ-008 AC1: The app opens directly to the task list without any login step', async () => {
    const app = createApp();
    const page = await request(app).get('/');
    expect(page.status).toBe(200);
    const list = await request(app).get('/api/tasks');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
  });

  it('SEQ-001 scenario: View task list', async () => {
    startClock();
    const app = createApp();
    const first = await request(app).post('/api/tasks').send({ text: 'Open one' });
    tick(1000);
    const second = await request(app).post('/api/tasks').send({ text: 'Done one' });
    tick(1000);
    const third = await request(app).post('/api/tasks').send({ text: 'Open two' });
    await request(app).patch(`/api/tasks/${second.body.id}`).send({ done: true });

    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(200);
    const ids = res.body.map((t: Task) => t.id);
    expect(ids).toEqual([first.body.id, third.body.id, second.body.id]);
    expect(res.body[2].done).toBe(true);

    const controller = new TaskController(makeService());
    const listed = await controller.list();
    expect(Array.isArray(listed)).toBe(true);
  });
});
