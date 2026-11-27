import { AdminAuthService } from '../domain-services/AdminAuthService.js';

/**
 * HTTP route for admin login.
 *
 * @trace DSN-005 REQ-009
 */
export class AdminController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  /**
   * Verifies the admin password and returns an admin token.
   * Throws an Error when the password is missing or wrong.
   */
  async login(password: string): Promise<string> {
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('Password is required');
    }
    const token = this.adminAuthService.verifyPassword(password);
    if (token === null) {
      throw new Error('Invalid admin password');
    }
    return token;
  }
}
