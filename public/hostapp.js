'use strict';
const socket = io();
const KEYS = ['A', 'B', 'C', 'D'];

let hostPw = sessionStorage.getItem('quizHostPw') || '';
let requiresHostPw = false;
let authed = false;

function attemptJoin() {
  socket.emit('host:join', hostPw ? { password: hostPw } : {});
}

fetch('/config')
  .then((r) => r.json())
  .then((c) => {
    requiresHostPw = !!c.requiresHostPassword;
    if (requiresHostPw && !hostPw) {
      document.getElementById('hostLogin').style.display = 'block';
    } else {
      attemptJoin();
    }
  })
  .catch(() => attemptJoin());

socket.on('connect', () => {
  if (authed || !requiresHostPw || hostPw) attemptJoin();
});

socket.on('hostAuthOk', () => {
  authed = true;
  document.getElementById('hostLogin').style.display = 'none';
  document.getElementById('hostApp').style.display = 'block';
});
socket.on('hostAuthError', ({ reason }) => {
  authed = false;
  hostPw = '';
  sessionStorage.removeItem('quizHostPw');
  document.getElementById('hostApp').style.display = 'none';
  document.getElementById('hostLogin').style.display = 'block';
  document.getElementById('hostLoginError').textContent = reason || 'Sign-in failed';
});

function doHostLogin() {
  const v = document.getElementById('hostPw').value;
  if (!v) {
    document.getElementById('hostLoginError').textContent = 'Enter the host password.';
    return;
  }
  hostPw = v;
  sessionStorage.setItem('quizHostPw', v);
  document.getElementById('hostLoginError').textContent = '';
  attemptJoin();
}
document.getElementById('hostLoginBtn').onclick = doHostLogin;
document.getElementById('hostPw').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doHostLogin();
});

socket.on('state', render);
socket.on('hostError', ({ reason }) => {
  const e = document.getElementById('hostError');
  e.textContent = reason || 'Error';
  setTimeout(() => {
    e.textContent = '';
  }, 3000);
});

