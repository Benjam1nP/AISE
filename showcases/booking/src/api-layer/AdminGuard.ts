import { AdminAuthService } from '../domain-services/AdminAuthService.js';

/**
 * Rejects admin routes without a valid admin token.
 *
 * @trace DSN-013 REQ-009
 */
export class AdminGuard {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  requireAdmin(token: string): void {
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw new Error('Admin token is required');
    }
    if (!this.adminAuthService.isValidToken(token)) {
      throw new Error('Invalid admin token');
    }
  }
}
