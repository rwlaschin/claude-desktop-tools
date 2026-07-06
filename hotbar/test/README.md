# hotbar tests

DOM-level checks using jsdom (no browser needed).

```bash
npm init -y && npm install jsdom
for f in test/*.mjs; do node "$f"; done
```

Covers: attention list + durations, run/wait timing from transitions, waiting
pings, click-to-open routing, drag + position persistence, badge color,
spy-mode ring buffer + export, and the transcript-backed hover preview.
