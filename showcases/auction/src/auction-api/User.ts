/**
 * A user identified by a unique display name, with no password.
 *
 * @trace DSN-014 REQ-008
 */
export class User {
  constructor(public id: string, public displayName: string) {
    if (id.length === 0) {
      throw new Error('User id must not be empty');
    }
    const length = displayName.trim().length;
    if (length < 2 || length > 20) {
      throw new Error('Display name must be 2 to 20 characters');
    }
  }
}
