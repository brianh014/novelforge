// Builds the downloads into dist/release, one file per system. Each is the app: it opens NovelForge in the browser
// with no terminal, and the Menu's Quit ends it. The server is scripts/launch.ts instead.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const out = join(root, "dist", "release");
const work = join(root, "dist", "release-work");
rmSync(out, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(work, { recursive: true });

async function compile(target: string, outfile: string, ...extra: string[]) {
  const build = Bun.spawn([process.execPath, "build", "src/main.ts", "--compile", "--production", `--target=${target}`, ...extra, "--outfile", outfile], { cwd: root });
  if ((await build.exited) !== 0) throw new Error(`The ${target} build failed`);
  return new Uint8Array(await Bun.file(outfile).arrayBuffer());
}

type Entry = { name: string; data?: Uint8Array; mode: number };

/** A .tar.gz, as it keeps the run permission a Mac or Linux program needs, which a download alone loses. */
function tarGz(entries: Entry[]) {
  const blocks: Uint8Array[] = [];
  for (const { name, data, mode } of entries) {
    const header = new Uint8Array(512);
    const put = (text: string, at: number) => header.set(new TextEncoder().encode(text), at);
    const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, "0");
    put(name, 0);
    put(octal(mode, 8), 100);
    put(octal(0, 8), 108);
    put(octal(0, 8), 116);
    put(octal(data?.length ?? 0, 12), 124);
    put(octal(Math.floor(Date.now() / 1000), 12), 136);
    put(data ? "0" : "5", 156);
    put("ustar\u000000", 257);
    put("        ", 148); // the checksum counts its own field as spaces
    put(`${octal(header.reduce((sum, byte) => sum + byte, 0), 7)}\u0000 `, 148);
    blocks.push(header);
    if (data) blocks.push(data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  return Bun.gzipSync(Buffer.concat(blocks));
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

const png = new Uint8Array(await Bun.file(join(root, "src", "web", "icon.png")).arrayBuffer());

await compile("bun-windows-x64", join(out, "NovelForge-Windows.exe"), `--windows-icon=${join(root, "src", "web", "icon.ico")}`, "--windows-hide-console");

for (const [arch, label] of [["arm64", "AppleSilicon"], ["x64", "Intel"]] as const) {
  const program = await compile(`bun-darwin-${arch}`, join(work, `novelforge-darwin-${arch}`));
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>NovelForge</string>
  <key>CFBundleDisplayName</key><string>NovelForge</string>
  <key>CFBundleIdentifier</key><string>local.novelforge</string>
  <key>CFBundleExecutable</key><string>NovelForge</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <!-- No Dock icon, as the app's only window is the browser. -->
  <key>LSUIElement</key><true/>
</dict></plist>
`;
  await Bun.write(join(out, `NovelForge-Mac-${label}.tar.gz`), tarGz([
    { name: "NovelForge.app/", mode: 0o755 },
    { name: "NovelForge.app/Contents/", mode: 0o755 },
    { name: "NovelForge.app/Contents/Info.plist", data: new TextEncoder().encode(plist), mode: 0o644 },
    { name: "NovelForge.app/Contents/MacOS/", mode: 0o755 },
    { name: "NovelForge.app/Contents/MacOS/NovelForge", data: program, mode: 0o755 },
    { name: "NovelForge.app/Contents/Resources/", mode: 0o755 },
    { name: "NovelForge.app/Contents/Resources/icon.icns", data: icns(png), mode: 0o644 },
  ]));
}

const linux = await compile("bun-linux-x64", join(work, "novelforge-linux"));
await Bun.write(join(out, "NovelForge-Linux.tar.gz"), tarGz([{ name: "NovelForge", data: linux, mode: 0o755 }]));

rmSync(work, { recursive: true, force: true });
console.log(`Built the downloads in ${out}`);
