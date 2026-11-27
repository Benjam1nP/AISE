import http from 'node:http';

// FAIL=1 makes the service exit at once, as a crashing node would.
if (process.env.FAIL === '1') {
	console.error('api failed on purpose');
	process.exit(1);
}

http
	.createServer((req, res) => {
		res.writeHead(req.url === '/health' ? 200 : 404).end(req.url === '/health' ? 'ok' : '');
	})
	.listen(3000);
