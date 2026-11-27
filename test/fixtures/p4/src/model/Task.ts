import { TaskStatus } from './TaskStatus.js';

/**
 * @trace DSN-001 REQ-001 REQ-002
 */
export class Task {
	constructor(
		public id: number,
		public title: string,
		public status: TaskStatus
	) {}

	isDone(): boolean {
		return this.status === TaskStatus.Done;
	}
}
