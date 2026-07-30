// Tiny local API proxy for e2e runs. Defaults to listening on port 6001 and
// forwarding to the operational dev backend. Not for production.
//
//   node scripts/api-proxy.js [port] [target-origin]

const http = require('http');
const https = require('https');

const PORT = parseInt(process.argv[2] || process.env.PORT || '6001', 10);
const TARGET_ORIGIN = process.argv[3] || process.env.TARGET_ORIGIN || 'http://192.168.18.51:6001';
const TARGET = new URL(TARGET_ORIGIN);
const CLIENT_ORIGINS = new Set(
  (process.env.CORS_ORIGINS || 'http://127.0.0.1:6002,http://localhost:6002')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
);

const transport = TARGET.protocol === 'https:' ? https : http;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (origin && CLIENT_ORIGINS.has(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    };
  }
  return {};
}

function applyCors(req, res) {
  for (const [name, value] of Object.entries(corsHeaders(req))) res.setHeader(name, value);
}

function filteredResponseHeaders(headers) {
  const next = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower.startsWith('access-control-') || HOP_BY_HOP_HEADERS.has(lower)) continue;
    next[name] = value;
  }
  return next;
}

const server = http.createServer((req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'authorization,content-type,x-dev-user-email',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return;
  }

  const targetUrl = new URL(req.url || '/', TARGET);
  const proxyReq = transport.request({
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: `${targetUrl.pathname}${targetUrl.search}`,
    headers: {
      ...req.headers,
      host: targetUrl.host,
    },
  }, proxyRes => {
    const headers = {
      ...filteredResponseHeaders(proxyRes.headers),
      ...corsHeaders(req),
    };
    res.writeHead(proxyRes.statusCode || 502, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => {
    if (!res.headersSent) {
      applyCors(req, res);
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ error: 'Proxy request failed', message: err.message }));
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`API proxy listening on http://localhost:${PORT}/ -> ${TARGET_ORIGIN}`);
});
