import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserStore } from '../auction-api/UserStore.js';
import { ItemStore } from '../auction-api/ItemStore.js';
import { UserService } from '../auction-api/UserService.js';
import { UserController } from '../auction-api/UserController.js';
import { EventFeed } from '../auction-api/EventFeed.js';
import { EventSubscriber } from '../live-updates/EventSubscriber.js';
import { AuctionEventPublisher } from '../auction-api/AuctionEventPublisher.js';
import { BidEventPublisher } from '../auction-api/BidEventPublisher.js';
import { ItemService } from '../auction-api/ItemService.js';
import { ItemController } from '../auction-api/ItemController.js';
import { BidService } from '../auction-api/BidService.js';
import { BidController } from '../auction-api/BidController.js';
import { AuctionCloser } from '../auction-api/AuctionCloser.js';
import { FrankfurterClient } from '../exchange-rates/FrankfurterClient.js';
import { ExchangeRateService } from '../exchange-rates/ExchangeRateService.js';
import { Currency } from '../auction-api/Currency.js';
import type { FrankfurterApi } from '../frankfurter-service/FrankfurterApi.js';

const frankfurterApi: FrankfurterApi = {
  async latest(base: string): Promise<Record<string, number>> {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`);
    if (!res.ok) {
      throw new Error(`Frankfurter answered ${res.status}`);
    }
    const body = (await res.json()) as { rates?: Record<string, number> };
    return body.rates ?? {};
  },
};

export interface AppParts {
  app: Express;
  auctionCloser: AuctionCloser;
}

export function createAppParts(): AppParts {
  const db = new DatabaseSync(':memory:');
  const userStore = new UserStore();
  const itemStore = new ItemStore(db);
  const userService = new UserService(userStore);
  const userController = new UserController(userService);
  // EventFeed and EventSubscriber refer to each other; close the loop after creation.
  const eventSubscriber = new EventSubscriber(undefined as unknown as EventFeed);
  const eventFeed = new EventFeed(eventSubscriber);
  const auctionEventPublisher = new AuctionEventPublisher(eventFeed);
  const bidEventPublisher = new BidEventPublisher(eventFeed);
  const itemService = new ItemService(itemStore, userStore, auctionEventPublisher);
  const itemController = new ItemController(itemService);
  const bidService = new BidService(itemStore, bidEventPublisher, userStore);
  const bidController = new BidController(bidService);
  const auctionCloser = new AuctionCloser(itemService, 1000);
  const frankfurterClient = new FrankfurterClient(frankfurterApi);
  const exchangeRateService = new ExchangeRateService(frankfurterClient, 60 * 60 * 1000);

  const app = express();
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.use(express.json());
  app.use(express.static(fileURLToPath(new URL('../../public', import.meta.url))));

  app.post('/api/users', async (req, res) => {
    const body = req.body ?? {};
    res.status(201).json(await userController.register(body.displayName));
  });

  app.post('/api/items', async (req, res) => {
    const b = req.body ?? {};
    res.status(201).json(
      await itemController.listItem(b.userId, b.title, b.startingPrice, b.endTime, b.currency),
    );
  });

  app.get('/api/items', async (_req, res) => {
    res.json(await itemController.listOpenItems());
  });

  app.get('/api/items/:id', async (req, res) => {
    const dc = typeof req.query.displayCurrency === 'string' && req.query.displayCurrency !== ''
      ? req.query.displayCurrency
      : undefined;
    const view = await itemController.getItem(String(req.params.id), dc);
    if (view.displayCurrency !== null) {
      const to: Currency = view.displayCurrency;
      const item = view.item;
      view.convertedStartingPrice = await exchangeRateService.convert(item.startingPrice, item.currency, to);
      view.convertedHighestBid = item.highestBidAmount === null
        ? null
        : await exchangeRateService.convert(item.highestBidAmount, item.currency, to);
    }
    res.json(view);
  });

  app.post('/api/items/:id/bids', async (req, res) => {
    const b = req.body ?? {};
    res.status(201).json(await bidController.placeBid(String(req.params.id), b.userId, b.amount));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof Error && message.endsWith('not found') ? 404 : 400;
    res.status(status).json({ error: message });
  });

  void path;
  return { app, auctionCloser };
}

export function createApp(): Express {
  return createAppParts().app;
}
