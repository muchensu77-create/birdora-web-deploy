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

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then((res)=>process.exit(res.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
