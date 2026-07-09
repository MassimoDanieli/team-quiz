FROM node:20-alpine

WORKDIR /opt/team-quiz
ENV NODE_ENV=production

# Install dependencies from the lockfile for a reproducible image
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App code
COPY server.js store.js ./
COPY src ./src
COPY questions ./questions
COPY public ./public

# Persisted state lives on a mounted volume. BOTH the question history and the
# admin accounts must sit under /data so they survive container recreation.
ENV PORT=3000 \
    DATA_FILE=/data/state.json \
    ADMINS_FILE=/data/admins.json

# Create /data and hand it to the non-root "node" user BEFORE dropping privileges.
# A freshly-created named volume inherits the ownership of this path from the image;
# without this, /data is root-owned and the app (running as node) fails with EACCES.
RUN mkdir -p /data && chown -R node:node /data

EXPOSE 3000

# node:alpine ships a non-root "node" user (uid 1000)
USER node

CMD ["node", "server.js"]
