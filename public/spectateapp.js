'use strict';
const socket = io();
const KEYS = ['A', 'B', 'C', 'D'];

let showing = false;
let myCode = '';
let lastPhase = null;

// A projector page may never be clicked, so sound starts OFF; the 🔇 button
// both enables it and unlocks the AudioContext (it's a user gesture).
quizSound.enabled = false;
quizSound.arm();
const soundBtn = document.getElementById('soundToggle');
soundBtn.onclick = () => {
  quizSound.enabled = !quizSound.enabled;
  soundBtn.textContent = quizSound.enabled ? '🔊' : '🔇';
};

// Prefill from ?room=1234 (the host's "Big screen" link) and auto-show.
const urlCode = new URLSearchParams(location.search).get('room');

fetch('/config')
  .then((r) => r.json())
  .then((c) => {
    if (c.requiresPassword) {
      document.getElementById('pwWrap').style.display = 'block';
    } else if (urlCode && /^\d{4}$/.test(urlCode)) {
      doJoin(urlCode); // no password needed — go straight to the display
    }
  })
  .catch(() => {});

if (urlCode && /^\d{4}$/.test(urlCode)) {
  document.getElementById('codeInput').value = urlCode;
}

function doJoin(code) {
  const c = code || document.getElementById('codeInput').value.trim();
  const password = document.getElementById('pwInput').value;
  if (!/^\d{4}$/.test(c)) {
    document.getElementById('joinError').textContent = 'Enter the 4-digit game code.';
    return;
  }
  myCode = c;
  socket.emit('spectator:join', { code: c, password });
}
document.getElementById('joinBtn').onclick = () => doJoin();
['codeInput', 'pwInput'].forEach((id) => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });
});

socket.on('connect', () => {
  // Rejoin silently after a reconnect (server restart, network blip).
  if (showing && myCode) {
    socket.emit('spectator:join', {
      code: myCode,
      password: document.getElementById('pwInput').value
    });
  }
});

socket.on('spectateError', ({ reason }) => {
  showing = false;
  document.getElementById('displayScreen').style.display = 'none';
  document.getElementById('joinScreen').style.display = 'block';
  document.getElementById('joinError').textContent = reason || 'Could not join.';
});

socket.on('spectating', ({ code }) => {
  showing = true;
  document.getElementById('roomCode').textContent = code;
  document.getElementById('joinScreen').style.display = 'none';
  document.getElementById('displayScreen').style.display = 'block';
});

socket.on('roomClosed', () => {
  showing = false;
  document.getElementById('displayScreen').style.display = 'none';
  document.getElementById('joinScreen').style.display = 'block';
  document.getElementById('joinError').textContent = 'The host closed this game.';
});

socket.on('state', (s) => {
  if (!showing) return;
  render(s);
});

function render(s) {
  if (s.phase !== lastPhase) {
    if (s.phase === 'reveal' && s.lastReveal) quizSound.reveal(null);
    else if (s.phase === 'gameover' && lastPhase !== null) quizSound.fanfare();
    lastPhase = s.phase;
  }

  document.getElementById('phaseBadge').textContent = s.phase;
  document.getElementById('nameA').textContent = s.teams.A.name;
  document.getElementById('nameB').textContent = s.teams.B.name;
  document.getElementById('ptsA').textContent = s.teams.A.score;
  document.getElementById('ptsB').textContent = s.teams.B.score;
  document.getElementById('dotA').className = 'dot' + (s.votes.A ? ' voted' : '');
  document.getElementById('dotB').className = 'dot' + (s.votes.B ? ' voted' : '');

  const lobbyPanel = document.getElementById('lobbyPanel');
  const qpanel = document.getElementById('qpanel');
  const recap = document.getElementById('recapPanel');
  const banner = document.getElementById('banner');

  updateCountdown(s.deadline, s.phase);

  if (s.phase === 'login' || s.phase === 'ready') {
    lobbyPanel.style.display = 'block';
    qpanel.style.display = 'none';
    recap.style.display = 'none';
    document.getElementById('lobbyTitle').textContent =
      s.phase === 'login' ? 'Waiting for the host to draw teams…' : 'Teams are set — starting soon';
    document.getElementById('lobbyList').innerHTML =
      'Players (' +
      s.players.length +
      '): ' +
      s.players.map((p) => '<b>' + escapeHtml(p.name) + '</b>').join(', ');
    return;
  }

  lobbyPanel.style.display = 'none';

  if (s.phase === 'gameover') {
    qpanel.style.display = 'none';
    renderRecap(s, recap, null);
    return;
  }
  recap.style.display = 'none';

  if (!s.current) {
    qpanel.style.display = 'none';
    return;
  }
  qpanel.style.display = 'block';
  document.getElementById('qtopic').textContent = s.current.topic;
  const tierEl = document.getElementById('qtier');
  tierEl.textContent = s.current.difficulty || '';
  tierEl.className = 'tier ' + (s.current.difficulty || '');
  document.getElementById('qtext').textContent = s.current.text;

  const wrap = document.getElementById('qoptions');
  wrap.innerHTML = '';
  const correct = typeof s.current.correct === 'number' ? s.current.correct : null;
  s.current.options.forEach((opt, i) => {
    const div = document.createElement('div');
    div.className = 'opt';
    if (correct !== null && i === correct) div.classList.add('correct');
    div.innerHTML = '<span class="key">' + KEYS[i] + '</span><span>' + escapeHtml(opt) + '</span>';
    wrap.appendChild(div);
  });

  banner.innerHTML = '';
  if (s.phase === 'reveal' && s.lastReveal) {
    const tv = s.teamVotes || {};
    banner.innerHTML =
      '<div class="banner info">' +
      teamLine(s.teams.A.name, tv.A, s.lastReveal.results.A) +
      teamLine(s.teams.B.name, tv.B, s.lastReveal.results.B) +
      '</div>';
    if (s.current.explanation) {
      banner.innerHTML +=
        '<div class="banner why"><b>Why:</b> ' + escapeHtml(s.current.explanation) + '</div>';
    }
  }
}

function teamLine(name, vote, ok) {
  const v = typeof vote === 'number' ? KEYS[vote] : '—';
  const flag = ok ? '<span class="flag ok">+1</span>' : '<span class="flag no">0</span>';
  return '<div>' + escapeHtml(name) + ': voted <b>' + v + '</b> ' + flag + '</div>';
}

let cdTimer = null,
  cdDeadline = null;
function updateCountdown(deadline, phase) {
  const el = document.getElementById('countdown');
  cdDeadline = phase === 'question' ? deadline : null;
  if (!cdDeadline) {
    el.style.display = 'none';
    if (cdTimer) {
      clearInterval(cdTimer);
      cdTimer = null;
    }
    return;
  }
  el.style.display = 'inline-block';
  const tick = () => {
    const left = Math.max(0, Math.ceil((cdDeadline - Date.now()) / 1000));
    el.textContent = '⏱ ' + left + 's';
    el.style.color = left <= 10 ? 'var(--red)' : '';
  };
  tick();
  if (!cdTimer) cdTimer = setInterval(tick, 1000);
}

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}
