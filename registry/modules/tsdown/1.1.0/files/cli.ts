import { greet } from "./index";

console.log(greet(process.argv[2] ?? "world"));
