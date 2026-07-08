# Team Quiz

Real-time two-team quiz game (Java / DevOps, graduate level).
Players log in, the host randomly draws two teams, then each team votes one answer
per question. First to **3 points and ahead** wins. Both teams see each question at
the same time; the answer reveals once both have voted.

Stack: Node.js + Express + Socket.IO. Live game state is in memory; the **history of
already-asked questions is persisted to disk** so questions don't repeat across
sessions or restarts until all 60 are used.

---

## Run locally

```bash
npm install
npm start            # http://localhost:3000
```

- Players: open `/` , enter a name, click Join.
- Host: open `/host.html`.

Environment variables:

| Var               | Default            | Meaning                                            |
|-------------------|--------------------|----------------------------------------------------|
| `PORT`            | `3000`             | HTTP port                                          |
| `WIN_SCORE`       | `3`                | Points needed to win (must also be ahead)          |
| `SHARED_PASSWORD` | *(empty)*          | If set, players must enter this password to join. Empty = no password. |
| `HOST_PASSWORD`   | *(empty)*          | If set, the host panel requires this password. **Set it for any public deployment** — otherwise anyone with the URL can control a session. |
| `DATA_FILE`       | `./data/state.json`| Where the used-question history is stored          |
| `QUESTIONS_DIR`   | `./questions`      | Directory of question-set files                    |
| `MAX_PLAYERS`     | `200`              | Cap on distinct players held in memory             |
| `LOG_LEVEL`       | `info`             | Pino log level (`debug`, `info`, `warn`, …)        |

## Production hardening
- **Security headers** via Helmet (CSP, HSTS, X-Frame-Options, nosniff, no `X-Powered-By`).
- **Per-socket rate limiting**: excess events are dropped and flooding sockets disconnected.
- **Input validation**: player ids, names (sanitised, length-capped) and answers are checked server-side; Socket.IO frame size is capped.
- **`GET /healthz`** returns a small JSON status for monitoring / load-balancer probes.
- **Graceful shutdown** on SIGTERM/SIGINT (drains connections, then exits).
- **Structured logging** with pino (JSON; pipe through `pino-pretty` locally if you like).

```bash
HOST_PASSWORD=pick-a-strong-one SHARED_PASSWORD=letmein npm start
```

## Tests
```bash
npm test
```
Node's built-in runner (`node --test`) covers two layers:
- **Unit** (`test/engine.test.js`) — the `GameEngine` in isolation with an in-memory store: scoring, the win/tie rule, no-repeat + reset, vote locking, `setStack` guards, and answer hiding. Fast, no sockets.
- **Integration** (`test/game.test.js`) — the real server over live socket connections, plus host authentication, input sanitisation and `/healthz`.

## Development
```bash
npm run lint          # ESLint
npm run format        # Prettier (write)
npm run format:check  # Prettier (check only)
```
CI runs lint, format check and tests on every push/PR (`.github/workflows/ci.yml`).

## Project structure
```
server.js            entry point: express app, helmet, Socket.IO, listen, graceful shutdown
store.js             persistence for per-set "already asked" history (atomic file writes)
src/
  config.js          env + paths
  logger.js          pino logger
  questions.js       loads question sets from a directory
  game.js            GameEngine — the whole game state machine (no transport concerns)
  socketHandlers.js  wires Socket.IO events to the engine (auth, rate limiting, broadcast)
  validation.js      name/answer input helpers
  teamNames.js       funny team-name pool
  util.js            shuffle
questions/           one JSON file per question set
public/              player (index.html) and host (host.html) front-ends + style.css
test/                unit + integration tests
infra/               Terraform (EC2 + nginx + HTTPS)
```

---

## How a session works

1. Players open `/`, enter a name, and land in the lobby. (Name + a random id are
   saved in their browser, so a refresh rejoins them automatically.)
2. Host opens `/host.html`, sees everyone in the lobby, clicks **Draw teams** — the
   connected players are split randomly into two teams (8 players → 4 + 4; odd numbers
   are handled, Team A gets the extra). **Redraw** reshuffles.
