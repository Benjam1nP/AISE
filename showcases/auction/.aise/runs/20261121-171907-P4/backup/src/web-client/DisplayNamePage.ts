import { ApiClient } from './ApiClient.js';

/**
 * Page where the user picks a display name.
 * @trace DSN-039 REQ-008
 */
export class DisplayNamePage {
  constructor(private readonly apiClient: ApiClient) {}

  /**
   * Validates the display name and registers it with the server.
   * The server assigns one user id per unique display name.
   */
  async submitName(displayName: string): Promise<void> {
    const name = (displayName ?? '').trim();
    if (name.length < 2 || name.length > 20) {
      throw new Error('Display name must be between 2 and 20 characters');
    }
    await this.apiClient.register(name);
  }
}
