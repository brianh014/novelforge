import { chmodSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { z } from "zod";
import { version } from "../package.json";
import { errorFields, log } from "./logger";

/** Finds a new version on GitHub, and puts a download's program in place of this one. */

export const VERSION = version;
export const LATEST_RELEASE = "https://api.github.com/repos/brianh014/novelforge/releases/latest";

// Under `bun run`, execPath is Bun itself, which must never be replaced.
export const isCompiled = basename(process.execPath, ".exe") !== "bun";

export class UpdateFailed extends Error {}

const Release = z.object({
  tag_name: z.string().regex(/^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/),
  html_url: z.url(),
  body: z.string().nullish(),
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.url() })),
});
type Release = z.infer<typeof Release>;

const CHECK_EVERY_MS = 6 * 60 * 60_000;
const RETRY_FAILED_CHECK_MS = 10 * 60_000;
const HEADERS = { Accept: "application/vnd.github+json", "User-Agent": "NovelForge" };

/** Whether version `a` comes after `b`, as semver orders them: 0.1.0 after 0.1.0-alpha.4, and alpha.10 after alpha.9. */
export function isNewer(a: string, b: string) {
  const parts = (v: string) => {
    const at = v.indexOf("-");
    return { core: (at < 0 ? v : v.slice(0, at)).split(".").map(Number), pre: at < 0 ? [] : v.slice(at + 1).split(".") };
  };
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return (x.core[i] ?? 0) > (y.core[i] ?? 0);
  // A pre-release comes before its release.
  if (!x.pre.length || !y.pre.length) return !x.pre.length && y.pre.length > 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === q) continue;
    if (p === undefined || q === undefined) return q === undefined;
    return /^\d+$/.test(p) && /^\d+$/.test(q) ? Number(p) > Number(q) : p > q;
  }
  return false;
}

/** The download this copy came from, as scripts/build-release.ts names them. The Server's build defines NOVELFORGE_MODE. */
export function downloadName(platform = process.platform, arch = process.arch, server = process.env.NOVELFORGE_MODE === "server") {
  const system =
    platform === "win32"
      ? "Windows.zip"
      : platform === "darwin"
        ? `Mac-${arch === "arm64" ? "AppleSilicon" : "Intel"}.tar.gz`
        : platform === "linux" && arch === "x64"
          ? "Linux.tar.gz"
          : undefined;
  return system && `${server ? "NovelForge-Server" : "NovelForge"}-${system}`;
}

