#!/usr/bin/env bash
# Provisions the Team Quiz app on an Ubuntu 22.04 box.
# Safe to re-run on a box that is already live: it redeploys the app and
# restarts the service, but leaves a certbot-managed nginx site (HTTPS) alone
# and backs up /etc/team-quiz.env before changing it.
# Usage: sudo bash setup.sh /path/to/team-quiz.env
set -euo pipefail

ENV_FILE="${1:-/tmp/team-quiz.env}"
# shellcheck disable=SC1090
source "$ENV_FILE"

export DEBIAN_FRONTEND=noninteractive

echo "==> Installing base packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg unzip nginx

echo "==> Installing Node.js 20 LTS"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Installing certbot"
apt-get install -y certbot python3-certbot-nginx

echo "==> Deploying application"
install -d -o ubuntu -g ubuntu /opt/team-quiz
install -d -o ubuntu -g ubuntu /var/lib/team-quiz
tar xzf /tmp/app.tar.gz -C /opt/team-quiz
chown -R ubuntu:ubuntu /opt/team-quiz
sudo -u ubuntu bash -c 'cd /opt/team-quiz && npm ci --omit=dev'

echo "==> Writing service environment"
SERVICE_ENV=/etc/team-quiz.env
NEW_ENV="$(mktemp)"
chmod 600 "$NEW_ENV"
cat > "$NEW_ENV" <<EOF
PORT=3000
WIN_SCORE=${WIN_SCORE}
SHARED_PASSWORD=${SHARED_PASSWORD}
SUPER_ADMIN_USER=${SUPER_ADMIN_USER}
SUPER_ADMIN_PASSWORD=${SUPER_ADMIN_PASSWORD}
DATA_FILE=/var/lib/team-quiz/state.json
ADMINS_FILE=/var/lib/team-quiz/admins.json
EOF
if [ -f "$SERVICE_ENV" ] && cmp -s "$NEW_ENV" "$SERVICE_ENV"; then
  echo "    unchanged"
  rm -f "$NEW_ENV"
else
  if [ -f "$SERVICE_ENV" ]; then
    # Hand edits on the box would otherwise be lost silently.
    ENV_BACKUP="${SERVICE_ENV}.bak-$(date +%Y%m%d-%H%M%S)"
    cp -p "$SERVICE_ENV" "$ENV_BACKUP"
    echo "    existing env differs; previous version saved to ${ENV_BACKUP}"
  fi
  install -m 600 -o root -g root "$NEW_ENV" "$SERVICE_ENV"
  rm -f "$NEW_ENV"
fi

echo "==> Installing systemd unit"
cat > /etc/systemd/system/team-quiz.service <<'EOF'
[Unit]
Description=Team Quiz
After=network.target

[Service]
WorkingDirectory=/opt/team-quiz
EnvironmentFile=/etc/team-quiz.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=2
User=ubuntu

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable team-quiz
# restart (not "enable --now"): on a redeploy the service is already running
# and would otherwise keep serving the old code.
systemctl restart team-quiz
sleep 3
systemctl is-active --quiet team-quiz || {
  echo "team-quiz failed to start; last log lines:" >&2
  journalctl -u team-quiz -n 30 --no-pager >&2 || true
  exit 1
}

echo "==> Configuring nginx reverse proxy"
NGINX_SITE=/etc/nginx/sites-available/team-quiz
if [ -f "$NGINX_SITE" ] && grep -Eq 'listen[^;]*443|managed by Certbot' "$NGINX_SITE"; then
  # certbot has already rewritten this file to serve HTTPS. Regenerating the
  # plain-HTTP template here would drop the 443 server block and take the
  # site offline until enable-https.sh is run again.
  echo "    HTTPS site already configured; leaving ${NGINX_SITE} untouched"
else
cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
    }
}
EOF
fi
ln -sf /etc/nginx/sites-available/team-quiz /etc/nginx/sites-enabled/team-quiz
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Writing HTTPS helper"
cat > /opt/team-quiz/enable-https.sh <<EOF
#!/usr/bin/env bash
set -e
sudo certbot --nginx -d ${DOMAIN} -m ${LE_EMAIL} --agree-tos -n --redirect
echo "HTTPS enabled for https://${DOMAIN}"
EOF
chmod +x /opt/team-quiz/enable-https.sh

if [ "${RUN_CERTBOT}" = "yes" ]; then
  echo "==> Attempting automatic HTTPS (waiting for DNS to point here)"
  TOKEN=$(curl -fsSL -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 300" 2>/dev/null || true)
  MYIP=$(curl -fsSL -H "X-aws-ec2-metadata-token: ${TOKEN}" \
    http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)
  for i in $(seq 1 30); do
    RESOLVED=$(getent hosts "${DOMAIN}" | awk '{print $1}' | head -n1 || true)
    if [ -n "${RESOLVED}" ] && [ "${RESOLVED}" = "${MYIP}" ]; then
      echo "    DNS resolves to ${RESOLVED}, requesting certificate"
      certbot --nginx -d "${DOMAIN}" -m "${LE_EMAIL}" --agree-tos -n --redirect \
        || echo "    certbot failed; run /opt/team-quiz/enable-https.sh later"
      break
    fi
    echo "    DNS not ready (${RESOLVED:-none} vs ${MYIP}), retry ${i}/30"
    sleep 10
  done
else
  echo "==> Skipping automatic HTTPS."
  echo "    Point an A record for ${DOMAIN} at this host's Elastic IP,"
  echo "    then SSH in and run: /opt/team-quiz/enable-https.sh"
fi

echo "==> Done. App is running on port 3000 behind nginx."
