import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app/app.js';
import { TaskService } from '../src/tasks-app/TaskService.js';
import { TaskStore } from '../src/tasks-app/TaskStore.js';

function makeService(): TaskService {
  const db = new DatabaseSync(':memory:');
  return new TaskService(new TaskStore(db));
}

describe('UC-002 Add task', () => {
  it('REQ-001 AC1: Entering text and confirming adds a new task to the list', async () => {
    const service = makeService();
    const task = await service.add('Buy milk', null);
    const all = await service.list(undefined);
    expect(all.some((t) => t.id === task.id && t.text === 'Buy milk')).toBe(true);
  });

  it('REQ-001 AC2: The new task is shown as not done', async () => {
    const service = makeService();
    const task = await service.add('Buy milk', null);
    expect(task.done).toBe(false);
  });

  it('REQ-001 AC3: An empty description is not added', async () => {
    const service = makeService();
    await expect(service.add('', null)).rejects.toThrow();
    expect(await service.list(undefined)).toHaveLength(0);
  });

  it('REQ-001 AC4: A description consisting only of spaces is not added', async () => {
    const service = makeService();
    await expect(service.add('     ', null)).rejects.toThrow();
    expect(await service.list(undefined)).toHaveLength(0);
  });

  it('REQ-001 AC5: Leading and trailing spaces are removed from the stored text', async () => {
    const service = makeService();
    const task = await service.add('   Buy milk   ', null);
    expect(task.text).toBe('Buy milk');
  });

  it('REQ-001 AC6: A description of 200 characters after trimming is accepted', async () => {
    const service = makeService();
    const text = 'a'.repeat(200);
    const task = await service.add('   ' + text + '   ', null);
    expect(task.text).toBe(text);
  });

  it('REQ-001 AC7: A description of 201 characters after trimming is rejected', async () => {
    const service = makeService();
    const text = 'a'.repeat(201);
    await expect(service.add('   ' + text + '   ', null)).rejects.toThrow();
    expect(await service.list(undefined)).toHaveLength(0);
  });

  it('REQ-001 AC8: A task can be added without a due date', async () => {
    const service = makeService();
    const task = await service.add('No date', null);
    expect(task.dueDate).toBeNull();
  });

  it('REQ-001 AC9: A task can be added with a due date, and it is shown with that due date', async () => {
    const service = makeService();
    const task = await service.add('With date', '2030-05-17');
    expect(task.dueDate).toBe('2030-05-17');
    const found = (await service.list(undefined)).find((t) => t.id === task.id);
    expect(found?.dueDate).toBe('2030-05-17');
  });

  it('REQ-009 AC1: A task without a due date is valid and can be saved', async () => {
    const res = await request(createApp()).post('/api/tasks').send({ text: 'Plain' });
    expect(res.status).toBe(201);
    expect(res.body.dueDate).toBeNull();
  });

  it('REQ-009 AC2: A due date entered when adding a task is saved with the task', async () => {
    const db = new DatabaseSync(':memory:');
    const res = await request(createApp(db)).post('/api/tasks').send({ text: 'Dated', dueDate: '2030-05-17' });
    expect(res.status).toBe(201);
    expect(res.body.dueDate).toBe('2030-05-17');
    const list = await request(createApp(db)).get('/api/tasks');
    expect(list.body[0].dueDate).toBe('2030-05-17');
  });

  it('REQ-009 AC4: An invalid date is rejected and the previously stored due date is kept (or none when adding, no task is created)', async () => {
    const db = new DatabaseSync(':memory:');
    const res = await request(createApp(db)).post('/api/tasks').send({ text: 'Bad date', dueDate: '2024-02-30' });
    expect(res.status).toBe(400);
    const list = await request(createApp(db)).get('/api/tasks');
    expect(list.body).toHaveLength(0);
  });

  it('REQ-009 AC5: The due date contains no time component', async () => {
    const service = makeService();
    await expect(service.add('With time', '2030-05-17T10:30:00')).rejects.toThrow();
    const ok = await service.add('Date only', '2030-05-17');
    expect(ok.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('SEQ-002 scenario: Add task', async () => {
    const db = new DatabaseSync(':memory:');
    const app = createApp(db);
    const response = await request(app)
      .post('/api/tasks')
      .send({ text: '  Buy milk  ', dueDate: '2030-05-17' });
    expect(response.status).toBe(201);
    expect(response.body.text).toBe('Buy milk');
    expect(response.body.done).toBe(false);
    expect(response.body.dueDate).toBe('2030-05-17');
    expect(typeof response.body.id).toBe('string');

    const listed = await request(createApp(db)).get('/api/tasks');
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe(response.body.id);
  });
});
