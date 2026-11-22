// Chartmates JSON API. Each chart is its own Durable Object (named by chart id); this function validates
// the route, applies per-IP rate limits (MetaDO) and forwards the operation.
import { rid, sha } from '../../lib/store.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const meta = (env) => env.META.get(env.META.idFromName('main'));
const metaCall = async (env, msg) => (await meta(env).fetch('https://do/', { method: 'POST', body: JSON.stringify(msg) })).json();

async function chartCall(env, id, op, token, body, now) {
  const stub = env.CHARTS.get(env.CHARTS.idFromName(id));
  const r = await stub.fetch('https://do/', { method: 'POST', body: JSON.stringify({ op, token, body, now }) });
  return { status: r.status, data: await r.json() };
}

async function readBody(request) {
  const t = await request.text();
  if (t.length > 8000) throw new Error('too large');
  return t ? JSON.parse(t) : {};
}

export async function onRequest({ request, env, params }) {
  const parts = [].concat(params.path || []);
  const method = request.method;
  const token = request.headers.get('x-token') || '';
  const now = env.TEST_HOOKS === '1' ? Number(request.headers.get('x-now')) || null : null;
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const key = (await sha('fc:' + ip)).slice(0, 16);
  const limited = async (kind) => !(await metaCall(env, { op: 'limit', key, kind })).ok;

  try {
    if (parts[0] === 'stats' && method === 'GET') return json(await metaCall(env, { op: 'stats' }));
    if (parts[0] !== 'charts') return json({ error: 'Not found.' }, 404);

    // POST /api/charts : create (optionally as the next chart of an existing one)
    if (parts.length === 1 && method === 'POST') {
      if (await limited('create')) return json({ error: 'Too many charts from this network. Try again in an hour.' }, 429);
      let body;
      try {
        body = await readBody(request);
      } catch {
        return json({ error: 'Invalid request.' }, 400);
      }
      let prev = null;
      if (body.prev) {
        if (!/^[A-Za-z0-9]{8}$/.test(String(body.prev))) return json({ error: 'Invalid chart.' }, 400);
        const who = await chartCall(env, body.prev, 'whoami', token, {}, now);
        if (who.status !== 200) return json(who.data, who.status);
        if (who.data.next) return json({ existing: who.data.next.id });
        prev = String(body.prev);
        body.name = who.data.name;
        body.expected = Math.min(16, Math.max(3, who.data.expected));
      }
      const id = rid(8);
      const made = await chartCall(env, id, 'create', '', { ...body, id, prev }, now);
      if (made.status !== 200) return json(made.data, made.status);
      if (prev) {
        const link = await chartCall(env, prev, 'setNext', '', { id, title: made.data.title || '', emoji: made.data.emoji || '' }, now);
        if (link.data.next && link.data.next.id !== id) {
          await chartCall(env, id, 'remove', made.data.token, {}, now);
          return json({ existing: link.data.next.id });
        }
      }
      await metaCall(env, { op: 'count', kind: 'charts' });
      return json(made.data);
    }

    const id = parts[1] || '';
    if (!/^[A-Za-z0-9]{8}$/.test(id)) return json({ error: 'This chart does not exist.' }, 404);
    if (parts.length === 2 && method === 'GET') {
      if (await limited('read')) return json({ error: 'Too many requests. Slow down a little.' }, 429);
      const r = await chartCall(env, id, 'get', token, {}, now);
      return json(r.data, r.status);
    }
    const action = parts[2];
    const ops = { join: 'join', place: 'place', hide: 'hide', reveal: 'reveal', delete: 'remove' };
    if (parts.length === 3 && method === 'POST' && ops[action]) {
      if (await limited(action === 'join' ? 'join' : 'write')) return json({ error: 'Too many requests. Try again later.' }, 429);
      let body;
      try {
        body = await readBody(request);
      } catch {
        return json({ error: 'Invalid request.' }, 400);
      }
      const r = await chartCall(env, id, ops[action], token, body, now);
      if (action === 'join' && r.status === 200 && r.data.token !== token) await metaCall(env, { op: 'count', kind: 'joins' });
      return json(r.data, r.status);
    }
    return json({ error: 'Not found.' }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: 'Something went wrong.' }, 500);
  }
}
