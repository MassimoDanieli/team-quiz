'use strict';
const socket = io();
const KEYS = ['A', 'B', 'C', 'D'];

// persistent identity so a refresh rejoins the same team
function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
let playerId = localStorage.getItem('quizPlayerId');
if (!playerId) {
  playerId = uuid();
  localStorage.setItem('quizPlayerId', playerId);
}
let myName = localStorage.getItem('quizPlayerName') || '';
let myCode = localStorage.getItem('quizRoomCode') || '';
// a room code in the URL (?room=1234) wins and prefills the field
const urlCode = new URLSearchParams(location.search).get('room');
if (urlCode && /^\d{4}$/.test(urlCode)) myCode = urlCode;

let joined = false;
let myVote = null;
let currentQNum = -1;

// password field visibility
fetch('/config')
  .then((r) => r.json())
  .then((c) => {
    if (c.requiresPassword) document.getElementById('pwWrap').style.display = 'block';
  })
  .catch(() => {});

document.getElementById('nameInput').value = myName;
document.getElementById('codeInput').value = myCode;

function doJoin() {
  const name = document.getElementById('nameInput').value.trim();
  const password = document.getElementById('pwInput').value;
  const code = document.getElementById('codeInput').value.trim();
  if (!/^\d{4}$/.test(code)) {
    showLoginError('Enter the 4-digit game code from your host.');
    return;
  }
  if (!name) {
    showLoginError('Please enter a name.');
    return;
  }
  myName = name;
  myCode = code;
  localStorage.setItem('quizPlayerName', name);
  localStorage.setItem('quizRoomCode', code);
  socket.emit('player:join', { playerId, name, password, code });
}
function showLoginError(msg) {
  document.getElementById('loginError').textContent = msg;
}

document.getElementById('joinBtn').onclick = doJoin;
document.getElementById('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doJoin();
});
document.getElementById('pwInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doJoin();
});
document.getElementById('codeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doJoin();
});

socket.on('connect', () => {
  // auto-rejoin only if no password is required and we already have a name
  fetch('/config')
    .then((r) => r.json())
    .then((c) => {
      if (myName && myCode && !c.requiresPassword) {
        socket.emit('player:join', { playerId, name: myName, code: myCode });
      }
    })
    .catch(() => {});
});

socket.on('joinError', ({ reason, badCode }) => {
  joined = false;
  if (badCode) localStorage.removeItem('quizRoomCode');
  showLoginError(reason || 'Could not join.');
});

