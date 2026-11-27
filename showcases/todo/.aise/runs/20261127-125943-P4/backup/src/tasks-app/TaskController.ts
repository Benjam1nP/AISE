import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Task } from './Task.js';
import { TaskService } from './TaskService.js';

const PAGE_PATH = fileURLToPath(new URL('../../public/index.html', import.meta.url));

/**
 * HTTP-facing controller that serves the task page and maps task routes onto TaskService.
 * @trace DSN-006 REQ-001 REQ-002 REQ-004 REQ-005 REQ-006 REQ-007 REQ-008
 */
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  /** Returns the HTML of public/index.html; throws when the file cannot be read. */
  async page(): Promise<string> {
    return readFile(PAGE_PATH, 'utf8');
  }

  /** Returns all tasks with open tasks first, each group oldest first; throws on service errors. */
  async list(): Promise<Task[]> {
    const tasks = await this.taskService.list();
    return [...tasks].sort((a, b) => {
      if (a.done !== b.done) {
        return a.done ? 1 : -1;
      }
      return a.createdAt - b.createdAt;
    });
  }

  /** Adds a task from body.text; throws when body.text is not a string or the text is invalid. */
  async create(body: { text: string; }): Promise<Task> {
    if (typeof body?.text !== 'string') {
      throw new Error('text must be a string');
    }
    return this.taskService.add(body.text);
  }

  /** Updates the text and/or done state of task id and returns it; throws when id is invalid or no field is given. */
  async update(id: string, body: { text?: string; done?: boolean; }): Promise<Task> {
    this.checkId(id);
    if (body?.text === undefined && body?.done === undefined) {
      throw new Error('text or done is required');
    }
    let task: Task | undefined;
    if (body.text !== undefined) {
      task = await this.taskService.editText(id, body.text);
    }
    if (body.done !== undefined) {
      if (typeof body.done !== 'boolean') {
        throw new Error('done must be a boolean');
      }
      task = await this.taskService.setDone(id, body.done);
    }
    return task as Task;
  }

  /** Deletes task id; throws when id is invalid. */
  async remove(id: string): Promise<void> {
    this.checkId(id);
    await this.taskService.remove(id);
  }

  private checkId(id: string): void {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('id must be a non-empty string');
    }
  }
}
