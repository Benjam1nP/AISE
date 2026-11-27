import { randomUUID } from 'node:crypto';
import { Task } from './Task.js';
import { TaskStore } from './TaskStore.js';

const MAX_TEXT_LENGTH = 200;

/**
 * Validates task text, applies the task rules and orders the task list.
 * @trace DSN-007 REQ-001 REQ-002 REQ-005 REQ-006 REQ-007
 */
export class TaskService {
  constructor(private readonly taskStore: TaskStore) {}

  /** Returns all tasks with open tasks first, each group oldest first. */
  async list(): Promise<Task[]> {
    const tasks = await this.taskStore.findAll();
    return [...tasks].sort((a, b) => {
      if (a.done !== b.done) {
        return a.done ? 1 : -1;
      }
      return a.createdAt - b.createdAt;
    });
  }

  /** Adds a new not-done task; throws if the text is invalid. */
  async add(text: string): Promise<Task> {
    const task: Task = {
      id: randomUUID(),
      text: this.normalizeText(text),
      done: false,
      createdAt: Date.now(),
    };
    await this.taskStore.insert(task);
    return task;
  }

  /** Sets the done state of a task; throws if the id is invalid or the task is not found. */
  async setDone(id: string, done: boolean): Promise<Task> {
    this.checkId(id);
    const task = await this.requireTask(id);
    task.done = done;
    await this.taskStore.update(task);
    return task;
  }

  /** Replaces the text of a task; throws if the id or text is invalid or the task is not found. */
  async editText(id: string, text: string): Promise<Task> {
    this.checkId(id);
    const normalized = this.normalizeText(text);
    const task = await this.requireTask(id);
    task.text = normalized;
    await this.taskStore.update(task);
    return task;
  }

  /** Deletes a task; throws if the id is invalid or the task is not found. */
  async remove(id: string): Promise<void> {
    this.checkId(id);
    await this.requireTask(id);
    await this.taskStore.delete(id);
  }

  /** Trims the text and returns it; throws if it is empty or longer than 200 characters after trimming. */
  normalizeText(text: string): string {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error('Text must not be empty');
    }
    if (trimmed.length > MAX_TEXT_LENGTH) {
      throw new Error(`Text must be at most ${MAX_TEXT_LENGTH} characters`);
    }
    return trimmed;
  }

  private checkId(id: string): void {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('id must be a non-empty string');
    }
  }

  private async requireTask(id: string): Promise<Task> {
    const task = await this.taskStore.findById(id);
    if (task === null) {
      throw new Error(`Task ${id} not found`);
    }
    return task;
  }
}
