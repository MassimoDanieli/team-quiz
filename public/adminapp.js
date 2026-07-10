'use strict';
const socket = io();

let suUser = sessionStorage.getItem('quizSuUser') || '';
let suToken = sessionStorage.getItem('quizSuToken') || '';

function esc(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}

function attemptLogin() {
  if (suToken) {
    socket.emit('super:resume', { token: suToken });
  } else {
    document.getElementById('superLogin').style.display = 'block';
  }
}
attemptLogin();
socket.on('connect', () => {
  if (suToken) attemptLogin();
});

socket.on('superAuthOk', ({ token } = {}) => {
  if (token) {
    suToken = token;
    sessionStorage.setItem('quizSuToken', token);
  }
  document.getElementById('superLogin').style.display = 'none';
  document.getElementById('superApp').style.display = 'block';
});
socket.on('superAuthError', ({ reason }) => {
  suToken = '';
  sessionStorage.removeItem('quizSuToken');
  document.getElementById('superApp').style.display = 'none';
  document.getElementById('superLogin').style.display = 'block';
  document.getElementById('suLoginError').textContent = reason || 'Sign-in failed';
});
socket.on('superError', ({ reason }) => {
  const el = document.getElementById('createMsg');
  el.style.color = 'var(--red)';
  el.textContent = reason || 'Something went wrong';
});

socket.on('superState', (s) => {
  document.getElementById('statBadge').textContent =
    s.admins.length + ' admins · ' + s.rooms.length + ' games';

  const admins = s.admins;
  const al = document.getElementById('adminList');
  if (!admins.length) {
    al.innerHTML = 'No admins yet. Create one above so someone can host.';
  } else {
    al.innerHTML =
      '<table class="atable"><thead><tr><th>Username</th><th>Created</th><th>Active game</th><th></th></tr></thead><tbody>' +
      admins
        .map((a) => {
          const created = a.createdAt ? new Date(a.createdAt).toLocaleDateString() : '—';
          const room = a.activeRoom ? '<span class="tier medium">' + a.activeRoom + '</span>' : '—';
          return (
            '<tr><td><b>' +
            esc(a.username) +
            '</b></td><td>' +
            created +
            '</td><td>' +
            room +
            '</td>' +
            '<td class="arow">' +
            '<button class="btn secondary sm" data-reset="' +
            esc(a.username) +
            '">Reset password</button> ' +
            '<button class="btn ghost sm" data-remove="' +
            esc(a.username) +
            '">Remove</button>' +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table>';
  }

  const rl = document.getElementById('roomList');
  if (!s.rooms.length) {
    rl.textContent = 'None right now.';
  } else {
    rl.innerHTML =
      '<table class="atable"><thead><tr><th>Code</th><th>Host</th><th>Phase</th><th>Players</th></tr></thead><tbody>' +
      s.rooms
        .map(
          (r) =>
            '<tr><td><span class="tier medium">' +
            esc(r.code) +
            '</span></td><td>' +
            esc(r.hostAdmin || '—') +
            '</td><td>' +
            esc(r.phase) +
            '</td><td>' +
            r.players +
            '</td></tr>'
        )
        .join('') +
      '</tbody></table>';
  }

  // wire per-row buttons
  al.querySelectorAll('[data-reset]').forEach((b) => {
    b.onclick = () => {
      const u = b.getAttribute('data-reset');
      const pw = prompt('New password for "' + u + '" (min 8 characters):');
      if (pw === null) return;
      if (pw.length < 8) {
        alert('Password must be at least 8 characters.');
        return;
      }
      socket.emit('super:resetPassword', { username: u, password: pw });
    };
  });
  al.querySelectorAll('[data-remove]').forEach((b) => {
    b.onclick = () => {
      const u = b.getAttribute('data-remove');
      if (confirm('Remove admin "' + u + '"? Any game they are running will be closed.')) {
        socket.emit('super:removeAdmin', { username: u });
      }
    };
  });
});

function doSuLogin() {
  const u = document.getElementById('suUser').value.trim();
  const v = document.getElementById('suPw').value;
  if (!u || !v) {
    document.getElementById('suLoginError').textContent = 'Enter username and password.';
    return;
  }
  suUser = u;
  sessionStorage.setItem('quizSuUser', u);
  document.getElementById('suLoginError').textContent = '';
  socket.emit('super:login', { username: u, password: v });
}
document.getElementById('suLoginBtn').onclick = doSuLogin;
document.getElementById('suPw').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSuLogin();
});
document.getElementById('suUser').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSuLogin();
});
document.getElementById('suSignOutBtn').onclick = () => {
  socket.emit('super:logout');
  suToken = '';
  sessionStorage.removeItem('quizSuToken');
  location.reload();
};

document.getElementById('createBtn').onclick = () => {
  const username = document.getElementById('newUser').value.trim();
  const password = document.getElementById('newPw').value;
  const msg = document.getElementById('createMsg');
  if (password.length < 8) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Password must be at least 8 characters.';
    return;
  }
  msg.style.color = 'var(--green)';
  msg.textContent = 'Creating…';
  socket.emit('super:createAdmin', { username, password });
  document.getElementById('newUser').value = '';
  document.getElementById('newPw').value = '';
  setTimeout(() => {
    if (msg.textContent === 'Creating…') msg.textContent = '';
  }, 1500);
};
