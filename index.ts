import "./src/preact-singleton.ts";
import { resolve } from "node:path";
import {
  ManagementCommandError,
  runManagementCommand,
} from "./src/management-client.ts";
import { startSite } from "./src/server.ts";

const [, , command, ...args] = process.argv;
const root = resolve(readOption(args, "--root") ?? process.cwd());

try {
  if (command === "start") {
    await runStart(root, args);
  } else if (command === "reload" || command === "status") {
    const result = await runManagementCommand(root, command);
    console.log(JSON.stringify(result));
  } else {
    throw new Error(
      "Usage: diitey <start|reload|status> [--root <directory>] [--port <number>]",
    );
  }
} catch (error) {
  if (error instanceof ManagementCommandError) {
    console.log(JSON.stringify(error.result));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}

async function runStart(root: string, args: string[]): Promise<void> {
  const portValue = readOption(args, "--port") ?? "3000";
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid port: ${portValue}`);
  }

  const site = await startSite({ root, port });
  console.log(`Listening on ${site.url.origin}`);

  let stopping = false;
  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    await site.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
