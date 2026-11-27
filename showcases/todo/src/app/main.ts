import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './app.js';

const file = process.env.DB_PATH ?? './data/todo.db';
if (file !== ':memory:') {
  mkdirSync(path.dirname(file), { recursive: true });
}
const app = createApp(new DatabaseSync(file));
const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
