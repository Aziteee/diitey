import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRuntimeInfo } from "./validation.ts";

export interface RuntimeInfo {
  readonly pid: number;
  readonly adminPort: number;
  readonly token: string;
}

const runtimeFileName = "diitey.runtime.json";

export async function writeRuntimeInfo(
  root: string,
  info: RuntimeInfo,
): Promise<void> {
  const dataDirectory = resolve(root, "data");
  const filePath = resolve(dataDirectory, runtimeFileName);
  await mkdir(dataDirectory, { recursive: true });
  try {
    if (process.platform === "win32") {
      await rm(filePath, { force: true });
      await writePrivateWindowsFile(filePath, JSON.stringify(info));
    } else {
      await writeFile(filePath, JSON.stringify(info), {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(filePath, 0o600);
    }
  } catch (error) {
    await rm(filePath, { force: true });
    throw error;
  }
}

export async function readRuntimeInfo(root: string): Promise<RuntimeInfo> {
  const filePath = resolve(root, "data", runtimeFileName);
  let value: string;
  try {
    value = await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`No running Diitey site found for ${root}`);
    }
    throw error;
  }

  return parseRuntimeInfo(JSON.parse(value));
}

export async function removeRuntimeInfo(root: string): Promise<void> {
  await rm(resolve(root, "data", runtimeFileName), { force: true });
}

async function writePrivateWindowsFile(
  filePath: string,
  contents: string,
): Promise<void> {
  const script = `$ErrorActionPreference = 'Stop'; $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl = [System.Security.AccessControl.FileSecurity]::new(); $acl.SetOwner($identity); $acl.SetAccessRuleProtection($true, $false); $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow); $acl.AddAccessRule($rule); $stream = [System.IO.FileStream]::new($env:DIITEY_RUNTIME_FILE, [System.IO.FileMode]::CreateNew, [System.Security.AccessControl.FileSystemRights]::Write, [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::WriteThrough, $acl); try { $encoding = [System.Text.UTF8Encoding]::new($false); $writer = [System.IO.StreamWriter]::new($stream, $encoding); $stream = $null; try { $writer.Write($env:DIITEY_RUNTIME_CONTENT) } finally { $writer.Dispose() } } finally { if ($null -ne $stream) { $stream.Dispose() } }`;
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const child = Bun.spawn(
    ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      stdout: "ignore",
      stderr: "pipe",
      env: {
        ...environment,
        DIITEY_RUNTIME_FILE: filePath,
        DIITEY_RUNTIME_CONTENT: contents,
      },
    },
  );
  const [exitCode, error] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Could not create private runtime information file: ${error.trim()}`,
    );
  }
}
