import { randomUUID } from 'node:crypto';
import { User } from './User.js';
import { UserStore } from './UserStore.js';

/**
 * Validates display names and issues one user id per name.
 *
 * @trace DSN-021 REQ-008
 */
export class UserService {
  constructor(private readonly userStore: UserStore) {}

  /** Trims and validates a display name, then issues a new user id for it; throws if the name is invalid or taken. */
  async register(displayName: string): Promise<User> {
    if (typeof displayName !== 'string') {
      throw new Error('displayName must be a string');
    }
    const name = displayName.trim();
    if (name.length < 2 || name.length > 20) {
      throw new Error('displayName must be between 2 and 20 characters');
    }
    const existing = await this.userStore.findByName(name);
    if (existing !== null) {
      throw new Error(`displayName ${name} is already taken`);
    }
    const user = new User(randomUUID(), name);
    return this.userStore.save(user);
  }
}
