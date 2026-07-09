'use strict';
// Shared end-of-match recap renderer. Used by index.html and host.html.
// renderRecap(state, containerEl, viewerTeam) — viewerTeam is 'A' | 'B' | null.
/* eslint-disable no-unused-vars */
function renderRecap(s, el, viewerTeam) {
  if (s.phase !== 'gameover' || !Array.isArray(s.history)) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const esc = (str) =>
    String(str).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );
  const KEYS = ['A', 'B', 'C', 'D'];
  const tn = { A: s.teams.A.name, B: s.teams.B.name };
  const score = s.teams.A.score + '–' + s.teams.B.score;

  let head;
  if (s.winner) {
    head = '<div class="rbanner win">🏆 <b>' + esc(tn[s.winner]) + '</b> wins ' + score + '!</div>';
    if (viewerTeam === s.winner)
      head += '<div class="rbanner you">That\u2019s your team — congratulations!</div>';
  } else {
    head = '<div class="rbanner tie">🤝 It\u2019s a tie — ' + score + '. Honours even.</div>';
  }
  if (s.endedByHost)
    head +=
      '<div class="small muted center" style="margin-top:6px;">Match ended by the host.</div>';

  const n = s.history.length;
  const okA = s.history.filter((h) => h.results.A).length;
  const okB = s.history.filter((h) => h.results.B).length;
  const stats =
    '<div class="rstats">' +
    '<span class="chip A">' +
    esc(tn.A) +
    ' ' +
    okA +
    '/' +
    n +
    '</span>' +
    '<span class="chip B">' +
    esc(tn.B) +
    ' ' +
    okB +
    '/' +
    n +
    '</span>' +
    '</div>';

  const rows = s.history
    .map((h) => {
      const opts = h.options
        .map((opt, i) => {
          const cls = ['ropt'];
          if (i === h.correct) cls.push('correct');
          const chips = [];
          ['A', 'B'].forEach((t) => {
            if (h.votes[t] === i) {
              const ok = i === h.correct;
              if (!ok) cls.push('picked-wrong');
              chips.push(
                '<span class="chip ' +
                  t +
                  '">' +
                  esc(tn[t]) +
                  ' ' +
                  (ok ? '<b class="ok">✓</b>' : '<b class="ko">✗</b>') +
                  '</span>'
              );
            }
          });
          return (
            '<div class="' +
            cls.join(' ') +
            '">' +
            '<span class="key">' +
            KEYS[i] +
            '</span>' +
            '<span class="rtxt">' +
            esc(opt) +
            '</span>' +
            (chips.length ? '<span class="rchips">' + chips.join('') + '</span>' : '') +
            '</div>'
          );
        })
        .join('');
      const noVotes = ['A', 'B']
        .filter((t) => h.votes[t] === null || h.votes[t] === undefined)
        .map(
          (t) =>
            '<span class="chip ' + t + '">' + esc(tn[t]) + ' no answer <b class="ko">✗</b></span>'
        )
        .join('');
      return (
        '<div class="rq">' +
        '<div class="rmeta"><span class="topic">' +
        esc(h.topic) +
        '</span>' +
        '<span class="small muted">Q' +
        h.number +
        ' · ' +
        esc(h.setName) +
        (h.difficulty
          ? ' · <span class=\"tier ' + h.difficulty + '\">' + h.difficulty + '</span>'
          : '') +
        '</span></div>' +
        '<div class="rtext">' +
        esc(h.text) +
        '</div>' +
        opts +
        (noVotes ? '<div class="rnovote">' + noVotes + '</div>' : '') +
        (h.explanation ? '<div class="rwhy"><b>Why:</b> ' + esc(h.explanation) + '</div>' : '') +
        '</div>'
      );
    })
    .join('');

  el.innerHTML = '<h2>Match recap</h2>' + head + stats + rows;
  el.style.display = 'block';
}
