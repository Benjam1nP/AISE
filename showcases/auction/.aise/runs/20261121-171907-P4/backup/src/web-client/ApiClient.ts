import { Currency } from '../auction-api/Currency.js';
import { User } from '../auction-api/User.js';
import { Item } from '../auction-api/Item.js';
import { Bid } from '../auction-api/Bid.js';
import { ItemView } from '../auction-api/ItemView.js';
import { UserController } from '../auction-api/UserController.js';
import { ItemController } from '../auction-api/ItemController.js';
import { BidController } from '../auction-api/BidController.js';
import { SessionStore } from './SessionStore.js';

/**
 * Browser HTTP client for the API server routes.
 * @trace DSN-037 REQ-001 REQ-002 REQ-005 REQ-008
 */
export class ApiClient {
  private readonly session: SessionStore = new SessionStore(null, null, null);

  constructor(private readonly userController: UserController, private readonly itemController: ItemController, private readonly bidController: BidController) {}

  async register(displayName: string): Promise<User> {
    const trimmed = displayName.trim();
    if (trimmed.length < 2 || trimmed.length > 20) {
      throw new Error('Display name must be between 2 and 20 characters');
    }
    const user = await this.userController.register(trimmed);
    this.session.save(user);
    return user;
  }

  async listItem(title: string, startingPrice: number, endTime: string, currency: Currency): Promise<Item> {
    const userId = this.requireUserId();
    return this.itemController.listItem(userId, title, startingPrice, endTime, currency);
  }

  async listOpenItems(): Promise<Item[]> {
    return this.itemController.listOpenItems();
  }

  async getItem(id: string, displayCurrency: Currency | null): Promise<ItemView> {
    if (displayCurrency !== null) {
      this.session.setDisplayCurrency(displayCurrency);
    }
    return this.itemController.getItem(id, displayCurrency ?? undefined);
  }

  async placeBid(itemId: string, amount: number): Promise<Bid> {
    const userId = this.requireUserId();
    return this.bidController.placeBid(itemId, userId, amount);
  }

  private requireUserId(): string {
    if (this.session.userId === null) {
      throw new Error('User must register a display name before acting');
    }
    return this.session.userId;
  }
}
