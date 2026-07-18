import { readRuntimeInfo } from "./runtime-info.ts";

export type ManagementCommand = "reload" | "status";

export class ManagementCommandError extends Error {
  constructor(readonly result: unknown) {
    super("Management command failed");
  }
}

export async function runManagementCommand(
  root: string,
  command: ManagementCommand,
  options: { readonly ensureContentFields?: boolean } = {},
): Promise<unknown> {
  const info = await readRuntimeInfo(root);
  assertProcessIsRunning(info.pid);

  const headers: Record<string, string> = {
    authorization: `Bearer ${info.token}`,
  };
  let requestBody: string | undefined;
  if (command === "reload" && options.ensureContentFields === true) {
    headers["content-type"] = "application/json";
    requestBody = JSON.stringify({ ensureContentFields: true });
  }

  const response = await fetch(
    `http://127.0.0.1:${info.adminPort}/_system/${command}`,
    {
      method: command === "reload" ? "POST" : "GET",
      headers,
      body: requestBody,
    },
  );
  const responseBody = await response.text();
  if (!response.ok) {
    let result: unknown;
    try {
      result = JSON.parse(responseBody) as unknown;
    } catch {
      throw new Error(
        `Management ${command} failed (${response.status}): ${responseBody}`,
      );
    }
    throw new ManagementCommandError(result);
  }
  return JSON.parse(responseBody) as unknown;
}

function assertProcessIsRunning(pid: number): void {
  try {
    process.kill(pid, 0);
  } catch {
    throw new Error(`Diitey process ${pid} is not running`);
  }
}
