import { Task } from './Task.js';
import { TaskService } from './TaskService.js';

const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Tasks</title>
</head>
<body>
<h1>Tasks</h1>
<form id="add">
<input id="text" type="text" maxlength="400" required>
<button type="submit">Add</button>
</form>
<ul id="list"></ul>
<script>
async function send(url, method, body) {
  const r = await fetch(url, {
    method: method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) { alert(await r.text()); }
  await load();
}
async function load() {
  const r = await fetch('/api/tasks');
  const tasks = await r.json();
  const ul = document.getElementById('list');
  ul.innerHTML = '';
  for (const t of tasks) {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.done;
    cb.onchange = function () { send('/api/tasks/' + t.id, 'PATCH', { done: cb.checked }); };
    const span = document.createElement('span');
    span.textContent = t.text;
    if (t.done) { span.style.textDecoration = 'line-through'; }
    const edit = document.createElement('button');
    edit.textContent = 'Edit';
    edit.onclick = function () {
      const text = prompt('Edit task', t.text);
      if (text !== null) { send('/api/tasks/' + t.id, 'PATCH', { text: text }); }
    };
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = function () { send('/api/tasks/' + t.id, 'DELETE'); };
    li.appendChild(cb);
    li.appendChild(span);
    li.appendChild(edit);
    li.appendChild(del);
    ul.appendChild(li);
  }
}
document.getElementById('add').onsubmit = function (e) {
  e.preventDefault();
  const i = document.getElementById('text');
  const value = i.value;
  i.value = '';
  send('/api/tasks', 'POST', { text: value });
};
load();
</script>
</body>
</html>`;

/**
 * HTTP-facing controller that serves the task page and maps task routes onto TaskService.
 * @trace DSN-006 REQ-001 REQ-002 REQ-004 REQ-005 REQ-006 REQ-007 REQ-008
 */
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  /** Returns the single HTML page that runs the task list in the browser. */
  async page(): Promise<string> {
    return PAGE_HTML;
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
