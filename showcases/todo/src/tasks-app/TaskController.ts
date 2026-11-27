import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Task } from './Task.js';
import { TaskService } from './TaskService.js';
import { TaskView } from './TaskView.js';

const PAGE_PATH = fileURLToPath(new URL('../../public/index.html', import.meta.url));

/**
 * HTTP-facing controller that serves the task page and maps task routes onto TaskService.
 * @trace DSN-006 REQ-001 REQ-002 REQ-004 REQ-005 REQ-006 REQ-007 REQ-008 REQ-009 REQ-010
 */
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  /** Returns the HTML of public/index.html; throws when the file cannot be read. */
  async page(): Promise<string> {
    return readFile(PAGE_PATH, 'utf8');
  }

  /** Returns all tasks with overdue flags for the given date; throws on an invalid date. */
  async list(today: string | undefined): Promise<TaskView[]> {
    return this.taskService.list(today);
  }

  /** Adds a task from body.text and optional body.dueDate; throws when either is invalid. */
  async create(body: { text: string; dueDate?: string | null; }): Promise<Task> {
    if (typeof body?.text !== 'string') {
      throw new Error('text must be a string');
    }
    return this.taskService.add(body.text, body.dueDate ?? null);
  }

  /** Updates text, due date and/or done state of task id and returns it; throws when id is invalid or no field is given. */
  async update(id: string, body: { text?: string; done?: boolean; dueDate?: string | null; }): Promise<Task> {
    this.checkId(id);
    if (body?.text === undefined && body?.done === undefined && body?.dueDate === undefined) {
      throw new Error('text, done or dueDate is required');
    }
    if (body.done !== undefined && typeof body.done !== 'boolean') {
      throw new Error('done must be a boolean');
    }
    let task: Task | undefined;
    if (body.text !== undefined || body.dueDate !== undefined) {
      let text = body.text;
      if (text === undefined) {
        // Only the due date changes: keep the stored text.
        const current = (await this.taskService.list(undefined)).find((t) => t.id === id);
        if (!current) {
          throw new Error(`Task ${id} not found`);
        }
        text = current.text;
      }
      task = await this.taskService.editText(id, text, body.dueDate);
    }
    if (body.done !== undefined) {
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
