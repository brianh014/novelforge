import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/** From quietest to noisiest. Each level includes those before it. */
export const LOG_LEVELS = ["error", "warning", "info", "verbose"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

type Fields = Record<string, unknown>;

const WRITERS = { error: "error", warning: "warn", info: "info", verbose: "debug" } as const;

const MOST_LOG_BYTES = 10 * 1024 * 1024;
const MOST_MESSAGE_CHARS = 300;

// Quiet until the app says which build it is, so the tests aren't flooded.
let buildLevel: LogLevel = "warning";
let chosenLevel: LogLevel | undefined;
let logFile: string | undefined;
let logBytes = 0;
let fileFailed = false;

const context = new AsyncLocalStorage<Fields>();

export const defaultLevelFor = (isCompiled: boolean): LogLevel => (isCompiled ? "warning" : "verbose");

export const defaultLogLevel = () => buildLevel;

/** The saved Log Level, or undefined to follow the build's default. */
export function setLogLevel(level: LogLevel | null | undefined) {
  chosenLevel = level ?? undefined;
}

/** Called first thing, so that no line comes before it. Without a `folder`, nothing goes to a file. */
export function startLog(level: LogLevel, folder?: string) {
  buildLevel = level;
  logFile = folder && join(folder, "novelforge.log");
  fileFailed = false;
  if (!folder || !logFile) return;
  try {
    mkdirSync(folder, { recursive: true });
    logBytes = existsSync(logFile) ? statSync(logFile).size : 0;
  } catch (error) {
    fileFailure(error);
  }
}

/** Every line `run` causes carries `fields`, however deep, without passing them through each call. */
export const withLogContext = <T>(fields: Fields, run: () => T) => context.run(fields, run);

function fileFailure(error: unknown) {
  if (fileFailed) return;
  fileFailed = true;
  console.warn(format("warning", "log", "Can't write the log file, so only the console has this log", errorFields(error)));
}

function toFile(line: string) {
  if (!logFile) return;
  try {
    if (logBytes >= MOST_LOG_BYTES) {
      // Before the rename, so a file that won't rotate is tried again at its next 10 MB, not on every line.
      logBytes = 0;
      renameSync(logFile, `${logFile}.1`);
    }
    // Opened for each line, as Windows won't rename a file another app holds open. Same mode as `settings.json`.
    appendFileSync(logFile, `${line}\n`, { mode: 0o600 });
    logBytes += Buffer.byteLength(line) + 1;
  } catch (error) {
    fileFailure(error);
  }
}

function serialized(fields: Fields) {
  try {
    return JSON.stringify(fields);
  } catch {
    return '{"unserializable":true}';
  }
}

function format(level: LogLevel, area: string, message: string, fields: Fields) {
  return `${new Date().toISOString()} ${level.toUpperCase()} ${area} ${message} ${serialized(fields)}`;
}

function write(writer: "error" | "warn" | "info" | "debug", level: LogLevel, area: string, message: string, fields?: Fields | (() => Fields)) {
  // Nothing here may reach a Turn or a request, whatever a field holds.
  try {
    const line = format(level, area, message, { ...context.getStore(), ...(typeof fields === "function" ? fields() : fields) });
    console[writer](line);
    toFile(line);
  } catch {
    // A log line is never worth a failed Turn.
  }
}

const atLevel = (level: LogLevel) => (area: string, message: string, fields?: Fields | (() => Fields)) => {
  if (LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(chosenLevel ?? buildLevel)) write(WRITERS[level], level, area, message, fields);
};

/** Pass `fields` as a function when they cost anything to build, so a line below the Log Level never builds them. */
export const log = {
  error: atLevel("error"),
  warning: atLevel("warning"),
  info: atLevel("info"),
  verbose: atLevel("verbose"),
  /** Printed whatever the Log Level, or a player on Warning couldn't find the app. */
  startup: (message: string) => write("info", "info", "startup", message),
};

/**
 * An error by its type and status alone, for one whose message can repeat a prompt, as an image provider's can.
 * shortcut: `--production` shortens class names, so a compiled build shows less of the type, add keepNames if a prod log needs it.
 */
export function errorType(error: unknown) {
  const { code, status, constructor: madeBy } = (error ?? {}) as { code?: unknown; status?: unknown; constructor?: { name?: string } };
  return { type: typeof code === "string" ? code : madeBy?.name, ...(typeof status === "number" && { status }) };
}

/** Never `cause`, which can repeat the prompt, nor the parser's message, which quotes the reply. */
export function errorFields(error: unknown) {
  const message = error instanceof SyntaxError ? undefined : (error as Error | undefined)?.message?.slice(0, MOST_MESSAGE_CHARS);
  return { ...errorType(error), ...(message && { message }) };
}