function render(s) {
  document.getElementById('phaseBadge').textContent = s.phase;
  document.getElementById('nameA').textContent = s.teams.A.name;
  document.getElementById('nameB').textContent = s.teams.B.name;
  document.getElementById('ptsA').textContent = s.teams.A.score;
  document.getElementById('ptsB').textContent = s.teams.B.score;
  document.getElementById('qnum').textContent = s.questionNumber;
  document.getElementById('winscore').textContent = s.winScore;
  document.getElementById('used').textContent = s.usedCount;
  document.getElementById('total').textContent = s.totalQuestions;
  document.getElementById('dotA').className = 'dot' + (s.votes.A ? ' voted' : '');
  document.getElementById('dotB').className = 'dot' + (s.votes.B ? ' voted' : '');
  document.getElementById('histBtn').textContent =
    'Reset question history (' + s.usedCount + '/' + s.totalQuestions + ')';

  // question set selector — editable any time; mid-game it applies from the next question
  const sel = document.getElementById('stackSelect');
  const cur = s.stackId;
  const wantOpts = (s.stacks || []).map((st) => st.id).join(',');
  if (sel.dataset.opts !== wantOpts) {
    sel.innerHTML = (s.stacks || [])
      .map((st) => '<option value="' + st.id + '">' + escapeHtml(st.name) + '</option>')
      .join('');
    sel.dataset.opts = wantOpts;
  }
  if (document.activeElement !== sel) sel.value = cur;
  sel.disabled = false;
  const curStack = (s.stacks || []).find((st) => st.id === cur);
  if (curStack) {
    document.getElementById('stackCount').textContent =
      curStack.used + '/' + curStack.total + ' used';
    document.getElementById('stackDesc').textContent = curStack.description || '';
  }
  document.getElementById('stackPanel').style.display = 'block';
  const pendingSwitch =
    s.currentSetId &&
    s.stackId !== s.currentSetId &&
    (s.phase === 'question' || s.phase === 'reveal');
  document.getElementById('stackNote').textContent = pendingSwitch
    ? '→ takes effect from the next question'
    : '';
  document.getElementById('timerInput').placeholder = s.timerSeconds;
  document.getElementById('timerNote').textContent =
    s.timerSeconds > 0
      ? 'Current: ' + s.timerSeconds + 's (applies from next question)'
      : 'Current: off';

  // difficulty toggles + per-tier counts for the selected set
  const tiers = s.difficulty || ['medium', 'hard', 'pro'];
  [
    ['tierMedium', 'medium'],
    ['tierHard', 'hard'],
    ['tierPro', 'pro']
  ].forEach(([id, t]) => {
    const cb = document.getElementById(id);
    if (document.activeElement !== cb) cb.checked = tiers.includes(t);
  });
  if (curStack && curStack.tiers) {
    document.getElementById('cntMedium').textContent = '(' + curStack.tiers.medium + ')';
    document.getElementById('cntHard').textContent = '(' + curStack.tiers.hard + ')';
    document.getElementById('cntPro').textContent = '(' + curStack.tiers.pro + ')';
  }
  const midGame = s.phase === 'question' || s.phase === 'reveal';
  document.getElementById('tierNote').textContent = midGame
    ? '→ applies from the next question'
    : '';

  // roster
  document.getElementById('pcount').textContent = s.players.length;
  const lobby = s.players.filter((p) => !p.team).map((p) => escapeHtml(p.name));
  const a = s.players.filter((p) => p.team === 'A').map((p) => escapeHtml(p.name));
  const b = s.players.filter((p) => p.team === 'B').map((p) => escapeHtml(p.name));
  document.getElementById('roster').innerHTML =
    (lobby.length ? '<div class="muted">Unassigned: ' + lobby.join(', ') + '</div>' : '') +
    '<div style="margin-top:6px;"><b style="color:var(--teamA)">' +
    escapeHtml(s.teams.A.name) +
    ':</b> ' +
    (a.join(', ') || '<span class="muted">—</span>') +
    '</div>' +
    '<div><b style="color:var(--teamB)">' +
    escapeHtml(s.teams.B.name) +
    ':</b> ' +
    (b.join(', ') || '<span class="muted">—</span>') +
    '</div>';

  // lobby inputs
  if (document.activeElement.id !== 'inA') document.getElementById('inA').value = s.teams.A.name;
  if (document.activeElement.id !== 'inB') document.getElementById('inB').value = s.teams.B.name;

  // buttons
  const canDraw = s.phase === 'login' || s.phase === 'ready';
  document.getElementById('drawBtn').disabled = !canDraw;
  document.getElementById('redrawBtn').disabled = !canDraw;
  document.getElementById('startBtn').disabled = !(s.phase === 'ready' || s.phase === 'gameover');
  document.getElementById('startBtn').textContent =
    s.phase === 'gameover' ? 'Play again (same teams)' : 'Start game';
  document.getElementById('revealBtn').disabled = s.phase !== 'question';
  document.getElementById('nextBtn').disabled = s.phase !== 'reveal';
  const endBtn = document.getElementById('endBtn');
  endBtn.disabled = !(s.phase === 'question' || s.phase === 'reveal');
  if (endBtn.disabled) resetEndBtn();

  // countdown
  updateCountdown(s.deadline, s.phase);

  // recap
  renderRecap(s, document.getElementById('recapPanel'));

  // question
  const qp = document.getElementById('qpanel');
  if (s.phase === 'gameover') {
    qp.style.display = 'none';
  } else if (s.current) {
    qp.style.display = 'block';
    document.getElementById('qtopic').textContent = s.current.topic;
    document.getElementById('qtext').textContent = s.current.text;
    const wrap = document.getElementById('qoptions');
    wrap.innerHTML = '';
    s.current.options.forEach((opt, i) => {
      const div = document.createElement('div');
      div.className = 'opt';
      if (typeof s.current.correct === 'number') {
        if (s.phase === 'question' && i === s.current.correct) div.classList.add('selected');
        if ((s.phase === 'reveal' || s.phase === 'gameover') && i === s.current.correct)
          div.classList.add('correct');
      }
      div.innerHTML =
        '<span class="key">' + KEYS[i] + '</span><span>' + escapeHtml(opt) + '</span>';
      wrap.appendChild(div);
    });
    const rb = document.getElementById('revealBanner');
    if (s.lastReveal) {
      const tv = s.teamVotes || {};
      rb.innerHTML =
        '<div class="banner info">' +
        teamLine(s.teams.A.name, tv.A, s.lastReveal.results.A) +
        teamLine(s.teams.B.name, tv.B, s.lastReveal.results.B) +
        '</div>';
      if (s.current.explanation) {
        rb.innerHTML +=
          '<div class="banner why"><b>Why:</b> ' + escapeHtml(s.current.explanation) + '</div>';
      }
    } else rb.innerHTML = '';
    if (s.phase === 'gameover' && s.winner) {
      rb.innerHTML +=
        '<div class="banner win">🏆 ' +
        escapeHtml(s.teams[s.winner].name) +
        ' wins the game!</div>';
    }
  } else {
    qp.style.display = 'none';
  }
}

