---
name: hono-add-route
description: Add an HTTP route to the Hono server of this Project. Use when the user asks for a new endpoint, route or API handler.
---

# Add a Hono route

The server lives in the server Target, in `src/app.ts`. Routes are registered through the `routes` object, keyed by mount path.

## Steps

1. Create a file for the route group, for example `src/routes/users.ts`, exporting a `Hono` instance.
2. Define handlers on it, for example `users.get("/", (context) => context.json([]))`.
3. Register it in the `routes` object of `src/app.ts`, for example `"/users": users`.
4. Run the server with `bun run start` and request the path to check it.

## Notes

- Middleware goes in the `middleware` array of `src/app.ts`.
- `src/app.ts` is managed by aokit; prefer the `server.routes` and `server.middleware` extension points over rewriting the file.
