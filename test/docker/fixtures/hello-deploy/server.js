import http from 'node:http';

http
	.createServer((req, res) => {
		if (req.url === '/health') {
			res.writeHead(200, { 'content-type': 'text/plain' });
			res.end('ok');
		} else if (req.url === '/redirect') {
			// deploy_check must not follow this, even though the target would answer 200.
			res.writeHead(302, { location: 'http://localhost:3917/health' }).end();
		} else {
			res.writeHead(404).end();
		}
	})
	.listen(3000);
