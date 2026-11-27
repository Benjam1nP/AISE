import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app/app.js';

describe('UC-001 Add task', () => {
	it('REQ-001 AC1: A task added with a non-empty title appears in the task list with status open.', async () => {
		const app = createApp();
		const added = await request(app).post('/api/tasks').send({ title: 'Buy milk' });
		expect(added.status).toBe(201);

		const list = await request(app).get('/api/tasks');
		expect(list.body).toEqual([expect.objectContaining({ title: 'Buy milk', status: 'Open' })]);
	});

	it('REQ-001 AC2: Adding a task with an empty title is rejected with an error message.', async () => {
		const res = await request(createApp()).post('/api/tasks').send({ title: '  ' });
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('The title is empty');
	});
});
