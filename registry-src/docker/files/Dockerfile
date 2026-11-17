FROM oven/bun:1@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS base
WORKDIR /app

FROM base AS install
COPY . .
RUN bun install --frozen-lockfile --production

FROM base AS release
COPY --from=install /app ./
ENV NODE_ENV=production
EXPOSE 3000
USER bun
CMD ["bun", "run", "start"]