function teamLine(name, vote, ok) {
  const v = typeof vote === 'number' ? KEYS[vote] : '—';
  const flag = ok ? '<span class="flag ok">+1</span>' : '<span class="flag no">0</span>';
  return '<div>' + escapeHtml(name) + ': voted <b>' + v + '</b> ' + flag + '</div>';
}
function escapeHtml(str) {
  return String(str).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}

// Two-step End match: first click arms, second confirms (4s window).
let endArmed = null;
function resetEndBtn() {
  const b = document.getElementById('endBtn');
  if (endArmed) {
    clearTimeout(endArmed);
    endArmed = null;
  }
  b.textContent = '⏹ End match';
  b.classList.remove('armed');
}
document.getElementById('endBtn').onclick = () => {
  const b = document.getElementById('endBtn');
  if (endArmed) {
    resetEndBtn();
    socket.emit('host:endMatch');
    return;
  }
  b.textContent = 'Confirm end? Leader wins, or tie';
  b.classList.add('armed');
  endArmed = setTimeout(resetEndBtn, 4000);
};
function emitTiers(changed) {
  const tiers = [];
  if (document.getElementById('tierMedium').checked) tiers.push('medium');
  if (document.getElementById('tierHard').checked) tiers.push('hard');
  if (document.getElementById('tierPro').checked) tiers.push('pro');
  if (tiers.length === 0) {
    changed.checked = true;
    return;
  } // at least one tier
  socket.emit('host:setDifficulty', { tiers });
}
['tierMedium', 'tierHard', 'tierPro'].forEach((id) => {
  document.getElementById(id).onchange = (e) => emitTiers(e.target);
});

document.getElementById('pwChangeBtn').onclick = () => {
  const current = document.getElementById('pwCurrent').value;
  const next = document.getElementById('pwNext').value;
  const msg = document.getElementById('pwMsg');
  if (next.length < 8) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'New password must be at least 8 characters.';
    return;
  }
  msg.style.color = '';
  msg.textContent = '';
  socket.emit('host:changePassword', { current, next });
};
socket.on('passwordChanged', () => {
  const msg = document.getElementById('pwMsg');
  msg.style.color = 'var(--green)';
  msg.textContent = 'Password changed. New host logins will need the new one.';
  document.getElementById('pwCurrent').value = '';
  const next = document.getElementById('pwNext').value;
  document.getElementById('pwNext').value = '';
  sessionStorage.setItem('quizHostPw', next);
});

document.getElementById('timerBtn').onclick = () => {
  const v = parseInt(document.getElementById('timerInput').value, 10);
  if (Number.isInteger(v)) socket.emit('host:setTimer', { seconds: v });
};

// Local 1s countdown from the server deadline (epoch ms).
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

document.getElementById('drawBtn').onclick = () => socket.emit('host:drawTeams');
document.getElementById('stackSelect').onchange = (e) =>
  socket.emit('host:setStack', { stackId: e.target.value });
document.getElementById('redrawBtn').onclick = () => socket.emit('host:drawTeams');
document.getElementById('startBtn').onclick = () => socket.emit('host:start');
document.getElementById('revealBtn').onclick = () => socket.emit('host:reveal');
document.getElementById('nextBtn').onclick = () => socket.emit('host:next');
document.getElementById('resetBtn').onclick = () => {
  if (confirm('Start a new match? Players stay, scores reset, question history is kept.'))
    socket.emit('host:reset');
};
document.getElementById('histBtn').onclick = () => {
  if (confirm('Reset the question history? Used questions will be able to appear again.'))
    socket.emit('host:resetHistory');
};
document.getElementById('reroll').onclick = () => socket.emit('host:rerollNames');
document.getElementById('saveNames').onclick = () => {
  socket.emit('host:setName', { team: 'A', name: document.getElementById('inA').value });
  socket.emit('host:setName', { team: 'B', name: document.getElementById('inB').value });
};
