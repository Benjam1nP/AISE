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
    const task = await service.add('Write report', null);
    await service.setDone(task.id, true);
    const list = await service.list(undefined);
    const found = list.find((t) => t.id === task.id);
    expect(found).toBeDefined();
    expect(found?.done).toBe(true);
  });

  it('REQ-007 AC2: Every open task appears above every done task', async () => {
    startClock();
    const service = makeService();
    const a = await service.add('A', null);
    tick(1000);
    const b = await service.add('B', null);
    tick(1000);
    const c = await service.add('C', null);
    await service.setDone(a.id, true);
    const list = await service.list(undefined);
    const ids = list.map((t) => t.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    expect(ids.indexOf(c.id)).toBeLessThan(ids.indexOf(a.id));
  });

  it('REQ-007 AC3: Within the open tasks, the earliest created task is first', async () => {
    startClock();
    const service = makeService();
    const a = await service.add('First', null);
    tick(1000);
    const b = await service.add('Second', null);
    tick(1000);
    const c = await service.add('Third', null);
    const open = (await service.list(undefined)).filter((t) => !t.done).map((t) => t.id);
    expect(open).toEqual([a.id, b.id, c.id]);
  });

  it('REQ-007 AC4: Within the done tasks, the earliest created task is first', async () => {
    startClock();
    const service = makeService();
    const a = await service.add('First', null);
    tick(1000);
    const b = await service.add('Second', null);
    tick(1000);
    const c = await service.add('Third', null);
    await service.setDone(c.id, true);
    await service.setDone(a.id, true);
    await service.setDone(b.id, true);
    const done = (await service.list(undefined)).filter((t) => t.done).map((t) => t.id);
    expect(done).toEqual([a.id, b.id, c.id]);
  });

  it('REQ-007 AC5: Unticking a done task shows it without strike-through among the open tasks, at its creation-time position', async () => {
    startClock();
    const service = makeService();
    const a = await service.add('A', null);
    tick(1000);
    const b = await service.add('B', null);
    tick(1000);
    const c = await service.add('C', null);
    await service.setDone(a.id, true);
    const unticked = await service.setDone(a.id, false);
    expect(unticked.done).toBe(false);
    const open = (await service.list(undefined)).filter((t) => !t.done).map((t) => t.id);
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

  it('REQ-009 AC6: The due date is still present after reopening the app, including after the browser\'s local data is reset', async () => {
    const db = new DatabaseSync(':memory:');
    const created = await request(createApp(db)).post('/api/tasks').send({ text: 'Pay rent', dueDate: '2030-05-17' });
    expect(created.status).toBe(201);
    const reopened = await request(createApp(db)).get('/api/tasks');
    const found = reopened.body.find((t: Task) => t.id === created.body.id);
    expect(found.dueDate).toBe('2030-05-17');
  });

  it('REQ-009 AC7: Existing tasks without a due date still load and behave as before', async () => {
    const db = new DatabaseSync(':memory:');
    const created = await request(createApp(db)).post('/api/tasks').send({ text: 'No date' });
    expect(created.status).toBe(201);
    const list = await request(createApp(db)).get('/api/tasks');
    expect(list.status).toBe(200);
    const found = list.body.find((t: Task) => t.id === created.body.id);
    expect(found.dueDate).toBeNull();
    const patched = await request(createApp(db)).patch(`/api/tasks/${created.body.id}`).send({ done: true });
    expect(patched.status).toBe(200);
    expect(patched.body.done).toBe(true);
  });

  it('REQ-010 AC1: A task with a due date shows that date next to its text', async () => {
    const service = makeService();
    const task = await service.add('Dated', '2030-05-17');
    const found = (await service.list('2030-01-01')).find((t) => t.id === task.id);
    expect(found?.dueDate).toBe('2030-05-17');
  });

  it('REQ-010 AC2: A task without a due date shows no date', async () => {
    const service = makeService();
    const task = await service.add('Undated', null);
    const found = (await service.list('2030-01-01')).find((t) => t.id === task.id);
    expect(found?.dueDate).toBeNull();
  });

  it('REQ-010 AC3: An open task with a due date before today (user\'s local date) is visibly marked overdue', async () => {
    const service = makeService();
    const task = await service.add('Late', '2024-06-14');
    const found = (await service.list('2024-06-15')).find((t) => t.id === task.id);
    expect(found?.overdue).toBe(true);
  });

  it('REQ-010 AC4: An open task with a due date of today or later is not marked overdue', async () => {
    const service = makeService();
    const today = await service.add('Today', '2024-06-15');
    const later = await service.add('Later', '2024-06-16');
    const list = await service.list('2024-06-15');
    expect(list.find((t) => t.id === today.id)?.overdue).toBe(false);
    expect(list.find((t) => t.id === later.id)?.overdue).toBe(false);
  });

  it('REQ-010 AC5: A done task is never marked overdue, even if its due date is past', async () => {
    const service = makeService();
    const task = await service.add('Finished late', '2024-06-01');
    await service.setDone(task.id, true);
    const found = (await service.list('2024-06-15')).find((t) => t.id === task.id);
    expect(found?.overdue).toBe(false);
  });

  it('REQ-010 AC6: A task without a due date is never marked overdue', async () => {
    const service = makeService();
    const task = await service.add('Undated', null);
    const found = (await service.list('2099-12-31')).find((t) => t.id === task.id);
    expect(found?.overdue).toBe(false);
  });

  it('REQ-010 AC8: The list order defined in REQ-007 is unchanged by due dates', async () => {
    startClock();
    const service = makeService();
    const a = await service.add('A late due', '2030-12-31');
    tick(1000);
    const b = await service.add('B early due', '2020-01-01');
    tick(1000);
    const c = await service.add('C no due', null);
    const ids = (await service.list('2024-06-15')).map((t) => t.id);
    expect(ids).toEqual([a.id, b.id, c.id]);
  });

  it('SEQ-001 scenario: View task list', async () => {
    startClock();
    const app = createApp();
    const first = await request(app).post('/api/tasks').send({ text: 'Open one', dueDate: '2024-01-01' });
    tick(1000);
    const second = await request(app).post('/api/tasks').send({ text: 'Done one', dueDate: '2024-01-01' });
    tick(1000);
    const third = await request(app).post('/api/tasks').send({ text: 'Open two' });
    await request(app).patch(`/api/tasks/${second.body.id}`).send({ done: true });

    const res = await request(app).get('/api/tasks').query({ today: '2024-06-15' });
    expect(res.status).toBe(200);
    const ids = res.body.map((t: Task) => t.id);
    expect(ids).toEqual([first.body.id, third.body.id, second.body.id]);
    expect(res.body[0].overdue).toBe(true);
    expect(res.body[1].overdue).toBe(false);
    expect(res.body[2].overdue).toBe(false);
    expect(res.body[2].done).toBe(true);

    const controller = new TaskController(makeService());
    const listed = await controller.list('2024-06-15');
    expect(Array.isArray(listed)).toBe(true);
  });
});
