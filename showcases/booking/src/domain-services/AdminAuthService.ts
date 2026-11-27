import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/**
 * Checks the password against the ADMIN_PASSWORD environment variable and issues and verifies admin tokens.
 *
 * @trace DSN-010 REQ-009
 */
export class AdminAuthService {
  private readonly tokens: Set<string>;

  constructor() {
    this.tokens = new Set<string>();
  }

  /**
   * Returns a new admin token when the password matches ADMIN_PASSWORD, otherwise null.
   */
  verifyPassword(password: string): string | null {
    const expected = process.env.ADMIN_PASSWORD;
    if (expected === undefined || expected === '') {
      return null;
    }
    if (typeof password !== 'string' || !this.safeEqual(password, expected)) {
      return null;
    }
    const token = randomBytes(32).toString('hex');
    this.tokens.add(token);
    return token;
  }

  /**
   * Returns true when the token was issued by this service and is still valid.
   */
  isValidToken(token: string): boolean {
    if (typeof token !== 'string' || token.length === 0) {
      return false;
    }
    return this.tokens.has(token);
  }

  private safeEqual(a: string, b: string): boolean {
    const ha = createHash('sha256').update(a, 'utf8').digest();
    const hb = createHash('sha256').update(b, 'utf8').digest();
    return timingSafeEqual(ha, hb);
  }
}
