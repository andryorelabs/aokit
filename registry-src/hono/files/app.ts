import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";

export const middleware: MiddlewareHandler[] = [];

export const routes: Record<string, Hono> = {};

const app = new Hono();

for (const handler of middleware) {
  app.use(handler);
}

for (const [path, route] of Object.entries(routes)) {
  app.route(path, route);
}

app.get("/health", (context) => context.json({ status: "ok" }));

export type AppType = typeof app;

export default app;
