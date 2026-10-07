'use strict';
/* ===== Central config (change the website name here) ===== */
const CFG = { NAME: 'SYNCWAVE', BY: 'Created By Shiv Yogi', MAX_CLIENTS: 8 };
const $ = id => document.getElementById(id);
const ST = { vstyle: 'bars', sens: 1.2, smooth: .8, glow: 10, duck: .3, duckSpd: .12, micGain: 1, theme: 'amoled', perf: 'balanced' };
try { Object.assign(ST, JSON.parse(localStorage.getItem('sw') || '{}')); } catch {}
const S = { role: null, code: null, token: null, ws: null, peers: new Map(), ice: [{ urls: 'stun:stun.cloudflare.com:3478' }], lock: {}, st: null, stAt: 0, queue: [], idx: -1, guest: true, done: false, tries: 0, q: [], n: 0, vol: 1, muted: false };
const A = {}, ERR = { 'not-found': 'Room not found', full: 'Room is full', 'host-offline': 'Host is offline', forbidden: 'Connection failed', replaced: 'Host opened in another tab' };
const tx = o => { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); };
let tT; const toast = (m, bad) => { const t = $('toast'); t.textContent = m; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(tT); tT = setTimeout(() => t.className = '', 3600); return false; };
const fmt = s => { s = Math.max(0, s | 0); return (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0'); };
const AC = window.AudioContext || window.webkitAudioContext;
const supported = () => !!(window.RTCPeerConnection && AC);
const modal = (id, on) => $(id).classList.toggle('open', on);
const age = o => o.seen && performance.now() - o.seen < 9000 ? o.rtt : null;

/* ===== Intro ===== */
$('i1').textContent = CFG.NAME; $('i2').textContent = CFG.BY; $('logo').textContent = CFG.NAME; $('by').textContent = CFG.BY; $('about').textContent = CFG.NAME + ' · ' + CFG.BY; document.title = CFG.NAME;
document.querySelectorAll('.rv').forEach((e, i) => e.style.setProperty('--i', i));
setTimeout(() => $('intro').classList.add('s2'), 1700);
setTimeout(() => { $('intro').classList.add('out'); $('app').hidden = false; document.body.classList.add('go'); }, 3400);
setTimeout(() => $('intro').remove(), 4300);

/* ===== Settings ===== */
const SET = [['theme', 'Appearance', ['amoled', 'dark', 'glass', 'minimal']], ['perf', 'Performance', ['high', 'balanced', 'saver']], ['sens', 'Visualizer Sensitivity', .3, 3, .1], ['smooth', 'Smoothing', 0, .95, .05], ['glow', 'Glow', 0, 30, 1], ['micGain', 'Mic Gain', 0, 3, .1], ['duck', 'Ducking: song level while talking', .05, 1, .05], ['duckSpd', 'Ducking speed (seconds)', .03, .6, .01]];
function apply() { document.body.dataset.theme = ST.theme; document.body.dataset.perf = ST.perf; $('vstyle').value = ST.vstyle; if (A.an) A.an.smoothingTimeConstant = ST.smooth; if (A.micG) A.micG.gain.value = ST.micGain; size(); }
SET.forEach(([k, l, a, b, st]) => {
  const d = document.createElement('div'); d.className = 'set'; const lb = document.createElement('label'); lb.textContent = l; let i;
  if (Array.isArray(a)) { i = document.createElement('select'); a.forEach(v => i.add(new Option(v, v))); } else { i = document.createElement('input'); i.type = 'range'; i.min = a; i.max = b; i.step = st; }
  i.value = ST[k]; i.oninput = () => { ST[k] = Array.isArray(a) ? i.value : +i.value; try { localStorage.setItem('sw', JSON.stringify(ST)); } catch {} apply(); };
  d.append(lb, i); $('setBody').append(d);
});
$('vstyle').onchange = e => { ST.vstyle = e.target.value; try { localStorage.setItem('sw', JSON.stringify(ST)); } catch {} };
$('bSet').onclick = () => modal('mSet', true);
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.remove('open'));
$('bConn').onclick = () => { modal('mConn', true); setTimeout(() => $('codeIn').focus(), 300); };
/* Room-code input: digits only, max 6, auto-join at 6 digits (uses the existing join()) */
const codeIn = $('codeIn'); let joining = false;
async function tryJoin() { if (joining) return; joining = true; try { await join(codeIn.value.trim()); } finally { joining = false; } }
codeIn.addEventListener('input', e => {
  if (e.isComposing) return;
  const v = codeIn.value.replace(/\D/g, '').slice(0, 6); if (v !== codeIn.value) codeIn.value = v;
  if (v.length === 6) $('goConn').click();
});
codeIn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); $('goConn').click(); } });
$('goConn').onclick = tryJoin;

