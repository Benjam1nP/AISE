import { Task } from '../model/Task.js';
import { TaskStatus } from '../model/TaskStatus.js';

/**
 * @trace DSN-003 REQ-001
 */
export class TaskService {
	constructor(public nextId: number) {}

	addTask(title: string): Task {
		if (title.trim() === '') throw new Error('The title is empty');
		return new Task(this.nextId++, title.trim(), TaskStatus.Open);
	}

	completeTask(task: Task): Task {
		if (task.isDone()) throw new Error(`Task ${task.id} is done already`);
		task.status = TaskStatus.Done;
		return task;
	}
}
