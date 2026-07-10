'use strict';

// Fisher–Yates shuffle (returns a new array).
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Best-effort client IP for a Socket.IO connection. Every documented
// deployment path (Caddy, nginx, or an EKS ingress) sits a reverse proxy in
// front and sets X-Real-IP / X-Forwarded-For to the real peer address — so
// by default we trust those headers. If the app is ever exposed directly
// (no proxy in front), set TRUST_PROXY=false so a client can't spoof the
// header and dodge the login throttle.
function clientIp(socket, trustProxy = true) {
  const headers = (socket.handshake && socket.handshake.headers) || {};
  if (trustProxy) {
    const xri = headers['x-real-ip'];
    if (xri) return String(xri).split(',')[0].trim();
    const xff = headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return (socket.handshake && socket.handshake.address) || 'unknown';
}

module.exports = { shuffle, clientIp };
