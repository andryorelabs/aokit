import { defineModule } from "@aokit/module";

const authModels = `
model User {
  id            String    @id
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  sessions      Session[]
  accounts      Account[]

  @@map("user")
}

model Session {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
  @@map("session")
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@index([userId])
  @@map("account")
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([identifier])
  @@map("verification")
}
`;

export default defineModule({
  name: "better-auth",
  version: "1.0.0",
  provides: [{ capability: "auth", cardinality: { max: 1 } }],
  requires: ["orm:prisma", "web:app-router", "ext:db.schema@^1"],
  files: [
    { from: "files/auth.ts.txt", to: "src/lib/auth.ts", target: "web", ownership: "managed" },
    {
      from: "files/auth-client.ts",
      to: "src/lib/auth-client.ts",
      target: "web",
      ownership: "managed",
    },
    {
      from: "files/route.ts.txt",
      to: "src/app/api/auth/[...all]/route.ts",
      target: "web",
      ownership: "managed",
    },
    {
      from: "files/skill/SKILL.md",
      to: ".claude/skills/better-auth/SKILL.md",
      target: "root",
      ownership: "managed",
    },
  ],
  deps: {
    dependencies: {
      "better-auth": { range: "catalog", target: "web" },
    },
    devDependencies: {
      "@better-auth/cli": { range: "catalog", target: "db" },
    },
  },
  env: [
    {
      key: "BETTER_AUTH_SECRET",
      scope: "root",
      schema: "z.string().min(32)",
      visibility: "server",
      example: "replace-with-a-random-secret-of-32-or-more-characters",
    },
    {
      key: "BETTER_AUTH_URL",
      scope: "root",
      schema: "z.url()",
      visibility: "server",
      example: "http://localhost:3000",
    },
  ],
  ops: [
    {
      op: "appendRegion",
      extensionPoint: "db.schema",
      range: "^1",
      region: "schema",
      content: authModels,
    },
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## better-auth\n\nBetter Auth handles sign-in and sessions on the Next App Router Target, stored in Postgres through Prisma.\n\nKey files:\n\n- `src/lib/auth.ts`: the server `auth` instance; add plugins and providers here.\n- `src/lib/auth-client.ts`: the browser `authClient`.\n- `src/app/api/auth/[...all]/route.ts`: the route handler for `/api/auth/*`.\n- `prisma/schema.prisma`: the auth models, inside the `better-auth:schema` Region.\n\nSet `BETTER_AUTH_SECRET` (32+ random characters) and `BETTER_AUTH_URL` in `.env`; aokit never generates secrets. This Module does not write `src/proxy.ts`.\n\nSkills:\n\n- `.claude/skills/better-auth/SKILL.md`: how to work on authentication.\n",
    },
  ],
});
