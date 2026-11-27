import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import type { EventFeed } from '../auction-api/EventFeed.js';
import type { AuctionCloser } from '../auction-api/AuctionCloser.js';

const file = process.env.DB_PATH ?? './data/auction.db';
if (file !== ':memory:') {
  mkdirSync(path.dirname(file), { recursive: true });
}
const app = createApp(new DatabaseSync(file));
const eventFeed = app.locals.eventFeed as EventFeed;
const auctionCloser = app.locals.auctionCloser as AuctionCloser;

setInterval(() => {
  auctionCloser.tick().catch((err) => console.error(err));
}, auctionCloser.intervalMs);

const port = Number(process.env.PORT ?? 8080);
const server = app.listen(port, () => {
  console.log(`API server listening on ${port}`);
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (req.url?.split('?')[0] !== '/internal/live-update-server') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    eventFeed.clients.add(ws);
    ws.on('close', () => eventFeed.clients.delete(ws));
    ws.on('error', () => eventFeed.clients.delete(ws));
  });
});
