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
    const task = await service.add('Buy milk');
    const all = await service.list();
    expect(all.some((t) => t.id === task.id && t.text === 'Buy milk')).toBe(true);
  });

  it('REQ-001 AC2: The new task is shown as not done', async () => {
    const service = makeService();
    const task = await service.add('Buy milk');
    expect(task.done).toBe(false);
  });

  it('REQ-001 AC3: An empty description is not added', async () => {
    const service = makeService();
    await expect(service.add('')).rejects.toThrow();
    expect(await service.list()).toHaveLength(0);
  });

  it('REQ-001 AC4: A description consisting only of spaces is not added', async () => {
    const service = makeService();
    await expect(service.add('     ')).rejects.toThrow();
    expect(await service.list()).toHaveLength(0);
  });

  it('REQ-001 AC5: Leading and trailing spaces are removed from the stored text', async () => {
    const service = makeService();
    const task = await service.add('   Buy milk   ');
    expect(task.text).toBe('Buy milk');
  });

  it('REQ-001 AC6: A description of 200 characters after trimming is accepted', async () => {
    const service = makeService();
    const text = 'a'.repeat(200);
    const task = await service.add('   ' + text + '   ');
    expect(task.text).toBe(text);
  });

  it('REQ-001 AC7: A description of 201 characters after trimming is rejected', async () => {
    const service = makeService();
    const text = 'a'.repeat(201);
    await expect(service.add('   ' + text + '   ')).rejects.toThrow();
    expect(await service.list()).toHaveLength(0);
  });

  it('SEQ-002 scenario: Add task', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/api/tasks')
      .send({ text: 'Buy milk' });
    expect(response.status).toBe(201);
    expect(response.body.text).toBe('Buy milk');
    expect(response.body.done).toBe(false);
    expect(typeof response.body.id).toBe('string');

    const listed = await request(createApp()).get('/api/tasks');
    expect(listed.status).toBe(200);
  });
});
