import { greet } from "./index.ts";

console.log(greet(process.argv[2] ?? "world"));
