---
name: trigger-dev
description: Add and run Trigger.dev background tasks. Use when adding a task, scheduling work, or wiring the dev and deploy commands.
---

# Working with Trigger.dev

1. Tasks live in `src/trigger/` of the jobs Target; `trigger.config.ts` points at that directory through `dirs`.
2. Add a task with `task({ id, run })` from `@trigger.dev/sdk` and export it. Task ids are unique per project.
3. Set `TRIGGER_SECRET_KEY` in `.env` (the dev key from the Trigger.dev dashboard) and `TRIGGER_PROJECT_REF` to your project ref; aokit never generates secrets.
4. Run `bun run jobs:dev` to connect a local worker, and `bun run jobs:deploy` to publish tasks.
5. Trigger a task from application code with `tasks.trigger("hello-world", payload)`, using a type-only import of the task for a typed payload.
6. Keep tasks idempotent; Trigger.dev retries failed runs.
