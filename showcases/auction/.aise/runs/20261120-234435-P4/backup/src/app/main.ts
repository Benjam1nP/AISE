import { createAppParts } from './app.js';

const { app, auctionCloser } = createAppParts();
setInterval(() => {
  auctionCloser.tick().catch((err: unknown) => console.error(err));
}, auctionCloser.intervalMs);

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
