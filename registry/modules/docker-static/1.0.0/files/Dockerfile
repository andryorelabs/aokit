FROM oven/bun:1 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build

FROM nginx:1-alpine AS release
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-static-ready.sh
RUN chmod +x /docker-entrypoint.d/40-static-ready.sh
COPY --from=build /app/{{target:web}}/dist /usr/share/nginx/html
EXPOSE 8080
