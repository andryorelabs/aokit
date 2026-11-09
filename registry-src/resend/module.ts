import { defineModule } from "@aokit/module";

export default defineModule({
  name: "resend",
  version: "1.0.0",
  provides: [{ capability: "email:send", cardinality: { max: 1 } }],
  files: [{ from: "files/client.ts", to: "client.ts", target: "emails", ownership: "seed" }],
  deps: {
    dependencies: { resend: { range: "catalog" } },
  },
  env: [{ key: "RESEND_API_KEY", scope: "root", schema: "z.string().min(1)", example: "" }],
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## resend\n\nResend sends transactional email from the emails Target.\n\nKey files:\n\n- `client.ts` in the emails directory: `createResendClient(apiKey)` and `sendEmail(client, message)`.\n\nSet `RESEND_API_KEY` in `.env`; aokit never generates secrets.\n",
    },
  ],
});
