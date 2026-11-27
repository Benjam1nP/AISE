/**
 * Task data record holding a task's text, done state and creation time.
 * @trace DSN-005 REQ-001 REQ-002 REQ-007
 */
export interface Task {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}
