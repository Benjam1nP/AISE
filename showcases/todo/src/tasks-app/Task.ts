/**
 * Task data record holding a task's text, done state, creation time and optional due date.
 * @trace DSN-005 REQ-001 REQ-002 REQ-007 REQ-009 REQ-010
 */
export interface Task {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  dueDate: string | null;
}
