import { User } from './User.js';
import { UserService } from './UserService.js';

/**
 * HTTP-facing entry point for users: registers a display name as a user identity.
 *
 * @trace DSN-018 REQ-008
 */
export class UserController {
  constructor(private readonly userService: UserService) {}

  /** Registers a display name and returns the issued user; throws if the name is invalid or taken. */
  async register(displayName: string): Promise<User> {
    if (typeof displayName !== 'string') {
      throw new Error('displayName must be a string');
    }
    return this.userService.register(displayName);
  }
}
