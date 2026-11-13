// Publishes package.json's version as a Gitea release from this computer: tags the current commit v<version> if it
// isn't yet, builds the downloads and uploads them. A version with a hyphen (0.1.0-alpha.1) is a pre-release.
// Needs a Gitea access token with write:repository in GITEA_TOKEN. It is only ever sent to the origin's Gitea.
import { readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const git = (...args: string[]) => {
  const run = Bun.spawnSync(["git", ...args], { cwd: root });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr.toString().trim()}`);
  return run.stdout.toString().trim();
};

const token = process.env.GITEA_TOKEN;
if (!token) throw new Error("Set GITEA_TOKEN to a Gitea access token with write:repository first.");
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
const headers = { Authorization: `token ${token}` };

async function gitea(path: string, init: RequestInit = {}) {
  const response = await fetch(`${api}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  // Gitea's message only, which never holds the token.
  if (!response.ok) throw new Error(`Gitea answered ${response.status} to ${path}: ${await response.text()}`);
  return response.json() as Promise<{ id: number; html_url?: string; assets?: { name: string }[] }>;
}

const existing = await fetch(`${api}/releases/tags/${tag}`, { headers });
if (existing.ok) throw new Error(`${tag} is already released on Gitea. Raise the version in package.json for a new one.`);

const built = Bun.spawnSync([process.execPath, "scripts/build-release.ts"], { cwd: root, stdout: "inherit", stderr: "inherit" });
if (built.exitCode !== 0) throw new Error("The build failed, so nothing was published.");

// Only once the build works, so a failed one leaves no tag behind.
if (!tagged) git("tag", "-a", tag, "-m", `NovelForge ${version}`);
git("push", "origin", tag);

const release = await gitea("/releases", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tag_name: tag, name: `NovelForge ${version}`, prerelease: version.includes("-") }),
});
const out = join(root, "dist", "release");
for (const name of readdirSync(out)) {
  console.log(`Uploading ${name}`);
  const form = new FormData();
  form.append("attachment", Bun.file(join(out, name)), name);
  await gitea(`/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, { method: "POST", body: form });
}
console.log(`Published ${tag}${version.includes("-") ? " as a pre-release" : ""}: ${release.html_url ?? api}`);
