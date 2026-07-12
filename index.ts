import { resolve } from "node:path";
import { startSite } from "./src/server.ts";

const [, , command, ...args] = process.argv;

if (command !== "start") {
  console.error("Usage: diitey start [--root <directory>] [--port <number>]");
  process.exit(1);
}

const root = resolve(readOption(args, "--root") ?? process.cwd());
const portValue = readOption(args, "--port") ?? "3000";
const port = Number(portValue);

if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  console.error(`Invalid port: ${portValue}`);
  process.exit(1);
}

try {
  const server = await startSite({ root, port });
  console.log(`Listening on ${server.url.origin}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
