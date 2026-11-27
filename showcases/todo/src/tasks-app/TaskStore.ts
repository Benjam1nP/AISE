import { DatabaseSync } from 'node:sqlite';
import { Task } from './Task.js';

/**
 * SQLite persistence of tasks inside the service process.
 *
 * @trace DSN-008 REQ-003 REQ-006
 */
export class TaskStore {
  private readonly tableName = 'tasks';

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, text TEXT NOT NULL, done INTEGER NOT NULL, createdAt INTEGER NOT NULL)'
    );
  }

  private readonly db: DatabaseSync;

  /** Returns all stored tasks ordered by creation time. */
  async findAll(): Promise<Task[]> {
    const rows = this.db
      .prepare('SELECT id, text, done, createdAt FROM tasks ORDER BY createdAt, id')
      .all() as unknown as { id: string; text: string; done: number; createdAt: number }[];
    return rows.map((r) => ({ id: r.id, text: r.text, done: r.done === 1, createdAt: r.createdAt }));
  }

  /** Returns the task with the given id, or null when it is not stored. */
  async findById(id: string): Promise<Task | null> {
    const rows = this.db
      .prepare('SELECT id, text, done, createdAt FROM tasks WHERE id = ?')
      .all(id) as unknown as { id: string; text: string; done: number; createdAt: number }[];
    const r = rows[0];
    return r ? { id: r.id, text: r.text, done: r.done === 1, createdAt: r.createdAt } : null;
  }

  /** Inserts a new task; throws when the id is already stored. */
  async insert(task: Task): Promise<void> {
    this.db
      .prepare('INSERT INTO tasks (id, text, done, createdAt) VALUES (?, ?, ?, ?)')
      .run(task.id, task.text, task.done ? 1 : 0, task.createdAt);
  }

  /** Updates a stored task's fields; throws when the task is not stored. */
  async update(task: Task): Promise<void> {
    const result = this.db
      .prepare('UPDATE tasks SET text = ?, done = ?, createdAt = ? WHERE id = ?')
      .run(task.text, task.done ? 1 : 0, task.createdAt, task.id);
    if (Number(result.changes) === 0) {
      throw new Error(`Task ${task.id} not found`);
    }
  }

  /** Deletes the task with the given id; throws when the id is empty. */
  async delete(id: string): Promise<void> {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('id must be a non-empty string');
    }
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }
}
