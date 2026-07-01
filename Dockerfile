FROM node:24.14.0-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_FILE=/data/birdora.sqlite

VOLUME ["/data"]
EXPOSE 4000

CMD ["node", "server.js"]
