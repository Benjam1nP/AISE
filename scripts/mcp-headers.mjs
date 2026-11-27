// headersHelper for the dev tooling MCP servers in .mcp.json.
// Usage: node scripts/mcp-headers.mjs <21st|originkit>
// Reads the key from the repo root .env (or the environment) and prints the
// header JSON. Exits non zero with a clear message when the key is missing,
// so no empty or "undefined" credential is ever sent.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const servers = {
	'21st': { key: 'TWENTYFIRST_API_KEY', header: (k) => ({ 'x-api-key': k }) },
	originkit: { key: 'ORIGIN_KIT_KEY', header: (k) => ({ Authorization: `Bearer ${k}` }) }
};

const server = servers[process.argv[2]];
if (!server) {
	console.error(
		`unknown server "${process.argv[2]}"; expected one of ${Object.keys(servers).join(', ')}`
	);
	process.exit(1);
}
const value = process.env[server.key]?.trim();
if (!value) {
	console.error(`${server.key} is not set; add it to .env (see .env.example)`);
	process.exit(1);
}
console.log(JSON.stringify(server.header(value)));
