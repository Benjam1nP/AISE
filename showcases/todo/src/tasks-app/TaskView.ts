import { Task } from './Task.js';

/**
 * A Task as returned by the list route, with the server computed overdue flag.
 * @trace DSN-009 REQ-010
 */
export interface TaskView extends Task {
  overdue: boolean;
}
