import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './app.js';

const file = process.env.DB_PATH ?? './data/booking.db';
if (file !== ':memory:') {
  mkdirSync(path.dirname(file), { recursive: true });
}
const port = Number(process.env.PORT ?? 8080);
createApp(new DatabaseSync(file)).listen(port, () => {
  console.log(`Listening on port ${port}`);
});
