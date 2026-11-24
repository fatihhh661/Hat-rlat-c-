// Yerel geliştirme sunucusu: worker.js'i bellek içi KV ile Node'da çalıştırır.
// Çalıştır: node tools/serve.mjs [port]   →  http://localhost:8787
import http from 'node:http';
import worker from '../worker.js';

const store = new Map();
const KV = {
  async get(k, t) { const v = store.get(k); if (v == null) return null; return (t === 'json' || (t && t.type === 'json')) ? JSON.parse(v) : v; },
  async put(k, v) { store.set(k, String(v)); },
  async delete(k) { store.delete(k); }
};
const env = { KV };
const port = +(process.argv[2] || 8787);

export function start(p = port) {
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(`http://localhost:${p}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const r = await worker.fetch(request, env, { waitUntil() {} });
      const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
      res.writeHead(r.status, headers);
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise(ok => server.listen(p, () => ok(server)));
}
if (import.meta.url === `file://${process.argv[1]}`) start().then(() => console.log(`http://localhost:${port}`));
