// Publishes package.json's version as a Gitea release from this computer: tags the current commit v<version> if it
// isn't yet, builds the downloads and uploads them. A version with a hyphen (0.1.0-alpha.1) is a pre-release.
// Signs in with the login git pushes with, from git's credential helper, or with an access token in GITEA_TOKEN if
// that is set. Either is only ever sent to the origin's Gitea.
import { readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const git = (...args: string[]) => {
  const run = Bun.spawnSync(["git", ...args], { cwd: root });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr.toString().trim()}`);
  return run.stdout.toString().trim();
};

const { version } = (await Bun.file(join(root, "package.json")).json()) as { version: string };
const tag = `v${version}`;

// The downloads must be the commit the tag names, so nothing unsaved goes into them.
if (git("status", "--porcelain")) throw new Error("Commit or stash your changes first, so the release is the tagged commit.");
const head = git("rev-parse", "HEAD");
const tagged = Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", `${tag}^{commit}`], { cwd: root })
  .stdout.toString()
  .trim();
if (tagged && tagged !== head) throw new Error(`${tag} already names another commit. Raise the version in package.json for a new release.`);

// https://host/owner/repo(.git), the form `git remote get-url` gives for an HTTPS remote.
const remote = git("remote", "get-url", "origin").match(/^(https:\/\/[^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
if (!remote) throw new Error("The origin remote isn't an https://host/owner/repo address.");
const api = `${remote[1]}/api/v1/repos/${remote[2]}/${remote[3]}`;
const headers = { Authorization: authorization(new URL(remote[1]!).host) };

/** Gitea takes the username and token, or password, that git pushes with as Basic auth on its API too. */
function authorization(host: string) {
  if (process.env.GITEA_TOKEN) return `token ${process.env.GITEA_TOKEN}`;
  const fill = Bun.spawnSync(["git", "credential", "fill"], { cwd: root, stdin: Buffer.from(`protocol=https\nhost=${host}\n\n`) });
  const fields = Object.fromEntries(
    fill.stdout
      .toString()
      .split("\n")
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  if (fill.exitCode !== 0 || !fields.username || !fields.password) throw new Error(`git has no login for ${host}. Push once to save one, or set GITEA_TOKEN.`);
  return `Basic ${btoa(`${fields.username}:${fields.password}`)}`;
}

async function gitea(path: string, init: RequestInit = {}) {
  const response = await fetch(`${api}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  // Gitea's message only, which never holds the token.
  if (!response.ok) throw new Error(`Gitea answered ${response.status} to ${path}: ${await response.text()}`);
  return response.json() as Promise<{ id: number; html_url?: string; assets?: { name: string }[] }>;
}

// Before the long build, so a login Gitea refuses is found at once. A release already there is one an earlier run
// began, as its tag names this commit, so this run finishes it rather than starting another.
const existing = await fetch(`${api}/releases/tags/${tag}`, { headers });
if (!existing.ok && existing.status !== 404) {
  throw new Error(`Gitea answered ${existing.status} when asked for releases: check the login, or set GITEA_TOKEN.`);
}
const begun = existing.ok ? ((await existing.json()) as Awaited<ReturnType<typeof gitea>>) : undefined;
if (begun && !tagged) throw new Error(`Gitea has a ${tag} release but this computer has no ${tag} tag. Fetch the tags first.`);

const built = Bun.spawnSync([process.execPath, "scripts/build-release.ts"], { cwd: root, stdout: "inherit", stderr: "inherit" });
if (built.exitCode !== 0) throw new Error("The build failed, so nothing was published.");

// Only once the build works, so a failed one leaves no tag behind.
if (!tagged) git("tag", "-a", tag, "-m", `NovelForge ${version}`);
git("push", "origin", tag);

const release =
  begun ??
  (await gitea("/releases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag_name: tag, name: `NovelForge ${version}`, prerelease: version.includes("-") }),
  }));
const uploaded = new Set(release.assets?.map(({ name }) => name));
const out = join(root, "dist", "release");
for (const name of readdirSync(out)) {
  if (uploaded.has(name)) {
    console.log(`Already there: ${name}`);
    continue;
  }
  console.log(`Uploading ${name}`);
  const form = new FormData();
  form.append("attachment", Bun.file(join(out, name)), name);
  await gitea(`/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, { method: "POST", body: form });
}
console.log(`Published ${tag}${version.includes("-") ? " as a pre-release" : ""}: ${release.html_url ?? api}`);