/** The program inside a download: a .zip of one file, or a .tar.gz whose biggest file is the program (a Mac app's is beside its Info.plist). */
export function unpack(name: string, archive: Uint8Array) {
  const bytes = Buffer.from(archive);
  if (name.endsWith(".zip")) {
    if (bytes.readUInt32LE(0) !== 0x04034b50 || bytes.readUInt16LE(8) !== 8) throw new UpdateFailed("The download isn't the zip NovelForge expected.");
    const start = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
    const program = new Uint8Array(inflateRawSync(bytes.subarray(start, start + bytes.readUInt32LE(18))));
    if (Bun.hash.crc32(program) !== bytes.readUInt32LE(14)) throw new UpdateFailed("The download was damaged. Try again.");
    return program;
  }
  // gzip checks its own CRC.
  const tar = Buffer.from(Bun.gunzipSync(bytes));
  let program: Uint8Array | undefined;
  for (let at = 0; at + 512 <= tar.length && tar[at] !== 0; ) {
    const size =
      Number.parseInt(
        tar
          .subarray(at + 124, at + 136)
          .toString()
          .replace(/\0/g, "")
          .trim(),
        8,
      ) || 0;
    const isFile = tar[at + 156] === 0x30 || tar[at + 156] === 0;
    if (isFile && size > (program?.length ?? 0)) program = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  if (!program?.length) throw new UpdateFailed("The download held no program.");
  return new Uint8Array(program);
}

/** The program a past update replaced, kept beside this one in case the new one failed to start. Named by version, so a chain of updates never collides. */
const replaced = (from: string) => `${process.execPath}.${from}.old`;

/** Clears the programs earlier updates replaced. Only on a start of its own, as a just-updated one's parent may still be running its old program. */
export function removeReplacedPrograms() {
  if (!isCompiled || process.env.NOVELFORGE_UPDATED) return;
  const name = basename(process.execPath);
  for (const file of readdirSync(dirname(process.execPath))) {
    if (!file.startsWith(`${name}.`) || !file.endsWith(".old")) continue;
    try {
      rmSync(join(dirname(process.execPath), file), { force: true });
    } catch {
      // Still running somewhere, and the next start clears it.
    }
  }
}

export function updater(latestRelease = LATEST_RELEASE) {
  let checked: { at: number; release?: Release; failed?: boolean } | undefined;

  async function latest() {
    if (checked && Date.now() - checked.at < (checked.failed ? RETRY_FAILED_CHECK_MS : CHECK_EVERY_MS)) return checked.release;
    try {
      const response = await fetch(latestRelease, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
      // 404 is a repository with no release yet.
      checked = { at: Date.now(), release: response.ok ? Release.parse(await response.json()) : undefined, failed: !response.ok && response.status !== 404 };
    } catch (error) {
      // Offline is normal, and play goes on.
      log.info("update", "Couldn't check for a new version", errorFields(error));
      checked = { at: Date.now(), failed: true };
    }
    return checked.release;
  }

  async function newer() {
    const release = await latest();
    return release && isNewer(release.tag_name.slice(1), VERSION) ? release : undefined;
  }

  const download = (release: Release) => isCompiled && release.assets.find(({ name }) => name === downloadName());

  return {
    async status() {
      const release = await newer();
      return {
        version: VERSION,
        latest: release && { version: release.tag_name.slice(1), url: release.html_url, notes: (release.body ?? "").slice(0, 4000) },
        installable: !!release && !!download(release),
      };
    },

    /** Puts the new program where this one is, keeping this one beside it. The caller restarts with `relaunch`. */
    async install() {
      const release = await newer();
      if (!release) throw new UpdateFailed("There's no newer version.");
      const asset = download(release);
      if (!asset) throw new UpdateFailed("This copy can't update itself. Download the new version from its page.");
      const response = await fetch(asset.browser_download_url, { headers: { "User-Agent": HEADERS["User-Agent"] }, signal: AbortSignal.timeout(10 * 60_000) });
      if (!response.ok) throw new UpdateFailed(`The download failed (${response.status}). Try again later.`);
      const program = unpack(asset.name, new Uint8Array(await response.arrayBuffer()));
      // A running program can be renamed on every system, though Windows won't let it be overwritten.
      const old = replaced(VERSION);
      rmSync(old, { force: true });
      renameSync(process.execPath, old);
      try {
        await Bun.write(process.execPath, program);
        chmodSync(process.execPath, 0o755);
      } catch (error) {
        renameSync(old, process.execPath);
        throw error;
      }
      log.startup(`Updated to ${release.tag_name}, restarting`);
      return { version: release.tag_name.slice(1) };
    },
  };
}

const FAILED_START_MS = 30_000;

/**
 * Starts the new program in this one's place, once this server has stopped, and waits on it so a terminal, systemd
 * or the Windows console still holds it. A new program that fails at once is swapped back for the old one.
 * shortcut: each update leaves its parent waiting, a few MB each, until the next stop; exec in place if Bun gains it.
 */
export async function relaunch() {
  const start = () =>
    Bun.spawn([process.execPath, ...process.argv.slice(2)], {
      stdio: ["inherit", "inherit", "inherit"],
      // The page already open reloads itself, so no new tab.
      env: { ...process.env, NO_BROWSER: "1", NOVELFORGE_UPDATED: "1" },
    });
  const began = Date.now();
  let code = await start().exited;
  if (code !== 0 && Date.now() - began < FAILED_START_MS) {
    log.error("update", "The new version failed to start, so the old one is back", { code });
    renameSync(replaced(VERSION), process.execPath);
    code = await start().exited;
  }
  process.exit(code);
}
