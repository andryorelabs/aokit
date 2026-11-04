/** Bundled guidance markdown per topic, in GLOSSARY.md vocabulary. */
export const staticGuidance = {
  overview: `# aokit overview

aokit turns a selection of **Modules** into a TypeScript **Project** and keeps that Project updatable. A Module provides and requires **Capabilities** and writes to **Targets**; the **Layout** (\`single\` or \`monorepo\`) resolves each Target to a path. Modules come from a **Registry**, pinned to a **Release**, and the **Lockfile** (\`aokit.lock.json\`) records what was rendered.

## Rules of this server

- Every input field is explicit. Use \`null\` for an optional field you do not set.
- \`directory\` is always an absolute path.
- Nothing is written without a **Plan**: call \`plan\` or \`plan_add\` first and pass the returned \`planId\` to \`create\` or \`add\`.
- The server never runs \`bun install\`; the result lists it under \`nextSteps\`.
- The server never trusts a Registry on its own: pass it in \`trust\`.
- Every tool returns \`{ ok, data, error }\`; a failure carries \`error.code\`, \`error.message\` and \`error.fix\`.
`,
  workflow: `# Workflow

## New Project

1. Call \`get_schema\` with \`command: "create"\` to read the input and the available Modules and Layouts.
2. Call \`plan\` with the full explicit input. Nothing is written.
3. Show the user the Plan \`changes\` and the \`reproduce\` command.
4. Call \`create\` with exactly the same input plus the \`planId\`.
5. Run the \`nextSteps\` (\`bun install\`) outside this server.

## Add Modules to an existing Project

1. Call \`get_schema\` with \`command: "add"\`.
2. Call \`plan_add\` with an absolute \`directory\` of a Project that has a Lockfile and a clean git tree.
3. Review the Plan, then call \`add\` with the same input plus the \`planId\`.

## When a call fails

- \`PLAN_REQUIRED\`: the \`planId\` was not issued in this session, was already used, or the input, the Release, the Lockfile or the Project changed. Plan again.
- \`DIRTY_TREE\`: commit or stash the Project's uncommitted changes, then plan again.
- \`REGISTRY_UNTRUSTED\`: the user must approve the Registry; list its name or source in \`trust\`.
- Resolution errors (\`CAPABILITY_CONFLICT\`, \`REQUIREMENT_UNMET\`, \`CARDINALITY_EXCEEDED\`): change the \`modules\` selection as the \`fix\` says and plan again.
`,
  modules: `# Modules

A **Module** is a unit of capability declared as a manifest. It \`provides\` Capabilities, \`requires\` Capabilities or Extension points and may \`conflict\` with a Capability. A Capability has a **Cardinality**: \`orm\` allows one provider, \`deploy\` allows many.

Pick Modules so every \`requires\` is met by another selected Module and no two Modules conflict; the Resolver reports what is missing in \`error.fix\`. \`get_schema\` returns each Module with its \`requires\` and \`conflicts\`.
`,
  layouts: `# Layouts

A **Layout** maps **Targets** to paths for one Project. The user chooses it at \`create\`; no Module can force it, and \`add\` keeps the Layout the **Lockfile** records.

- \`single\`: one package.
- \`monorepo\`: a workspace with \`apps/*\` and \`packages/*\`.
`,
  errors: `# Errors

A failed tool call returns \`ok: false\` and \`error = { code, message, fix }\`. The \`code\` is stable; the category is the exit-code group the CLI uses for it. Follow \`fix\` before retrying.
`,
} as const;
