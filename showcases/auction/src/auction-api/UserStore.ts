import { DatabaseSync } from 'node:sqlite';
import { User } from './User.js';

/**
 * Persists users with a unique display name in the API server's SQLite database.
 *
 * @trace DSN-028 REQ-008
 */
export class UserStore {
  /** Creates the users table if it does not exist. */
  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL UNIQUE)'
    );
  }

  private readonly db: DatabaseSync;

  /** Returns the user with the given display name, or null when none has it. */
  async findByName(displayName: string): Promise<User | null> {
    if (typeof displayName !== 'string' || displayName.length === 0) {
      throw new Error('displayName must be a non-empty string');
    }
    const rows = this.db
      .prepare('SELECT id, display_name FROM users WHERE display_name = ?')
      .all(displayName) as unknown as { id: string; display_name: string }[];
    return rows.length === 0 ? null : this.toUser(rows[0]);
  }

  /** Inserts the user when its id is not stored yet, otherwise updates its display name; throws when the id is empty or the display name is taken. */
  async save(user: User): Promise<User> {
    if (typeof user.id !== 'string' || user.id.length === 0) {
      throw new Error('user.id must be a non-empty string');
    }
    const exists = this.db
      .prepare('SELECT id FROM users WHERE id = ?')
      .all(user.id) as unknown as { id: string }[];
    if (exists.length === 0) {
      this.db
        .prepare('INSERT INTO users (id, display_name) VALUES (?, ?)')
        .run(user.id, user.displayName);
    } else {
      this.db
        .prepare('UPDATE users SET display_name = ? WHERE id = ?')
        .run(user.displayName, user.id);
    }
    return user;
  }

  /** Returns the user with the given id, or null when none has it; throws when the id is empty. */
  async findById(id: string): Promise<User | null> {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('id must be a non-empty string');
    }
    const rows = this.db
      .prepare('SELECT id, display_name FROM users WHERE id = ?')
      .all(id) as unknown as { id: string; display_name: string }[];
    return rows.length === 0 ? null : this.toUser(rows[0]);
  }

  private toUser(row: { id: string; display_name: string }): User {
    return new User(row.id, row.display_name);
  }
}
