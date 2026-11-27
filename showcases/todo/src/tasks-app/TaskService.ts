import { randomUUID } from 'node:crypto';
import { Task } from './Task.js';
import { TaskStore } from './TaskStore.js';
import { TaskView } from './TaskView.js';

const MAX_TEXT_LENGTH = 200;

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Validates task text and due date, applies the task rules and orders the task list.
 * @trace DSN-007 REQ-001 REQ-002 REQ-005 REQ-006 REQ-007 REQ-009 REQ-010
 */
export class TaskService {
  constructor(private readonly taskStore: TaskStore) {}

  /** Returns all tasks with overdue flags, open first, each group oldest first; throws on an invalid today. */
  async list(today: string | undefined): Promise<TaskView[]> {
    const day = today ?? new Date().toISOString().slice(0, 10);
    if (typeof day !== 'string' || !isValidDate(day)) {
      throw new Error('today must be a date in the form YYYY-MM-DD');
    }
    const tasks = await this.taskStore.findAll();
    return [...tasks]
      .sort((a, b) => {
        if (a.done !== b.done) {
          return a.done ? 1 : -1;
        }
        return a.createdAt - b.createdAt;
      })
      .map((t) => ({ ...t, overdue: this.isOverdue(t, day) }));
  }

  /** True only for an open task whose due date is strictly before today. */
  isOverdue(task: Task, today: string): boolean {
    return !task.done && task.dueDate !== null && task.dueDate < today;
  }

  /** Adds a new not-done task; throws if the text or due date is invalid. */
  async add(text: string, dueDate: string | null): Promise<Task> {
    const task: Task = {
      id: randomUUID(),
      text: this.normalizeText(text),
      done: false,
      createdAt: Date.now(),
      dueDate: this.normalizeDueDate(dueDate),
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

  /** Replaces text and, unless undefined, due date of a task; throws if invalid or the task is not found. */
  async editText(id: string, text: string, dueDate: string | null | undefined): Promise<Task> {
    this.checkId(id);
    const normalized = this.normalizeText(text);
    const due = dueDate === undefined ? undefined : this.normalizeDueDate(dueDate);
    const task = await this.requireTask(id);
    task.text = normalized;
    if (due !== undefined) {
      task.dueDate = due;
    }
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
    if (typeof text !== 'string') {
      throw new Error('text must be a string');
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error('Text must not be empty');
    }
    if (trimmed.length > MAX_TEXT_LENGTH) {
      throw new Error(`Text must be at most ${MAX_TEXT_LENGTH} characters`);
    }
    return trimmed;
  }

  /** Returns null for no due date or the valid YYYY-MM-DD date; throws for anything else. */
  normalizeDueDate(dueDate: string | null): string | null {
    if (dueDate === null || dueDate === '') {
      return null;
    }
    if (typeof dueDate !== 'string' || !isValidDate(dueDate)) {
      throw new Error('dueDate must be a valid date in the form YYYY-MM-DD');
    }
    return dueDate;
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
