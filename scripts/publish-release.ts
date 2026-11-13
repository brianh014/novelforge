// Publishes package.json's version as a GitHub release from this computer: tags the current commit v<version> if it
// isn't yet, builds the downloads and uploads them with the GitHub CLI (`gh`), signed in as you. A version with a
// hyphen (0.1.0-alpha.1) is a pre-release. The app's Update finds the newest full release (src/updater.ts).
import { readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const run = (...args: string[]) => {
  const done = Bun.spawnSync(args, { cwd: root });
  if (done.exitCode !== 0) throw new Error(`${args.slice(0, 3).join(" ")} failed: ${done.stderr.toString().trim()}`);
  return done.stdout.toString().trim();
};
const git = (...args: string[]) => run("git", ...args);

const { version } = (await Bun.file(join(root, "package.json")).json()) as { version: string };
const tag = `v${version}`;

// The downloads must be the commit the tag names, so nothing unsaved goes into them.
if (git("status", "--porcelain")) throw new Error("Commit or stash your changes first, so the release is the tagged commit.");
const head = git("rev-parse", "HEAD");
const tagged = Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", `${tag}^{commit}`], { cwd: root })
  .stdout.toString()
  .trim();
if (tagged && tagged !== head) throw new Error(`${tag} already names another commit. Raise the version in package.json for a new release.`);

// Before the long build, so a missing sign-in is found at once. A release already there is one an earlier run began.
run("gh", "auth", "status");
const begun = Bun.spawnSync(["gh", "release", "view", tag], { cwd: root }).exitCode === 0;
if (begun && !tagged) throw new Error(`GitHub has a ${tag} release but this computer has no ${tag} tag. Run git fetch --tags first.`);

const built = Bun.spawnSync([process.execPath, "scripts/build-release.ts"], { cwd: root, stdout: "inherit", stderr: "inherit" });
if (built.exitCode !== 0) throw new Error("The build failed, so nothing was published.");

// Only once the build works, so a failed one leaves no tag behind.
if (!tagged) git("tag", "-a", tag, "-m", `NovelForge ${version}`);
git("push", "origin", tag);

const out = join(root, "dist", "release");
const files = readdirSync(out).map((name) => join(out, name));
if (begun) run("gh", "release", "upload", tag, ...files, "--clobber");
else
  run(
    "gh",
    "release",
    "create",
    tag,
    ...files,
    "--verify-tag",
    "--title",
    `NovelForge ${version}`,
    "--generate-notes",
    ...(version.includes("-") ? ["--prerelease"] : []),
  );
console.log(`Published ${tag}${version.includes("-") ? " as a pre-release" : ""}: ${run("gh", "release", "view", tag, "--json", "url", "--jq", ".url")}`);
