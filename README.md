# SYNCWAVE — Live Audio (Song + Mic + Visualizer)

Real WebRTC audio from a **Host** phone to up to 8 connected devices.
Songs are chosen locally and **never uploaded**; the Worker only relays signaling/state (no audio, no storage).

```
Local song / Mic → Web Audio (gain, ducking, limiter, analyser) → MediaStreamDestination → WebRTC mesh → clients
```

## Deploy (GitHub + Cloudflare only)
```bash
npm install
npx wrangler login
npx wrangler deploy
```
Open the `*.workers.dev` URL (HTTPS is required for the microphone). For GitHub auto-deploy: Cloudflare dashboard → Workers → Create → Import a repository.
Local test: `npm run dev` (use two devices on the same Wi-Fi via the printed URL, or a tunnel — mic needs HTTPS/localhost).

## Optional but recommended: TURN for mobile data
STUN alone fails on some carrier NATs. In Cloudflare → Realtime → TURN, create a key, then:
```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_TOKEN
```
The Worker then serves TURN credentials via `/api/ice`. Without them, STUN only.

## Rename / brand
Edit `CFG` at the top of `public/app.js` (`NAME`, `BY`, `MAX_CLIENTS`).

## How it works
- `POST /api/room` → Durable Object `Room` creates a random 6-digit code + secret host token (kept in memory only).
- Host WebSocket needs the token; clients can only send `sig` / `req` / `resync`. Host-only commands (state, locks, kick, end) are validated on the Worker.
- Pause/Skip by host → Worker sets a **19 s lock** for clients only (host is never locked). Clients' Play/Pause/Skip are requests to the host, rejected by the Worker while locked.
- Latency = real RTT measured over a WebRTC data channel (both sides); quality also uses real packet loss. No distance is shown.
- Ducking: mic RMS detector → `GainNode.setTargetAtTime` on the song bus (smooth attack/release).

## Test checklist (two phones)
1. Phone A: Choose Song → code appears. Phone B: Connect → enter code → 🟢 Connected, audio plays.
2. A: Start Mic → B hears voice, visualizer reacts. Talk while song plays → song dips, then recovers.
3. A: Pause / Skip → B shows 🔴 locked with 19→1 countdown; A's buttons stay active.
4. B leaves → disappears from A's list. A leaves → B sees HOST DISCONNECTED. Toggle airplane mode on B → auto-resync.

## Notes
- Use headphones on the host when song + mic are both on (otherwise the mic re-captures the speaker).
- Keep the host tab open/screen on (Wake Lock is requested). Mesh = host uploads one stream per client (≤128 kbps each).
