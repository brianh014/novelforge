// Tries the Menu's Install on this computer, with no GitHub: builds this code as an "old" 0.0.1 copy and as the new
// version, serves a stand-in release of the new one, and starts the old one with --fake on port 4660. Choose Install
// in its notice, and it should come back as the new version. Ctrl+C stops both.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { downloadName } from "../src/updater";
import { tarGz, zip } from "./zip";

const root = join(import.meta.dir, "..");
const work = join(root, "dist", "try-update");
const exe = process.platform === "win32" ? "NovelForge.exe" : "NovelForge";
const asset = downloadName();
if (!asset) throw new Error("There's no download for this system.");

rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "app"), { recursive: true });

const build = async (outfile: string) => {
  const done = Bun.spawn([process.execPath, "build", "src/main.ts", "--compile", "--production", "--outfile", outfile], { cwd: root, stdout: "ignore" });
  if ((await done.exited) !== 0) throw new Error("The build failed.");
};

const packageJson = join(root, "package.json");
const original = await Bun.file(packageJson).text();
const { version } = JSON.parse(original) as { version: string };
console.log(`Building the new version, ${version}…`);
await build(join(work, exe));
console.log("Building an old copy, 0.0.1…");
try {
  // The version is built in from package.json, so the old copy is built from a changed one, put back straight after.
  await Bun.write(packageJson, original.replace(`"version": "${version}"`, '"version": "0.0.1"'));
  await build(join(work, "app", exe));
} finally {
  await Bun.write(packageJson, original);
}

const program = new Uint8Array(await Bun.file(join(work, exe)).arrayBuffer());
const download = asset.endsWith(".zip") ? zip(exe, program) : tarGz([{ name: exe, data: program, mode: 0o755 }]);
const release = Bun.serve({
  port: 0,
  fetch: (req) =>
    new URL(req.url).pathname === "/latest"
      ? Response.json({
          tag_name: `v${version}`,
          html_url: "https://github.com/brianh014/novelforge/releases",
          body: "A stand-in release from scripts/try-update.ts.",
          assets: [{ name: asset, browser_download_url: new URL(`/${asset}`, req.url).href }],
        })
      : new Response(download),
});

console.log(`Starting the old copy on http://127.0.0.1:4660/ from ${join(work, "app")}`);
Bun.spawn([join(work, "app", exe), "--fake"], {
  cwd: join(work, "app"),
  env: { ...process.env, PORT: "4660", NOVELFORGE_LATEST_RELEASE: new URL("/latest", release.url).href },
  stdio: ["ignore", "inherit", "inherit"],
});
