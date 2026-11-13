// Builds the downloads into dist/release, one file per system, in two sets:
// - The app: opens NovelForge in the browser with no terminal, for this computer only, and the Menu's Quit ends it.
// - The Server: serves the whole network from a terminal window, which shows its log, and closing it stops the server.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tarGz, zip } from "./zip";

const root = join(import.meta.dir, "..");
const out = join(root, "dist", "release");
const work = join(root, "dist", "release-work");
rmSync(out, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(work, { recursive: true });

async function compile(target: string, outfile: string, server: boolean, ...extra: string[]) {
  // A define, so the download needs no flag to start as a server. src/main.ts reads it.
  const mode = server ? ["--define", 'process.env.NOVELFORGE_MODE="server"'] : [];
  const build = Bun.spawn(
    [process.execPath, "build", "src/main.ts", "--compile", "--production", `--target=${target}`, ...mode, ...extra, "--outfile", outfile],
    { cwd: root },
  );
  if ((await build.exited) !== 0) throw new Error(`The ${target} build failed`);
  return new Uint8Array(await Bun.file(outfile).arrayBuffer());
}

/** An .icns holding the 256px PNG, which macOS reads as it is. */
function icns(png: Uint8Array) {
  const head = Buffer.alloc(16);
  head.write("icns", 0);
  head.writeUInt32BE(16 + png.length, 4);
  head.write("ic08", 8);
  head.writeUInt32BE(8 + png.length, 12);
  return Buffer.concat([head, png]);
}

const text = (s: string) => new TextEncoder().encode(s);
const png = new Uint8Array(await Bun.file(join(root, "src", "web", "icon.png")).arrayBuffer());
const ico = join(root, "src", "web", "icon.ico");

for (const server of [false, true]) {
  const name = server ? "NovelForge-Server" : "NovelForge";
  const appName = server ? "NovelForge Server" : "NovelForge";

  // The app hides its console. The Server keeps it, as its window holds the log and closing it stops the server.
  const windows = await compile(
    "bun-windows-x64",
    join(work, `${name}-Windows.exe`),
    server,
    `--windows-icon=${ico}`,
    ...(server ? [] : ["--windows-hide-console"]),
  );
  await Bun.write(join(out, `${name}-Windows.zip`), zip(`${appName}.exe`, windows));

  for (const [arch, label] of [
    ["arm64", "AppleSilicon"],
    ["x64", "Intel"],
  ] as const) {
    const program = await compile(`bun-darwin-${arch}`, join(work, `${name}-darwin-${arch}`), server);
    const app = `${appName}.app/Contents`;
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>${appName}</string>
  <key>CFBundleDisplayName</key><string>${appName}</string>
  <key>CFBundleIdentifier</key><string>local.novelforge${server ? ".server" : ""}</string>
  <key>CFBundleExecutable</key><string>${server ? "open-in-terminal" : "NovelForge"}</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <!-- No Dock icon, as the app's only window is the browser, and the Server's is Terminal. -->
  <key>LSUIElement</key><true/>
</dict></plist>
`;
    // The Server opens in Terminal, which shows its log, and closing it stops the server.
    const opener = `#!/bin/sh
here="$(cd "$(dirname "$0")" && pwd)"
exec osascript -e 'on run argv' -e 'tell application "Terminal"' -e 'do script quoted form of item 1 of argv' -e 'activate' -e 'end tell' -e 'end run' "$here/NovelForge"
`;
    await Bun.write(
      join(out, `${name}-Mac-${label}.tar.gz`),
      tarGz([
        { name: `${appName}.app/`, mode: 0o755 },
        { name: `${app}/`, mode: 0o755 },
        { name: `${app}/Info.plist`, data: text(plist), mode: 0o644 },
        { name: `${app}/MacOS/`, mode: 0o755 },
        { name: `${app}/MacOS/NovelForge`, data: program, mode: 0o755 },
        ...(server ? [{ name: `${app}/MacOS/open-in-terminal`, data: text(opener), mode: 0o755 }] : []),
        { name: `${app}/Resources/`, mode: 0o755 },
        { name: `${app}/Resources/icon.icns`, data: icns(png), mode: 0o644 },
      ]),
    );
  }

  const linux = await compile("bun-linux-x64", join(work, `${name}-linux`), server);
  await Bun.write(join(out, `${name}-Linux.tar.gz`), tarGz([{ name, data: linux, mode: 0o755 }]));
}

rmSync(work, { recursive: true, force: true });
console.log(`Built the downloads in ${out}`);