socket.on('roomClosed', () => {
  joined = false;
  localStorage.removeItem('quizRoomCode');
  document.getElementById('gameScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'block';
  showLoginError('The host closed this game.');
});

socket.on('joined', () => {
  joined = true;
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display = 'block';
});

socket.on('state', (s) => {
  if (!joined) return;
  render(s);
});

function myTeam(s) {
  const me = s.players.find((p) => p.id === playerId);
  return me ? me.team : null;
}

function render(s) {
  document.getElementById('phaseBadge').textContent = s.phase;
  document.getElementById('nameA').textContent = s.teams.A.name;
  document.getElementById('nameB').textContent = s.teams.B.name;
  document.getElementById('ptsA').textContent = s.teams.A.score;
  document.getElementById('ptsB').textContent = s.teams.B.score;

  if (s.questionNumber !== currentQNum) {
    currentQNum = s.questionNumber;
    myVote = null;
  }

  const team = myTeam(s);
  const heading = document.getElementById('teamHeading');
  if (team === 'A') heading.textContent = 'You: ' + s.teams.A.name;
  else if (team === 'B') heading.textContent = 'You: ' + s.teams.B.name;
  else heading.textContent = 'Lobby';

  const lobbyPanel = document.getElementById('lobbyPanel');
  const howtoPanel = document.getElementById('howtoPanel');
  const qpanel = document.getElementById('qpanel');
  const banner = document.getElementById('banner');

  // Show the rules while waiting; hide once questions start.
  howtoPanel.style.display = s.phase === 'login' || s.phase === 'ready' ? 'block' : 'none';

  if (s.phase === 'login') {
    lobbyPanel.style.display = 'block';
    qpanel.style.display = 'none';
    const stack = (s.stacks || []).find((st) => st.id === s.stackId);
    document.getElementById('lobbyTitle').textContent = 'Waiting for the host to draw teams…';
    document.getElementById('lobbyList').innerHTML =
      (stack ? 'Set: <b>' + escapeHtml(stack.name) + '</b><br>' : '') +
      'Players in lobby (' +
      s.players.length +
      '): ' +
      s.players.map((p) => '<b>' + escapeHtml(p.name) + '</b>').join(', ');
    return;
  }

  if (s.phase === 'ready') {
    lobbyPanel.style.display = 'block';
    qpanel.style.display = 'none';
    const mates = s.players.filter((p) => p.team === team).map((p) => escapeHtml(p.name));
    document.getElementById('lobbyTitle').textContent = team
      ? 'Teams are set — waiting for the host to start'
      : 'Teams are set';
    document.getElementById('lobbyList').innerHTML = team
      ? 'Your team: ' + mates.map((n) => '<b>' + n + '</b>').join(', ')
      : 'You are not in a team this round — you can spectate.';
    return;
  }

  // question / reveal / gameover
  lobbyPanel.style.display = 'none';
  updateCountdown(s.deadline, s.phase);
  const recap = document.getElementById('recapPanel');
  if (s.phase === 'gameover') {
    qpanel.style.display = 'none';
    renderRecap(s, recap, team);
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
  if (tierEl) {
    tierEl.textContent = s.current.difficulty || '';
    tierEl.className = 'tier ' + (s.current.difficulty || '');
  }
  document.getElementById('qtext').textContent = s.current.text;

  const wrap = document.getElementById('qoptions');
  wrap.innerHTML = '';
  const correct = typeof s.current.correct === 'number' ? s.current.correct : null;
  const teamVoted = team && s.votes[team];
  const locked = s.phase !== 'question' || !team || teamVoted;

  s.current.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'opt';
    if (myVote === i) btn.classList.add('selected');
    if (correct !== null) {
      if (i === correct) btn.classList.add('correct');
      else if (myVote === i) btn.classList.add('wrong');
    }
    btn.disabled = locked;
    btn.innerHTML = '<span class="key">' + KEYS[i] + '</span><span>' + escapeHtml(opt) + '</span>';
    btn.onclick = () => {
      if (locked) return;
      myVote = i;
      socket.emit('team:vote', { answer: i });
    };
    wrap.appendChild(btn);
  });

  banner.innerHTML = '';
  if (s.phase === 'question') {
    if (!team) banner.innerHTML = '<div class="banner info">You are spectating this round.</div>';
    else if (teamVoted)
      banner.innerHTML = '<div class="banner info">Vote cast. Waiting for the other team…</div>';
    else banner.innerHTML = '<div class="banner info">Agree as a team, then tap your answer.</div>';
  } else if ((s.phase === 'reveal' || s.phase === 'gameover') && s.lastReveal && team) {
    banner.innerHTML = s.lastReveal.results[team]
      ? '<div class="banner win">Correct! +1 point</div>'
      : '<div class="banner info">Not this time — 0 points.</div>';
    if (s.current.explanation) {
      banner.innerHTML +=
        '<div class="banner why"><b>Why:</b> ' + escapeHtml(s.current.explanation) + '</div>';
    }
  }

  if (s.phase === 'gameover' && s.winner) {
    banner.innerHTML +=
      s.winner === team
        ? '<div class="banner win">🏆 Your team wins!</div>'
        : '<div class="banner info">' +
          escapeHtml(s.teams[s.winner].name) +
          ' wins this game.</div>';
  }
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
