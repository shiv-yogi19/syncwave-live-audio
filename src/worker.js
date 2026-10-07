// Signaling + room coordination only. No audio ever reaches this Worker.
const J = JSON.stringify, LOCK = 19000, MAX = 8;
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
const tx = (w, o) => { try { w.send(J(o)); } catch {} };
const hits = new Map(); // best-effort per-IP rate limit (code-guessing protection)
const limited = ip => { const n = Date.now(), a = (hits.get(ip) || []).filter(t => n - t < 60000); a.push(n); hits.set(ip, a); return a.length > 40; };
const json = (o, s = 200) => new Response(J(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const cleanSig = d => {
  if (!d || typeof d !== 'object') return null;
  if (d.s && ['offer', 'answer'].includes(d.s.type) && typeof d.s.sdp === 'string') return { s: { type: d.s.type, sdp: d.s.sdp } };
  if (d.c && typeof d.c.candidate === 'string') return { c: { candidate: d.c.candidate, sdpMid: typeof d.c.sdpMid === 'string' ? d.c.sdpMid : null, sdpMLineIndex: Number.isInteger(d.c.sdpMLineIndex) ? d.c.sdpMLineIndex : null } };
  return null;
};

export default {
  async fetch(req, env) {
    const u = new URL(req.url), ip = req.headers.get('cf-connecting-ip') || 'x';
    const stub = c => env.ROOMS.get(env.ROOMS.idFromName(c));
    if (u.pathname === '/api/room' && req.method === 'POST') {
      if (limited(ip)) return json({ error: 'rate' }, 429);
      for (let i = 0; i < 8; i++) {
        const code = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
        const r = await stub(code).fetch('https://room/init', { method: 'POST' });
        if (r.ok) return json({ code, ...(await r.json()) });
      }
      return json({ error: 'busy' }, 503);
    }
    const m = u.pathname.match(/^\/api\/room\/(\d{6})$/);
    if (m) return limited(ip) ? json({ error: 'rate' }, 429) : stub(m[1]).fetch('https://room/info');
    if (u.pathname === '/ws') {
      const c = u.searchParams.get('code') || '';
      if (!/^\d{6}$/.test(c) || req.headers.get('upgrade') !== 'websocket') return json({ error: 'bad' }, 400);
      return stub(c).fetch(req);
    }
    if (u.pathname === '/api/ice') { // STUN by default; optional free Cloudflare TURN if secrets are set
      let ice = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
      if (env.TURN_KEY_ID && env.TURN_KEY_TOKEN) try {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, { method: 'POST', headers: { authorization: 'Bearer ' + env.TURN_KEY_TOKEN, 'content-type': 'application/json' }, body: '{"ttl":86400}' });
        if (r.ok) ice = ice.concat((await r.json()).iceServers || []);
      } catch {}
      return json(ice);
    }
    return env.ASSETS.fetch(req);
  }
};

export class Room {
  constructor() { this.token = null; this.host = null; this.cl = new Map(); this.n = 0; this.st = null; this.lock = { pause: 0, skip: 0 }; this.guest = true; this.t = null; }
  arm(ms) { clearTimeout(this.t); this.t = setTimeout(() => this.end(), ms); }
  end() {
    clearTimeout(this.t);
    const all = [...this.cl.values()].map(c => c.ws); if (this.host) all.push(this.host);
    all.forEach(w => { tx(w, { t: 'ended' }); try { w.close(1000, 'ended'); } catch {} });
    this.token = null; this.host = null; this.cl.clear(); this.st = null;
  }
  bc(o) { this.cl.forEach(c => tx(c.ws, o)); }
  left(k) { const r = this.lock[k] - Date.now(); return r > 0 ? r : 0; }
  async fetch(req) {
    const url = new URL(req.url), p = url.pathname;
    if (p === '/init') { if (this.token) return new Response('', { status: 409 }); this.token = hex(); this.arm(120000); return json({ token: this.token }); }
    if (p === '/info') return this.token ? json({ n: this.cl.size, full: this.cl.size >= MAX, live: !!this.host }) : json({ error: 'not-found' }, 404);
    const [c, s] = Object.values(new WebSocketPair()); s.accept();
    const bad = (code, why) => { tx(s, { t: 'error', c: why }); s.close(code, why); return new Response(null, { status: 101, webSocket: c }); };
    if (!this.token) return bad(4404, 'not-found');
    const role = url.searchParams.get('role');
    let id = 'host';
    if (role === 'host') {
      if (url.searchParams.get('token') !== this.token) return bad(4403, 'forbidden');
      const old = this.host; this.host = s; clearTimeout(this.t);
      if (old) { tx(old, { t: 'error', c: 'replaced' }); try { old.close(4001); } catch {} }
      tx(s, { t: 'welcome', role: 'host', peers: [...this.cl].map(([i, x]) => ({ id: i, n: x.n })) });
      this.bc({ t: 'host-back' });
    } else if (role === 'client') {
      if (!this.host) return bad(4410, 'host-offline');
      if (this.cl.size >= MAX) return bad(4409, 'full');
      id = 'c' + (++this.n); const n = this.n; this.cl.set(id, { ws: s, n, rs: 0 });
      tx(s, { t: 'welcome', role: 'client', id, s: this.st, guest: this.guest, locks: { pause: this.left('pause'), skip: this.left('skip') } });
      tx(this.host, { t: 'join', id, n }); this.bc({ t: 'count', n: this.cl.size });
    } else return bad(4400, 'bad');

    let w0 = 0, k = 0;
    s.addEventListener('message', ev => {
      const now = Date.now(); if (now - w0 > 1000) { w0 = now; k = 0; } if (++k > 80) return;
      if (typeof ev.data !== 'string' || ev.data.length > 20000) return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      if (id === 'host' && this.host === s) {
        if (m.t === 'state') {
          this.st = { track: String(m.track || '').slice(0, 120), playing: !!m.playing, pos: +m.pos || 0, dur: +m.dur || 0, song: !!m.song, mic: !!m.mic, i: m.i | 0, n: m.n | 0 };
          this.guest = !!m.guest; this.bc({ t: 'state', s: this.st, guest: this.guest });
        } else if (m.t === 'act' && (m.a === 'pause' || m.a === 'skip')) {
          this.lock[m.a] = now + LOCK; this.bc({ t: 'lock', k: m.a, ms: LOCK });
        } else if (m.t === 'sig') {
          const d = cleanSig(m.d), c = this.cl.get(m.to); if (d && c) tx(c.ws, { t: 'sig', d });
        } else if (m.t === 'kick') {
          const c = this.cl.get(m.id); if (c) { tx(c.ws, { t: 'kicked' }); try { c.ws.close(4403); } catch {} }
        } else if (m.t === 'end') this.end();
      } else if (id !== 'host' && this.cl.has(id)) {
        const me = this.cl.get(id);
        if (m.t === 'sig') { const d = cleanSig(m.d); if (d && this.host) tx(this.host, { t: 'sig', from: id, d }); }
        else if (m.t === 'req' && ['play', 'pause', 'next', 'prev'].includes(m.a)) {
          const kk = m.a === 'next' ? 'skip' : m.a === 'prev' ? null : 'pause';
          if (!this.guest) return tx(s, { t: 'rejected', k: kk || 'pause', ms: 0 });
          if (kk && this.left(kk)) return tx(s, { t: 'rejected', k: kk, ms: this.left(kk) });
          if (this.host) tx(this.host, { t: 'req', from: id, a: m.a });
        } else if (m.t === 'resync' && now - me.rs > 3000) { me.rs = now; if (this.host) tx(this.host, { t: 'resync', from: id }); }
        else if (m.t === 'bye') s.close(1000);
      }
    });
    s.addEventListener('close', () => {
      if (id === 'host') { if (this.host !== s) return; this.host = null; this.bc({ t: 'host-left', grace: 20 }); this.arm(20000); }
      else if (this.cl.get(id)?.ws === s) { this.cl.delete(id); if (this.host) tx(this.host, { t: 'leave', id }); this.bc({ t: 'count', n: this.cl.size }); }
    });
    return new Response(null, { status: 101, webSocket: c });
  }
}
