// pb-friend-chart-db: Durable Objects for Chartmates. One ChartDO per chart (named by chart id) and one
// MetaDO for rate limits and aggregate counts. The account is at the free plan's 10 D1 databases, so this
// replaces D1. No public route (workers_dev = false): the Pages Functions reach it through DO bindings.
import { DurableObject } from 'cloudflare:workers';
import { ChartStore, HttpError } from '../lib/store.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export class ChartDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const now = () => (env.TEST_HOOKS === '1' && this.fakeNow ? this.fakeNow : Date.now());
    this.store = new ChartStore(
      { get: (k) => ctx.storage.get(k), put: (k, v) => ctx.storage.put(k, v), deleteAll: () => ctx.storage.deleteAll(), setAlarm: (t) => ctx.storage.setAlarm(t) },
      { now },
    );
  }
  async fetch(request) {
    const { op, token, body = {}, now } = await request.json();
    this.fakeNow = now || null;
    const s = this.store;
    try {
      const ops = {
        create: () => s.create(body),
        get: () => s.get(token),
        join: () => s.join(token, body),
        place: () => s.place(token, body),
        hide: () => s.setHidden(token, body),
        reveal: () => s.reveal(token),
        remove: () => s.remove(token),
        setNext: () => s.setNext(body),
        whoami: () => s.whoami(token),
        preview: () => s.preview(),
      };
      if (!ops[op]) return json({ error: 'Unknown operation.' }, 400);
      return json(await ops[op]());
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong.' }, 500);
    }
  }
  async alarm() {
    // Charts delete themselves KEEP_DAYS after creation.
    await this.ctx.storage.deleteAll();
  }
}

// Fixed-window rate limits per hashed IP (kept in memory; a cold start resets them, which is acceptable)
// plus aggregate counters: charts created and people joined, per day. Counts only, no personal data.
const LIMITS = { create: [12, 3600], join: [60, 3600], write: [900, 3600], read: [2400, 3600] };
export class MetaDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.hits = new Map();
  }
  async fetch(request) {
    const { op, key, kind } = await request.json();
    if (op === 'limit') {
      const [max, win] = LIMITS[kind] || LIMITS.write;
      const slot = Math.floor(Date.now() / 1000 / win);
      const k = `${kind}:${key}:${slot}`;
      const n = (this.hits.get(k) || 0) + 1;
      this.hits.set(k, n);
      if (this.hits.size > 20000) for (const kk of this.hits.keys()) if (!kk.endsWith(`:${slot}`)) this.hits.delete(kk);
      return json({ ok: n <= max });
    }
    if (op === 'count') {
      const day = new Date().toISOString().slice(0, 10);
      for (const k of [`t:${kind}`, `d:${day}:${kind}`]) await this.ctx.storage.put(k, ((await this.ctx.storage.get(k)) || 0) + 1);
      return json({ ok: true });
    }
    if (op === 'stats') {
      const all = await this.ctx.storage.list();
      const out = { total: {}, days: {} };
      for (const [k, v] of all) {
        const p = k.split(':');
        if (p[0] === 't') out.total[p[1]] = v;
        else if (p[0] === 'd') (out.days[p[1]] ||= {})[p[2]] = v;
      }
      return json(out);
    }
    return json({ error: 'Unknown operation.' }, 400);
  }
}

export default { fetch: () => new Response('Not found', { status: 404 }) };
