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

async function findTask(app: ReturnType<typeof createApp>, id: string): Promise<{ text: string; done: boolean; dueDate: string | null }> {
  const list = await request(app).get('/api/tasks');
  return list.body.find((t: { id: string }) => t.id === id);
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

    const task = await findTask(app, id);
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

    const task = await findTask(createApp(db), id);
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

    const task = await findTask(app, id);
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

  it('REQ-005 AC5: When editing, a due date can be set on a task without one, changed on a task with one, or cleared', async () => {
    const app = createApp();
    const created = await request(app).post('/api/tasks').send({ text: 'Task' });
    const id = created.body.id;

    const set = await request(app).patch(`/api/tasks/${id}`).send({ text: 'Task', dueDate: '2030-01-10' });
    expect(set.status).toBe(200);
    expect(set.body.dueDate).toBe('2030-01-10');

    const changed = await request(app).patch(`/api/tasks/${id}`).send({ text: 'Task', dueDate: '2030-02-20' });
    expect(changed.status).toBe(200);
    expect(changed.body.dueDate).toBe('2030-02-20');

    const cleared = await request(app).patch(`/api/tasks/${id}`).send({ text: 'Task', dueDate: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.dueDate).toBeNull();
  });

  it('REQ-005 AC6: After editing the due date, the task shows the new due date, or none if cleared', async () => {
    const app = createApp();
    const created = await request(app).post('/api/tasks').send({ text: 'Task', dueDate: '2030-01-10' });
    const id = created.body.id;

    await request(app).patch(`/api/tasks/${id}`).send({ text: 'Task', dueDate: '2031-03-04' });
    expect((await findTask(app, id)).dueDate).toBe('2031-03-04');

    await request(app).patch(`/api/tasks/${id}`).send({ text: 'Task', dueDate: null });
    expect((await findTask(app, id)).dueDate).toBeNull();
  });

  it('REQ-009 AC3: A due date can be set, changed and cleared when editing a task', async () => {
    const { controller, service } = buildController();
    const task = await service.add('Task', null);
    const set = await controller.update(task.id, { text: 'Task', dueDate: '2030-01-10' });
    expect(set.dueDate).toBe('2030-01-10');
    const changed = await controller.update(task.id, { text: 'Task', dueDate: '2030-02-20' });
    expect(changed.dueDate).toBe('2030-02-20');
    const cleared = await controller.update(task.id, { text: 'Task', dueDate: null });
    expect(cleared.dueDate).toBeNull();
  });

  it('REQ-009 AC4: An invalid date is rejected and the previously stored due date is kept (or none when adding, no task is created)', async () => {
    const app = createApp();
    const created = await request(app).post('/api/tasks').send({ text: 'Task', dueDate: '2030-01-10' });
    const id = created.body.id;

    const bad = await request(app).patch(`/api/tasks/${id}`).send({ text: 'Task', dueDate: 'not-a-date' });
    expect(bad.status).toBe(400);
    const impossible = await request(app).patch(`/api/tasks/${id}`).send({ text: 'Task', dueDate: '2030-13-45' });
    expect(impossible.status).toBe(400);

    expect((await findTask(app, id)).dueDate).toBe('2030-01-10');
  });

  it('SEQ-004 scenario: Edit task', async () => {
    const { controller, service } = buildController();
    const task = await service.add('Draft', null);
    const updated = await controller.update(task.id, { text: '  Final text  ', dueDate: '2030-05-17' });
    expect(updated.text).toBe('Final text');
    expect(updated.dueDate).toBe('2030-05-17');

    const list = await service.list(undefined);
    const stored = list.find((t) => t.id === task.id);
    expect(stored?.text).toBe('Final text');
    expect(stored?.dueDate).toBe('2030-05-17');
  });
});
