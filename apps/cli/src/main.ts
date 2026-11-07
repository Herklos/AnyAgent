#!/usr/bin/env node
import { runCli } from "./cli.js";

const result = await runCli(process.argv);
if (result.error) {
  process.stderr.write(`${result.error}\n`);
}
process.exit(result.code);