/* ===== Audio engine (host) ===== */
const mkAn = C => { const a = C.createAnalyser(); a.fftSize = 1024; a.smoothingTimeConstant = ST.smooth; A.f = new Uint8Array(512); A.w = new Uint8Array(1024); return a; };
async function initAudio() {
  if (A.ctx) return A.ctx.resume();
  const C = A.ctx = new AC({ latencyHint: 'interactive' });
  A.songG = C.createGain(); A.mon = C.createGain(); A.bus = C.createGain(); A.lim = C.createDynamicsCompressor(); A.dest = C.createMediaStreamDestination(); A.an = mkAn(C);
  A.lim.threshold.value = -6; A.lim.ratio.value = 12; A.lim.attack.value = .003; A.lim.release.value = .2;
  A.el = new Audio(); A.el.preload = 'auto';
  C.createMediaElementSource(A.el).connect(A.songG);
  A.songG.connect(A.bus); A.songG.connect(A.mon); A.mon.connect(C.destination);   // mon = host-only local monitor (mic is never monitored)
  A.bus.connect(A.lim); A.lim.connect(A.an); A.an.connect(A.dest);                 // → MediaStream → WebRTC
  ['play', 'pause', 'seeked', 'loadedmetadata'].forEach(e => A.el.addEventListener(e, push));
  A.el.addEventListener('timeupdate', ui);
  A.el.addEventListener('ended', () => go(1));
  A.el.addEventListener('error', () => { toast('File format unsupported', 1); if (S.idx < S.queue.length - 1) go(1); });
  setInterval(duckTick, 60); setInterval(() => S.role === 'host' && A.el && !A.el.paused && push(), 2500);
  applyVol();
}
function duckTick() {
  if (!A.mic) return; A.micAn.getByteTimeDomainData(A.mw);
  let s = 0; for (const v of A.mw) { const x = (v - 128) / 128; s += x * x; }
  const now = performance.now(); if (Math.sqrt(s / A.mw.length) > .02) A.vt = now;
  const on = now - (A.vt || 0) < 500; A.duck = on;
  A.songG.gain.setTargetAtTime(on ? ST.duck : 1, A.ctx.currentTime, on ? ST.duckSpd : ST.duckSpd * 4);
}
async function micOn() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('Unsupported browser', 1);
  if (!(await startHost())) return;
  try { A.ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { return toast(e.name === 'NotAllowedError' ? 'Microphone permission denied' : 'Microphone unavailable', 1); }
  const C = A.ctx; A.msrc = C.createMediaStreamSource(A.ms); A.micG = C.createGain(); A.micG.gain.value = ST.micGain;
  A.micAn = C.createAnalyser(); A.micAn.fftSize = 512; A.mw = new Uint8Array(512);
  A.msrc.connect(A.micG); A.micG.connect(A.micAn); A.micG.connect(A.bus);
  A.mic = true; $('bMic').textContent = 'Stop Mic'; push();
}
function micOff() {
  if (!A.mic) return; A.mic = false; A.duck = false; A.ms.getTracks().forEach(t => t.stop()); A.msrc.disconnect(); A.micG.disconnect();
  A.songG.gain.setTargetAtTime(1, A.ctx.currentTime, .15); $('bMic').textContent = 'Start Mic'; push();
}
$('bMic').onclick = () => A.mic ? micOff() : micOn();

