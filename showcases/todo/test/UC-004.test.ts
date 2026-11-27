import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app/app.js';
import { TaskController } from '../src/tasks-app/TaskController.js';
import { TaskService } from '../src/tasks-app/TaskService.js';
import { TaskStore } from '../src/tasks-app/TaskStore.js';

function buildController(): { controller: TaskController; service: TaskService } {
  const db = new DatabaseSync(':memory:');
  const store = new TaskStore(db);
  const service = new TaskService(store);
  const controller = new TaskController(service);
  return { controller, service };
}

describe('UC-004 Edit task', () => {
  it('REQ-005 AC1: After editing and confirming, the task shows the new text and keeps its done state', async () => {
    const app = createApp();
    const created = await request(app).post('/api/tasks').send({ text: 'Original text' });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const done = await request(app).patch(`/api/tasks/${id}`).send({ done: true });
    expect(done.status).toBe(200);

    const edited = await request(app).patch(`/api/tasks/${id}`).send({ text: 'New text' });
    expect(edited.status).toBe(200);

    const list = await request(app).get('/api/tasks');
    expect(list.status).toBe(200);
    const task = list.body.find((t: { id: string }) => t.id === id);
    expect(task.text).toBe('New text');
    expect(task.done).toBe(true);
  });

  it('REQ-005 AC2: The edited text is kept after reopening the app', async () => {
    const db = new DatabaseSync(':memory:');
    const first = createApp(db);
    const created = await request(first).post('/api/tasks').send({ text: 'Before edit' });
    const id = created.body.id;
    const edited = await request(first).patch(`/api/tasks/${id}`).send({ text: 'Kept after reopen' });
    expect(edited.status).toBe(200);

    const reopened = createApp(db);
    const list = await request(reopened).get('/api/tasks');
    expect(list.status).toBe(200);
    const task = list.body.find((t: { id: string }) => t.id === id);
    expect(task.text).toBe('Kept after reopen');
  });

  it('REQ-005 AC3: An empty, whitespace-only, or over 200 character (after trimming) edit is rejected and the old text is kept', async () => {
    const app = createApp();
    const created = await request(app).post('/api/tasks').send({ text: 'Old text' });
    const id = created.body.id;

    const empty = await request(app).patch(`/api/tasks/${id}`).send({ text: '' });
    expect(empty.status).toBe(400);

    const whitespace = await request(app).patch(`/api/tasks/${id}`).send({ text: '   ' });
    expect(whitespace.status).toBe(400);

    const tooLong = await request(app).patch(`/api/tasks/${id}`).send({ text: 'a'.repeat(201) });
    expect(tooLong.status).toBe(400);

    const list = await request(app).get('/api/tasks');
    const task = list.body.find((t: { id: string }) => t.id === id);
    expect(task.text).toBe('Old text');
  });

  it('REQ-005 AC4: Leading and trailing spaces in the edited text are removed', async () => {
    const app = createApp();
    const created = await request(app).post('/api/tasks').send({ text: 'Some task' });
    const id = created.body.id;

    const edited = await request(app).patch(`/api/tasks/${id}`).send({ text: '   Trimmed text   ' });
    expect(edited.status).toBe(200);
    expect(edited.body.text).toBe('Trimmed text');
  });

  it('SEQ-004 scenario: Edit task', async () => {
    const { controller, service } = buildController();
    const task = await service.add('Draft');
    const updated = await controller.update(task.id, { text: '  Final text  ' });
    expect(updated.text).toBe('Final text');

    const list = await service.list();
    const stored = list.find((t) => t.id === task.id);
    expect(stored?.text).toBe('Final text');
  });
});
