import express, { Express, NextFunction, Request, Response } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { TaskStore } from '../tasks-app/TaskStore.js';
import { TaskService } from '../tasks-app/TaskService.js';
import { TaskController } from '../tasks-app/TaskController.js';

export function createApp(db: DatabaseSync = new DatabaseSync(':memory:')): Express {
  const taskStore = new TaskStore(db);
  const taskService = new TaskService(taskStore);
  const taskController = new TaskController(taskService);

  const app = express();
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(express.json());
  app.get('/', async (_req, res) => {
    res.type('html').send(await taskController.page());
  });
  app.use(express.static(fileURLToPath(new URL('../../public', import.meta.url))));

  app.get('/api/tasks', async (req, res) => {
    const today = typeof req.query.today === 'string' ? req.query.today : undefined;
    res.json(await taskController.list(today));
  });
  app.post('/api/tasks', async (req, res) => {
    res.status(201).json(await taskController.create(req.body));
  });
  app.patch('/api/tasks/:id', async (req, res) => {
    res.json(await taskController.update(String(req.params.id), req.body ?? {}));
  });
  app.delete('/api/tasks/:id', async (req, res) => {
    const result = await taskController.remove(String(req.params.id));
    res.status(200).json(result ?? { ok: true });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.message.endsWith('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  });
  return app;
}
