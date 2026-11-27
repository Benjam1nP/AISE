import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { LiveGateway } from '../live-updates/LiveGateway.js';
import { EventFeedClient } from '../live-updates/EventFeedClient.js';

const liveGateway = new LiveGateway(new Map<string, WebSocket>());
const eventFeedClient = new EventFeedClient(liveGateway);

const app = express();
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const server = createServer(app);
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  const clientId = randomUUID();
  const items = new Set<string>();
  liveGateway.sockets.set(clientId, ws);
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as { action?: string; itemId?: unknown };
      if (msg.action !== 'watch' && msg.action !== 'unwatch') return;
      if (typeof msg.itemId !== 'string' || msg.itemId.length === 0) {
        throw new Error('itemId must be a non-empty string');
      }
      if (msg.action === 'watch') {
        liveGateway.watch(clientId, msg.itemId);
        items.add(msg.itemId);
      } else {
        liveGateway.unwatch(clientId, msg.itemId);
        items.delete(msg.itemId);
      }
    } catch (err) {
      ws.send(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });
  ws.on('error', () => {
    ws.close();
  });
  ws.on('close', () => {
    for (const itemId of items) liveGateway.unwatch(clientId, itemId);
    liveGateway.sockets.delete(clientId);
  });
});

eventFeedClient.connect();

const port = Number(process.env.LIVE_UPDATE_SERVER_PORT ?? 8081);
server.listen(port, () => {
  console.log(`Live update server listening on ${port}`);
});
