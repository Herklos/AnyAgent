import { parseArgs } from "node:util";
import { cmdAgentCreate, cmdAgentList } from "./commands/agent.js";
import { cmdDoctor } from "./commands/doctor.js";
import { cmdInit } from "./commands/init.js";
import { cmdVersion } from "./commands/version.js";
import { cmdRun } from "./run.js";

export type CliResult = { code: number; error?: string };

/**
 * Parse argv and dispatch. Exit code 2 = usage / unknown flag / missing args.
 */
export async function runCli(argv: string[]): Promise<CliResult> {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return { code: 0 };
  }

  const command = args[0]!;
  const rest = args.slice(1);

  try {
    switch (command) {
      case "version":
        return { code: cmdVersion() };
      case "init": {
        const { values } = parseArgs({
          args: rest,
          options: {
            config: { type: "string" },
            org: { type: "string" },
            check: { type: "boolean", default: false },
            help: { type: "boolean", short: "h" },
          },
          strict: true,
          allowPositionals: false,
        });
        if (values.help) {
          process.stdout.write("Usage: anybot init [--org <id>] [--check] [--config path]\n");
          return { code: 0 };
        }
        return {
          code: await cmdInit({
            ...(values.config ? { config: values.config } : {}),
            ...(values.org ? { org: values.org } : {}),
            check: values.check === true,
          }),
        };
      }
      case "agent": {
        const sub = rest[0];
        if (sub === "create") {
          const { values, positionals } = parseArgs({
            args: rest.slice(1),
            options: {
              harness: { type: "string" },
              model: { type: "string" },
              mode: { type: "string" },
              workdir: { type: "string" },
              "allowed-authors": { type: "string" },
              org: { type: "string" },
              config: { type: "string" },
              help: { type: "boolean", short: "h" },
            },
            strict: true,
            allowPositionals: true,
          });
          if (values.help) {
            process.stdout.write(
              "Usage: anybot agent create <handle> --harness <id> [--model m] [--mode read_only|full] [--workdir path] [--allowed-authors id,id] [--org id] [--config path]\n",
            );
            return { code: 0 };
          }
          const handle = positionals[0];
          if (!handle || !values.harness) {
            return {
              code: 2,
              error: "agent create requires <handle> and --harness",
            };
          }
          return {
            code: await cmdAgentCreate({
              handle,
              harness: values.harness,
              ...(values.model ? { model: values.model } : {}),
              ...(values.mode ? { mode: values.mode } : {}),
              ...(values.workdir ? { workdir: values.workdir } : {}),
              ...(values["allowed-authors"] ? { allowedAuthors: values["allowed-authors"] } : {}),
              ...(values.org ? { org: values.org } : {}),
              ...(values.config ? { config: values.config } : {}),
            }),
          };
        }
        if (sub === "list") {
          const { values } = parseArgs({
            args: rest.slice(1),
            options: {
              org: { type: "string" },
              config: { type: "string" },
              help: { type: "boolean", short: "h" },
            },
            strict: true,
            allowPositionals: false,
          });
          if (values.help) {
            process.stdout.write("Usage: anybot agent list [--org id] [--config path]\n");
            return { code: 0 };
          }
          return {
            code: await cmdAgentList({
              ...(values.org ? { org: values.org } : {}),
              ...(values.config ? { config: values.config } : {}),
            }),
          };
        }
        return { code: 2, error: "Usage: anybot agent <create|list> …" };
      }
      case "doctor": {
        const { values } = parseArgs({
          args: rest,
          options: {
            config: { type: "string" },
            org: { type: "string" },
            json: { type: "boolean", default: false },
            help: { type: "boolean", short: "h" },
          },
          strict: true,
          allowPositionals: false,
        });
        if (values.help) {
          process.stdout.write("Usage: anybot doctor [--org id] [--json] [--config path]\n");
          return { code: 0 };
        }
        return {
          code: await cmdDoctor({
            ...(values.config ? { config: values.config } : {}),
            ...(values.org ? { org: values.org } : {}),
            json: values.json === true,
          }),
        };
      }
      case "run": {
        const { values } = parseArgs({
          args: rest,
          options: {
            config: { type: "string" },
            help: { type: "boolean", short: "h" },
          },
          strict: true,
          allowPositionals: false,
        });
        if (values.help) {
          process.stdout.write("Usage: anybot run [--config path]\n");
          return { code: 0 };
        }
        return {
          code: await cmdRun({
            ...(values.config ? { config: values.config } : {}),
          }),
        };
      }
      default:
        return { code: 2, error: `unknown command: ${command}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Unknown option|Unexpected argument|parseArgs/i.test(msg) || /unknown option/i.test(msg)) {
      return { code: 2, error: msg };
    }
    return { code: 1, error: msg };
  }
}

function printHelp(): void {
  process.stdout.write(`anybot — run a team of agents from Anytype

Usage:
  anybot init [--org <id>] [--check] [--config path]
  anybot agent create <handle> --harness <id> [options]
  anybot agent list [--org id]
  anybot run [--config path]
  anybot doctor [--org id] [--json]
  anybot version

Config discovery: --config, ANYBOT_CONFIG, ./anybot.config.yaml, ~/.config/anybot/config.yaml
`);
}
