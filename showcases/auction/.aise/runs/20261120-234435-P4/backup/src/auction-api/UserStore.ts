import { randomUUID } from 'node:crypto';
import { User } from './User.js';

/**
 * Persistence of users with unique display name, in the API server's SQLite database.
 *
 * @trace DSN-028 REQ-008
 */
export class UserStore {
  private readonly usersById: Map<string, User> = new Map();
  private readonly idsByName: Map<string, string> = new Map();

  constructor() {
    // In-memory state only; no dependencies and no attributes.
  }

  /**
   * Finds the user holding the given display name, or null when none does.
   */
  async findByName(displayName: string): Promise<User | null> {
    const id = this.idsByName.get(displayName);
    if (id === undefined) {
      return null;
    }
    const user = this.usersById.get(id);
    return user ? new User(user.id, user.displayName) : null;
  }

  /**
   * Stores a user. A display name must be 2 to 20 characters and may be held
   * by only one user id. Assigns a server-side id when none is given.
   */
  async save(user: User): Promise<User> {
    const name = user.displayName;
    if (typeof name !== 'string' || name.length < 2 || name.length > 20) {
      throw new Error('Display name must be between 2 and 20 characters');
    }

    const holderId = this.idsByName.get(name);
    if (holderId !== undefined && holderId !== user.id) {
      throw new Error(`Display name ${name} is already taken`);
    }

    let id = user.id;
    if (!id) {
      id = randomUUID();
    }
    const existing = this.usersById.get(id);
    if (existing && existing.displayName !== name) {
      throw new Error(`User ${id} already has a different display name`);
    }

    const stored = new User(id, name);
    this.usersById.set(id, stored);
    this.idsByName.set(name, id);
    return new User(stored.id, stored.displayName);
  }
}