3. Host (optionally) edits or rerolls the funny team names, then clicks **Start game**.
4. Each question appears on every screen at once. A team agrees offline, any member
   taps the answer, and the team's vote locks.
5. When both teams have voted the answer reveals automatically (correct = +1). The host
   can also force **Reveal**, then **Next question**.
6. First team to the win score while ahead wins. If both tie at the threshold, play
   continues until one pulls ahead.

### No repeats
Every question has a stable id. Each new question is drawn at random from the ones not
yet used, and is recorded immediately. When all 60 have been used the history clears and
the pool starts over. The host panel shows **M / 60 used overall**.

- **New match** — resets scores and teams (players stay), but **keeps** the question
  history, so the next match continues with fresh questions.
- **Reset question history** — clears the used list so questions can appear again
  (e.g. to start a brand-new run of the 60).

---

## Deploy on Ubuntu (EC2)

1. Install Node LTS:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
2. Copy the project, install deps:
   ```bash
   cd /opt/team-quiz && npm install --omit=dev
   ```
3. systemd unit `/etc/systemd/system/team-quiz.service`:
   ```ini
   [Unit]
   Description=Team Quiz
   After=network.target

   [Service]
   WorkingDirectory=/opt/team-quiz
   ExecStart=/usr/bin/node server.js
   Environment=PORT=3000
   Environment=WIN_SCORE=3
   # Environment=SHARED_PASSWORD=letmein
   # Environment=DATA_FILE=/var/lib/team-quiz/state.json
   Restart=on-failure
   User=ubuntu

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable --now team-quiz
   ```
   If you set `DATA_FILE` outside the app dir, make sure that directory exists and is
   writable by the service user (`sudo mkdir -p /var/lib/team-quiz && sudo chown ubuntu /var/lib/team-quiz`).
4. nginx reverse proxy (the Upgrade/Connection headers are required for WebSockets):
   ```nginx
   server {
     listen 80;
     server_name quiz.example.com;
     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
   Add TLS (certbot) and open 80/443 in the security group.

---

## Question sets
Questions live in `questions/`, one JSON file per set. The host picks which set to play
from a dropdown in the lobby, and the "already asked" history is tracked **per set**, so
each set exhausts its own pool independently.

Shipped sets: Java & DevOps · Core (100), Java & DevOps · Advanced (33), AI Foundations ·
Beginner (32). The host panel shows a used/total counter per set and a per-set
"Reset question history".

Each set file:
```json
{
  "id": "java-devops-core",
  "name": "Java & DevOps · Core",
  "description": "Shown under the selector.",
  "order": 1,
  "questions": [
    { "id": "q001", "topic": "Java", "text": "…", "options": ["…","…","…","…"],
      "correct": 0, "explanation": "Shown to both teams after the vote." }
  ]
}
```
`correct` is the zero-based index. `order` controls the position in the dropdown. To add a
set, drop a new file in `questions/` and restart the service — no code change. Ids only need
to be unique within their own set. `build_sets.py` is the tool used to create the shipped
sets, but the files are the source of truth and can be edited directly.

The explanation is revealed only after both teams vote (the host also sees it during the
question, to read aloud).

## Persistence: why a file, not a database
The only thing that needs to survive restarts is the small set of used-question ids, so
the persistence layer (`store.js`) writes an atomic JSON file. The interface is tiny —
`getUsed` / `markUsed` / `resetUsed` — so if you later want a real database (e.g. to keep
match history, leaderboards, or run multiple rooms) you can swap `store.js` for a SQLite
implementation without changing `server.js`. SQLite (single file, no server) is the
natural next step; Postgres only if you go multi-instance.

## Notes / possible next steps
- Single live game (one room). Multiple concurrent rooms would need keying state by room id.
- Easy extensions: per-question countdown timer, sound on reveal, a big-screen spectator view.