/* ===== Playlist / host player ===== */
function load(i, play) { S.idx = i; A.el.src = S.queue[i].url; if (play) A.el.play().catch(() => toast('Audio playback blocked', 1)); push(); }
function go(d) { const n = S.idx + d; if (n < 0) { A.el.currentTime = 0; return; } if (n >= S.queue.length) { A.el.pause(); A.el.currentTime = 0; return; } load(n, true); }
const hPlay = () => { if (S.idx < 0) return $('bSong').click(); if (A.el.paused) A.el.play().catch(() => toast('Audio playback blocked', 1)); else { A.el.pause(); tx({ t: 'act', a: 'pause' }); } };
const hNext = () => { if (S.idx < 0) return; tx({ t: 'act', a: 'skip' }); go(1); };
const hPrev = () => A.el.currentTime > 3 ? (A.el.currentTime = 0) : go(-1);
function runReq(a) { if (a === 'play') A.el.play().catch(() => {}); else if (a === 'pause') A.el.pause(); else if (a === 'next') go(1); else if (a === 'prev') hPrev(); }
$('bSong').onclick = () => $('file').click();
$('file').onchange = async e => {
  const fs = [...e.target.files].filter(f => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|opus|flac|webm)$/i.test(f.name)); e.target.value = '';
  if (!fs.length) return toast('File format unsupported', 1);
  if (!(await startHost())) return;
  const first = S.queue.length; fs.forEach(f => S.queue.push({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) }));
  if (S.idx < 0 || A.el.paused) load(first, true); else push();   // local files only: never uploaded
};
$('seek').onchange = () => S.role === 'host' && A.el && (A.el.currentTime = +$('seek').value);

/* ===== Room: host ===== */
async function startHost() {
  if (S.role === 'client') return toast('Leave the current room first', 1);
  if (!supported()) return toast('WebRTC unavailable', 1);
  await initAudio(); if (S.role === 'host') return true;
  try {
    try { S.ice = await (await fetch('/api/ice')).json(); } catch {}
    const r = await fetch('/api/room', { method: 'POST' }); if (!r.ok) throw 0;
    const j = await r.json(); S.code = j.code; S.token = j.token; S.role = 'host'; await open('host');
  } catch { S.role = null; return toast('Connection failed', 1); }
  try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch {}
  showRoom(); return true;
}
function push() {
  if (S.role !== 'host' || !A.el) return; const e = A.el;
  tx({ t: 'state', track: (S.queue[S.idx] || {}).name || '', playing: !e.paused && !e.ended, pos: e.currentTime, dur: isFinite(e.duration) ? e.duration : 0, song: S.idx >= 0, mic: !!A.mic, i: S.idx, n: S.queue.length, guest: S.guest });
  ui();
}
const opus = sdp => { const m = sdp.match(/a=rtpmap:(\d+) opus\/48000/); return m ? sdp.replace(new RegExp(`a=fmtp:${m[1]} (.*)`), (_, p) => `a=fmtp:${m[1]} ${p};stereo=1;sprop-stereo=1;maxaveragebitrate=128000;usedtx=0`) : sdp; };
const dcMsg = (o, dc) => e => { const m = e.data; if (m[0] === 'p') { try { dc.send('o' + m.slice(1)); } catch {} } else if (m[0] === 'o') { o.rtt = Math.round(performance.now() - parseFloat(m.slice(1))); o.seen = performance.now(); } };
async function addPeer(id, n) {
  closePeer(id);
  const pc = new RTCPeerConnection({ iceServers: S.ice }), P = { pc, n, rtt: null, seen: 0, st: 'new', q: [] }; S.peers.set(id, P);
  const tr = A.dest.stream.getAudioTracks()[0]; tr.contentHint = 'music'; const sd = pc.addTrack(tr, A.dest.stream);
  P.dc = pc.createDataChannel('m', { ordered: false, maxRetransmits: 0 }); P.dc.onmessage = dcMsg(P, P.dc);
  pc.onicecandidate = e => e.candidate && tx({ t: 'sig', to: id, d: { c: e.candidate } });
  pc.onconnectionstatechange = () => { P.st = pc.connectionState; drawPeers(); };
  P.iv = setInterval(() => { if (P.dc.readyState === 'open') P.dc.send('p' + performance.now()); drawPeers(); }, 2000);
  try {
    const o = await pc.createOffer(); o.sdp = opus(o.sdp); await pc.setLocalDescription(o); tx({ t: 'sig', to: id, d: { s: { type: 'offer', sdp: o.sdp } } });
    const p = sd.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}]; p.encodings[0].maxBitrate = S.peers.size > 4 ? 64000 : 128000; sd.setParameters(p).catch(() => {});
  } catch (e) { console.warn(e); }
  drawPeers();
}
function closePeer(id) { const p = S.peers.get(id); if (p) { clearInterval(p.iv); try { p.pc.close(); } catch {} S.peers.delete(id); drawPeers(); } }
async function hSig(id, d) {
  const p = S.peers.get(id); if (!p) return;
  try { if (d.s) { await p.pc.setRemoteDescription(d.s); for (const c of p.q.splice(0)) await p.pc.addIceCandidate(c); } else if (d.c) { if (p.pc.remoteDescription) await p.pc.addIceCandidate(d.c); else p.q.push(d.c); } } catch (e) { console.warn(e); }
}
function qual(rtt, loss, st) {
  if (st === 'failed' || st === 'closed') return { i: '🔴', t: 'Poor' };
  if (rtt == null) return { i: '⚪', t: st === 'connected' ? 'Measuring…' : 'Connecting…' };
  if (rtt > 220 || loss > 5) return { i: '🔴', t: 'Poor' }; if (rtt > 120 || loss > 2) return { i: '🟠', t: 'Weak' }; if (rtt > 60) return { i: '🟡', t: 'Good' }; return { i: '🟢', t: 'Excellent' };
}
function drawPeers() {
  if (S.role !== 'host') return; $('cnt').textContent = S.peers.size;
  $('peers').innerHTML = [...S.peers].map(([id, p]) => { const r = age(p), q = qual(r, 0, p.st); return `<div class="peer"><b>Device ${p.n}</b><span>${q.i} ${q.t}${r != null ? ' · Latency ' + r + ' ms (RTT)' : ''}</span><button data-k="${id}" aria-label="Remove">✕</button></div>`; }).join('') || '<p class="mut">Waiting for devices…</p>';
  ui();
}
$('peers').onclick = e => { const k = e.target.dataset.k; if (k) { tx({ t: 'kick', id: k }); closePeer(k); } };
$('gAllow').onchange = e => { S.guest = e.target.checked; push(); };

