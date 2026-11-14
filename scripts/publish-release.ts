// Publishes package.json's version: tags the current commit v<version> and pushes the tag, and GitHub's Release workflow
// (.github/workflows/release.yml) builds the downloads and publishes them. A version with a hyphen (0.1.0-alpha.1) is a
// pre-release. The app's Update finds the newest full release (src/updater.ts).
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const git = (...args: string[]) => {
  const done = Bun.spawnSync(["git", ...args], { cwd: root });
  if (done.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${done.stderr.toString().trim()}`);
  return done.stdout.toString().trim();
};

const { version } = (await Bun.file(join(root, "package.json")).json()) as { version: string };
const tag = `v${version}`;

// The release is built from the tagged commit, so it must be the one on GitHub's main, with nothing unsaved.
if (git("status", "--porcelain")) throw new Error("Commit or stash your changes first, so the release is the tagged commit.");
git("fetch", "origin", "main", "--tags");
const head = git("rev-parse", "HEAD");
if (head !== git("rev-parse", "origin/main")) throw new Error("Release from main as it is on GitHub: switch to main and pull first.");
const tagged = Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", `${tag}^{commit}`], { cwd: root })
  .stdout.toString()
  .trim();
if (tagged && tagged !== head) throw new Error(`${tag} already names another commit. Raise the version in package.json for a new release.`);

if (!tagged) git("tag", "-a", tag, "-m", `NovelForge ${version}`);
git("push", "origin", tag);
console.log(`Pushed ${tag}. GitHub builds and publishes it: https://github.com/brianh014/novelforge/actions/workflows/release.yml`);
