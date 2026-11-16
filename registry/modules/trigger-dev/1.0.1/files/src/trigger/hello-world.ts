import { task } from "@trigger.dev/sdk";

export const helloWorld = task({
  id: "hello-world",
  run: (payload: { name: string }) => Promise.resolve({ message: `Hello, ${payload.name}!` }),
});
