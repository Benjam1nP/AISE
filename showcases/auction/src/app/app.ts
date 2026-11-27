import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { WebSocket } from 'ws';
import { UserStore } from '../auction-api/UserStore.js';
import { ItemStore } from '../auction-api/ItemStore.js';
import { EventFeed } from '../auction-api/EventFeed.js';
import { AuctionEventPublisher } from '../auction-api/AuctionEventPublisher.js';
import { BidEventPublisher } from '../auction-api/BidEventPublisher.js';
import { UserService } from '../auction-api/UserService.js';
import { ItemService } from '../auction-api/ItemService.js';
import { BidService } from '../auction-api/BidService.js';
import { AuctionCloser } from '../auction-api/AuctionCloser.js';
import { UserController } from '../auction-api/UserController.js';
import { ItemController } from '../auction-api/ItemController.js';
import { BidController } from '../auction-api/BidController.js';
import { FrankfurterClient } from '../exchange-rates/FrankfurterClient.js';
import { ExchangeRateService } from '../exchange-rates/ExchangeRateService.js';

export function createApp(db: DatabaseSync = new DatabaseSync(':memory:')): Express {
  const userStore = new UserStore(db);
  const itemStore = new ItemStore(db);
  const eventFeed = new EventFeed(new Set<WebSocket>());
  const auctionEventPublisher = new AuctionEventPublisher(eventFeed);
  const bidEventPublisher = new BidEventPublisher(eventFeed);
  const frankfurterClient = new FrankfurterClient();
  // Rates are cached for 1 hour, as the design states.
  const exchangeRateService = new ExchangeRateService(frankfurterClient, 60 * 60 * 1000);
  const userService = new UserService(userStore);
  const itemService = new ItemService(itemStore, userStore, auctionEventPublisher);
  const bidService = new BidService(itemStore, bidEventPublisher, userStore);
  // Default check interval: 5 seconds.
  const auctionCloser = new AuctionCloser(itemService, 5000);
  const userController = new UserController(userService);
  const itemController = new ItemController(itemService, exchangeRateService);
  const bidController = new BidController(bidService);

  const app = express();
  app.locals.eventFeed = eventFeed;
  app.locals.auctionCloser = auctionCloser;

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(express.json());
  app.use(express.static(fileURLToPath(new URL('../../public', import.meta.url))));

  app.get('/api/config', (_req, res) => {
    res.json({ 'live-update-server': process.env.LIVE_UPDATE_SERVER_PUBLIC_URL ?? 'ws://localhost:8081' });
  });

  app.post('/api/users', async (req, res) => {
    res.status(201).json(await userController.register(req.body?.displayName));
  });
  app.post('/api/items', async (req, res) => {
    const b = req.body ?? {};
    res.status(201).json(await itemController.listItem(b.userId, b.title, b.startingPrice, b.endTime, b.currency));
  });
  app.get('/api/items', async (_req, res) => {
    res.json(await itemController.listOpenItems());
  });
  app.get('/api/items/:id', async (req, res) => {
    const dc = req.query.displayCurrency;
    res.json(await itemController.getItem(String(req.params.id), typeof dc === 'string' && dc !== '' ? dc : undefined));
  });
  app.post('/api/items/:id/bids', async (req, res) => {
    const b = req.body ?? {};
    res.status(201).json(await bidController.placeBid(String(req.params.id), b.userId, b.amount));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.endsWith('not found') ? 404 : 400).json({ error: message });
  });

  return app;
}
