#!/usr/bin/env bun

import { run } from "aokit/cli";

process.exitCode = await run(["create", ...process.argv.slice(2)]);
