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

# Persisted question history lives on a mounted volume
ENV PORT=3000 \
    DATA_FILE=/data/state.json

EXPOSE 3000

# node:alpine ships a non-root "node" user (uid 1000)
USER node

CMD ["node", "server.js"]
