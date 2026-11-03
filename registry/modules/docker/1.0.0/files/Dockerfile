FROM oven/bun:1 AS base
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
