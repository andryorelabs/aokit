---
name: better-auth
description: Work on authentication with Better Auth. Use when adding sign-in, sessions, providers, protected routes or changing the auth models.
---

# Better Auth

Better Auth runs inside the Next App Router web Target and stores users in Postgres through Prisma.

## Where things live

- `src/lib/auth.ts`: the server instance (`auth`). Add plugins and social providers to the `betterAuth({...})` options here.
- `src/lib/auth-client.ts`: the browser client (`authClient`) for `signIn`, `signUp`, `signOut` and `useSession`.
- `src/app/api/auth/[...all]/route.ts`: the route handler that serves every `/api/auth/*` request.
- `prisma/schema.prisma` (db Target): the `User`, `Session`, `Account` and `Verification` models live inside the `better-auth:schema` Region. Do not edit the Region by hand.

## Environment

- `BETTER_AUTH_SECRET`: a random string of at least 32 characters. Generate it yourself, for example `openssl rand -base64 32`; aokit never generates secrets.
- `BETTER_AUTH_URL`: the public base URL, `http://localhost:3000` in development.
- `DATABASE_URL`: owned by the prisma Module.

## Steps

1. Copy the `.env.example` values into `.env` and set a real `BETTER_AUTH_SECRET`.
2. Run `bun run db:migrate`, then `bun run db:generate`, so the tables and the Prisma client exist.
3. Call `authClient.signUp.email(...)` and `authClient.signIn.email(...)` from client components; read sessions on the server with `auth.api.getSession({ headers })`.
4. After adding a Better Auth plugin that needs tables, regenerate the models with `bunx @better-auth/cli generate` and move them into your own schema section.
5. `src/proxy.ts` is owned by another Module (next or next-intl). Protect routes by checking the session in pages or layouts instead of writing the proxy.
