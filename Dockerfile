FROM oven/bun:1-alpine
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src/ src/
COPY public/ public/
COPY index.html server.ts tsconfig.json ./

EXPOSE 3000
CMD ["bun", "--smol", "run", "server.ts"]
