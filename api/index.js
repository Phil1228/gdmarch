export default async function handler(req, res) {
  try {
    const mod = await import('../server.mjs');
    const handleRequest = mod.handleRequest;
    const originalUrl =
      (req.headers && (req.headers['x-vercel-original-url'] || req.headers['x-now-original-url'])) || null;
    if (typeof originalUrl === 'string' && originalUrl.startsWith('/')) req.url = originalUrl;
    if (typeof req.url === 'string') {
      const u = req.url;
      const qIndex = u.indexOf('?');
      const path = qIndex === -1 ? u : u.slice(0, qIndex);
      const query = qIndex === -1 ? '' : u.slice(qIndex);
      if (path.length > 1 && path.endsWith('/')) req.url = path.slice(0, -1) + query;
    }
    return await handleRequest(req, res);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: String(e && e.message || e), stack: e && e.stack }));
  }
}
