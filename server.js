const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const publicFiles = new Map([
  ['/ai-share.html', path.join(projectRoot, 'ai-share.html')],
  ['/assets/brand-mark.svg', path.join(projectRoot, 'assets', 'brand-mark.svg')],
]);
const rpcUrl = process.env.SOLANA_RPC_URL || 'https://solana-rpc.publicnode.com';
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || '127.0.0.1';
const maxBodyBytes = 1024 * 1024;
const requestsPerMinute = 120;
const requestCounts = new Map();
const allowedMethods = new Set([
  'getAccountInfo',
  'getBalance',
  'getBlockHeight',
  'getFeeForMessage',
  'getLatestBlockhash',
  'getSignatureStatuses',
  'getSlot',
  'getVersion',
  'sendTransaction',
  'simulateTransaction',
]);

const rateLimitCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of requestCounts) {
    if (value.resetAt <= now) requestCounts.delete(key);
  }
}, 60_000);
rateLimitCleanup.unref();

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON'), { statusCode: 400 });
  }
}

function isRateLimited(request) {
  const now = Date.now();
  const key = request.socket.remoteAddress || 'unknown';
  const current = requestCounts.get(key);
  if (!current || current.resetAt <= now) {
    requestCounts.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > requestsPerMinute;
}

async function handleRpc(request, response) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    return sendJson(response, 415, { error: 'Content-Type must be application/json' });
  }
  if (isRateLimited(request)) {
    return sendJson(response, 429, { error: 'RPC request limit exceeded. Try again shortly.' });
  }

  const payload = await readJsonBody(request);
  if (
    !payload ||
    Array.isArray(payload) ||
    payload.jsonrpc !== '2.0' ||
    typeof payload.method !== 'string' ||
    !allowedMethods.has(payload.method)
  ) {
    return sendJson(response, 400, { error: 'Unsupported or invalid JSON-RPC request' });
  }

  let upstream;
  try {
    upstream = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return sendJson(response, 502, { error: 'Solana RPC provider is unavailable' });
  }

  if (!upstream.ok) {
    return sendJson(response, 502, { error: 'Solana RPC provider rejected the request' });
  }

  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(await upstream.text());
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

async function handleStatic(request, response, pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const requestedPath = decodedPath === '/' ? '/ai-share.html' : decodedPath;
  const filePath = publicFiles.get(requestedPath);
  if (!filePath) {
    return sendJson(response, 404, { error: 'Not found' });
  }

  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentType(filePath),
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : file);
  } catch {
    sendJson(response, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/rpc' && request.method === 'POST') {
      await handleRpc(request, response);
    } else if (request.method === 'GET' || request.method === 'HEAD') {
      await handleStatic(request, response, url.pathname);
    } else {
      sendJson(response, 405, { error: 'Method not allowed' });
    }
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, error.statusCode || 500, { error: error.message || 'Request failed' });
    } else {
      response.destroy();
    }
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;

server.listen(port, host, () => {
  console.log(`AI SHARE site and Solana RPC proxy listening at http://${host}:${port}`);
});
