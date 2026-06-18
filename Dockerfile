FROM oven/bun:1.3.13-alpine
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src/ src/
COPY public/ public/
COPY index.html tsconfig.json ./

EXPOSE 3000
CMD ["bun", "run", "src/server/index.ts"]
