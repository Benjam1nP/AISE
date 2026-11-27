import express, { type Express } from 'express';
import { Task } from '../model/Task.js';
import { TaskService } from '../service/TaskService.js';

export function createApp(): Express {
	const app = express();
	app.use(express.json());
	const service = new TaskService(1);
	const tasks: Task[] = [];

	app.get('/health', (_req, res) => {
		res.json({ status: 'ok' });
	});
	app.get('/api/tasks', (_req, res) => {
		res.json(tasks);
	});
	app.post('/api/tasks', (req, res) => {
		const task = service.addTask(String(req.body?.title ?? ''));
		tasks.push(task);
		res.status(201).json(task);
	});
	// Express recognises an error handler by its four parameters, so the last one stays.
	app.use(
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		(err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
			res.status(err.message.endsWith('not found') ? 404 : 400).json({ error: err.message });
		}
	);
	return app;
}