/* ===== Room: client ===== */
async function join(code) {
  if (!/^\d{6}$/.test(code)) return toast('Invalid room code', 1);
  if (!supported()) return toast('WebRTC unavailable', 1); if (S.role) return toast('Already in a room', 1);
  let r; try { r = await fetch('/api/room/' + code); } catch { return toast('Network disconnected', 1); }
  if (r.status === 404) return toast('Room not found', 1); if (!r.ok) return toast(r.status === 429 ? 'Too many attempts — wait a minute' : 'Connection failed', 1);
  const i = await r.json(); if (i.full) return toast('Room is full', 1); if (!i.live) return toast('Host is offline', 1);
  A.ctx = new AC(); A.an = mkAn(A.ctx); A.ctx.resume(); A.out = new Audio(); A.out.autoplay = true;
  try { S.ice = await (await fetch('/api/ice')).json(); } catch {}
  S.code = code; S.role = 'client';
  try { await open('client'); } catch { S.role = null; return toast('Connection failed', 1); }
  modal('mConn', false); showRoom(); try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch {}
}
async function onOffer(sdp) {
  if (S.pc) try { S.pc.close(); } catch {} S.q = []; S.pl = S.pr = 0; S.rtt = null;
  const pc = S.pc = new RTCPeerConnection({ iceServers: S.ice });
  pc.ontrack = e => {
    const st = e.streams[0] || new MediaStream([e.track]); e.receiver.playoutDelayHint = 0; try { e.receiver.jitterBufferTarget = 0; } catch {}
    A.out.srcObject = st; applyVol(); A.out.play().catch(() => $('tap').hidden = false);
    if (A.src) A.src.disconnect(); A.src = A.ctx.createMediaStreamSource(st); A.src.connect(A.an);
  };
  pc.ondatachannel = e => { S.dc = e.channel; e.channel.onmessage = dcMsg(S, e.channel); };
  pc.onicecandidate = e => e.candidate && tx({ t: 'sig', d: { c: e.candidate } });
  pc.onconnectionstatechange = () => {
    S.cs = pc.connectionState; ui(); clearTimeout(S.rt);
    if (S.cs === 'failed' || S.cs === 'disconnected') S.rt = setTimeout(() => { if (S.pc === pc && pc.connectionState !== 'connected') tx({ t: 'resync' }); }, S.cs === 'failed' ? 500 : 4000);
  };
  await pc.setRemoteDescription({ type: 'offer', sdp }); for (const c of S.q.splice(0)) await pc.addIceCandidate(c).catch(() => {});
  const a = await pc.createAnswer(); a.sdp = opus(a.sdp); await pc.setLocalDescription(a); tx({ t: 'sig', d: { s: { type: 'answer', sdp: a.sdp } } });
}
function cSig(d) { if (d.s && d.s.type === 'offer') onOffer(d.s.sdp).catch(e => console.warn(e)); else if (d.c) { if (S.pc && S.pc.remoteDescription) S.pc.addIceCandidate(d.c).catch(() => {}); else S.q.push(d.c); } }
setInterval(async () => {
  if (S.role !== 'client' || !S.pc) return; if (S.dc && S.dc.readyState === 'open') S.dc.send('p' + performance.now());
  try { (await S.pc.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'audio') { const dl = Math.max(0, x.packetsLost - (S.pl || 0)), dr = x.packetsReceived - (S.pr || 0); S.pl = x.packetsLost; S.pr = x.packetsReceived; S.loss = dl + dr > 0 ? 100 * dl / (dl + dr) : 0; } }); } catch {} ui();
}, 2000);
$('tap').onclick = () => { A.ctx.resume(); A.out.play().then(() => $('tap').hidden = true).catch(() => toast('Audio playback blocked', 1)); };
function reqA(a) { const k = a === 'next' ? 'skip' : a === 'prev' ? null : 'pause'; if (k && S.lock[k] > performance.now()) return toast('Locked by host', 1); tx({ t: 'req', a }); }

/* ===== Signaling ===== */
function open(role) {
  return new Promise((res, rej) => {
    const w = S.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?code=${S.code}&role=${role}` + (role === 'host' ? '&token=' + S.token : '')); let ok = false;
    w.onopen = () => { ok = true; S.tries = 0; res(); };
    w.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch (x) { console.error(x); } };
    w.onclose = () => { if (!ok) rej(); else onClose(w); };
  });
}
function onClose(w) {
  if (w !== S.ws || S.done) return;
  if (S.tries++ >= 6) { S.done = true; return overlay('CONNECTION FAILED', 'Could not reach the server.', true); }
  toast('Network disconnected — reconnecting…', 1); setTimeout(() => open(S.role).catch(() => onClose(S.ws)), 2000);
}
function onMsg(m) {
  const H = S.role === 'host';
  switch (m.t) {
    case 'welcome': if (H) { m.peers.forEach(p => addPeer(p.id, p.n)); push(); } else { S.guest = m.guest; setSt(m.s); lockSet(m.locks); } break;
    case 'join': H && S.peers.size < CFG.MAX_CLIENTS && addPeer(m.id, m.n); break;
    case 'leave': H && closePeer(m.id); break;
    case 'sig': H ? hSig(m.from, m.d) : cSig(m.d); break;
    case 'req': H && S.guest && S.idx >= 0 && runReq(m.a); break;
    case 'resync': H && S.peers.has(m.from) && addPeer(m.from, S.peers.get(m.from).n); break;
    case 'state': S.guest = m.guest; setSt(m.s); break;
    case 'count': S.n = m.n; ui(); break;
    case 'lock': S.lock[m.k] = performance.now() + m.ms; lockUI(); break;
    case 'rejected': if (m.ms) S.lock[m.k] = performance.now() + m.ms; toast(m.ms ? 'Locked by host' : 'Host disabled guest controls', 1); lockUI(); break;
    case 'host-left': overlay('HOST DISCONNECTED', `Connection to host lost. Waiting ${m.grace} s for it to return…`); break;
    case 'host-back': modal('ov', false); break;
    case 'ended': S.done = true; overlay('HOST DISCONNECTED', 'Live session has ended.', true); break;
    case 'kicked': S.done = true; overlay('REMOVED', 'The host removed this device.', true); break;
    case 'error': S.done = true; toast(ERR[m.c] || 'Connection failed', 1); setTimeout(() => location.reload(), 2200); break;
  }
}
function overlay(t, s, final) { $('ovT').textContent = t; $('ovS').textContent = s; $('ovB').hidden = !final; modal('ov', true); }
$('ovB').onclick = () => location.reload();
$('leave').onclick = () => { S.done = true; tx({ t: S.role === 'host' ? 'end' : 'bye' }); setTimeout(() => location.reload(), 120); };
addEventListener('pagehide', () => { if (S.role === 'host') tx({ t: 'end' }); });

/* ===== UI state ===== */
function setSt(s) { S.st = s; S.stAt = performance.now(); ui(); }
function lockSet(l) { ['pause', 'skip'].forEach(k => l && l[k] > 0 && (S.lock[k] = performance.now() + l[k])); lockUI(); }
function lockUI() {
  const now = performance.now(), cfg = { pause: ['lockP', 'play', 'PAUSE LOCKED', 'HOST PAUSED THE SONG'], skip: ['lockS', 'next', 'SKIP LOCKED', 'HOST SKIPPED THE SONG'] };
  for (const k in cfg) { const [b, btn, h, s] = cfg[k], left = Math.ceil(((S.lock[k] || 0) - now) / 1000), on = S.role === 'client' && left > 0; $(b).hidden = !on; $(btn).classList.toggle('locked', on); if (on) $(b).innerHTML = `<b>🔴 ${h}</b><div>${s}</div><div class="mut">Available again in ${left} second${left > 1 ? 's' : ''}</div>`; }
}
function ui() {
  if (!S.role) return;
  if (S.role === 'host' && A.el) {
    const e = A.el, d = isFinite(e.duration) ? e.duration : 0;
    $('title').textContent = (S.queue[S.idx] || {}).name || (A.mic ? '🎙️ Microphone only' : 'Choose a song to start'); $('seek').max = d || 1; if (!$('seek').matches(':active')) $('seek').value = e.currentTime;
    $('time').textContent = fmt(e.currentTime) + ' / ' + fmt(d); $('play').textContent = e.paused ? '▶' : '⏸';
    $('hstat').textContent = (A.mic ? '🔴 LIVE MICROPHONE · MIC ACTIVE' : '🟢 LIVE') + ' · Connected: ' + S.peers.size + (A.duck ? ' · 🎚 ducking' : '');
    $('badge').textContent = 'HOST';
  } else if (S.role === 'client') {
    const s = S.st || {}, dur = s.dur || 0; let pos = (s.pos || 0) + (s.playing ? (performance.now() - S.stAt) / 1000 : 0); if (dur) pos = Math.min(pos, dur);
    $('title').textContent = s.track || (s.mic ? '🎙️ Live Microphone' : 'Waiting for host…'); $('seek').max = dur || 1; $('seek').value = pos; $('time').textContent = fmt(pos) + ' / ' + fmt(dur); $('play').textContent = s.playing ? '⏸' : '▶';
    const r = age(S), q = qual(r, S.loss || 0, S.cs); $('cq').textContent = `${q.i} ${q.t}${r != null ? ' · ' + r + ' ms' : ''}`;
    $('badge').textContent = S.cs === 'connected' ? '🟢 Connected' : 'Connecting…';
  }
}
setInterval(() => { if (S.role) { if (S.role === 'client') ui(); lockUI(); } }, 250);
function showRoom() {
  document.body.dataset.role = S.role; $('live').hidden = false; $('cards').hidden = S.role === 'client'; $('seek').disabled = S.role !== 'host';
  if (S.role === 'host') $('code').innerHTML = [...S.code].map((d, i) => `<i style="--i:${i}">${d}</i>`).join('');
  drawPeers(); ui();
}
function applyVol() { const v = S.muted ? 0 : S.vol; if (A.mon) A.mon.gain.value = v; if (A.out) A.out.volume = v; $('mute').textContent = S.muted ? '🔇' : '🔊'; }
$('vol').oninput = e => { S.vol = +e.target.value; S.muted = false; applyVol(); };
$('mute').onclick = () => { S.muted = !S.muted; applyVol(); };
$('play').onclick = () => S.role === 'host' ? hPlay() : reqA(S.st && S.st.playing ? 'pause' : 'play');
$('next').onclick = () => S.role === 'host' ? hNext() : reqA('next');
$('prev').onclick = () => S.role === 'host' ? hPrev() : reqA('prev');

/* ===== Visualizer (canvas, FPS-capped by performance mode) ===== */
const cv = $('cv'), g = cv.getContext('2d'); let W = 0, H = 0, D = 1, last = 0, ptc = [];
function size() { D = Math.min(devicePixelRatio || 1, ST.perf === 'saver' ? 1 : 2); W = cv.width = cv.clientWidth * D; H = cv.height = cv.clientHeight * D; }
new ResizeObserver(size).observe(cv);
const avg = (f, a, b) => { let s = 0; for (let i = a; i < b; i++) s += f[i]; return s / (b - a) / 255; };
const V = {
  wave(f, w) { g.beginPath(); const n = w.length; for (let i = 0; i < n; i += 2) { const x = i / n * W, y = H / 2 + (w[i] - 128) / 128 * H * .45 * ST.sens; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.lineWidth = 3 * D; g.stroke(); },
  bars(f) { const n = 48, bw = W / n; for (let i = 0; i < n; i++) { const v = f[1 + Math.floor(Math.pow(i / n, 1.6) * 220)] / 255, h = Math.min(1, v * ST.sens) * H * .92; g.fillRect(i * bw + 2 * D, H - h, bw - 4 * D, h); } },
  mirror(f) { const n = 32, bw = W / 2 / n; for (let i = 0; i < n; i++) { const v = f[1 + Math.floor(Math.pow(i / n, 1.5) * 200)] / 255, h = Math.min(1, v * ST.sens) * H * .9; g.fillRect(W / 2 + i * bw + D, (H - h) / 2, bw - 2 * D, h); g.fillRect(W / 2 - (i + 1) * bw + D, (H - h) / 2, bw - 2 * D, h); } },
  circle(f, w, t) { const cx = W / 2, cy = H / 2, r = Math.min(W, H) * .2, n = 72; g.lineWidth = 3 * D; g.beginPath(); for (let i = 0; i < n; i++) { const a = i / n * 6.283 + t / 4000, k = i < n / 2 ? i : n - i, v = Math.min(1, f[1 + k * 4] / 255 * ST.sens), R = r + v * Math.min(W, H) * .26; g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); } g.stroke(); },
  rings(f) { const cx = W / 2, cy = H / 2, m = Math.min(W, H) / 2, bands = [[1, 6], [6, 20], [20, 60], [60, 140], [140, 300]]; bands.forEach(([a, b], i) => { const e = Math.min(1, avg(f, a, b) * ST.sens); g.lineWidth = (2 + e * 10) * D; g.globalAlpha = .35 + e * .65; g.beginPath(); g.arc(cx, cy, m * (i + 1) / 5.6 * (.9 + e * .2), 0, 6.283); g.stroke(); }); g.globalAlpha = 1; },
  particles(f) { const bass = Math.min(1, avg(f, 1, 8) * ST.sens), max = ST.perf === 'saver' ? 30 : ST.perf === 'high' ? 140 : 70; for (let k = 0; k < bass * 5 && ptc.length < max; k++) { const a = Math.random() * 6.283, s = (1 + Math.random() * 3 + bass * 4) * D; ptc.push({ x: W / 2, y: H / 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s, l: 1 }); } for (let i = ptc.length - 1; i >= 0; i--) { const p = ptc[i]; p.x += p.vx; p.y += p.vy; p.l -= .016; if (p.l <= 0) { ptc.splice(i, 1); continue; } g.globalAlpha = p.l; g.beginPath(); g.arc(p.x, p.y, (2 + bass * 4) * D, 0, 6.283); g.fill(); } g.globalAlpha = 1; }
};
function frame(now) {
  requestAnimationFrame(frame); const iv = ST.perf === 'saver' ? 50 : ST.perf === 'balanced' ? 25 : 0;
  if (now - last < iv || document.hidden || !W) return; last = now;
  g.clearRect(0, 0, W, H); const live = A.an && S.role && (S.role === 'host' || S.cs === 'connected');
  if (live) { A.an.getByteFrequencyData(A.f); A.an.getByteTimeDomainData(A.w); } else { A.f && A.f.fill(0); A.w && A.w.fill(128); }
  const col = `hsl(${(now / 40) % 360},90%,62%)`; g.strokeStyle = g.fillStyle = g.shadowColor = col; g.shadowBlur = ST.perf === 'saver' ? 0 : ST.glow;
  if (A.f) V[ST.vstyle](A.f, A.w, now);
}
$('fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : cv.requestFullscreen && cv.requestFullscreen();
A.f = new Uint8Array(512); A.w = new Uint8Array(1024).fill(128);
apply(); requestAnimationFrame(frame);
if (!supported()) toast('WebRTC unavailable in this browser', 1);
