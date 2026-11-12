// Makes a NovelForge shortcut with the app's icon that runs scripts/launch.ts in a terminal window:
// on the desktop (Windows), in ~/Applications (macOS) or in the app menu (Linux). Run it again if the project moves.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const bun = process.execPath; // absolute, since shortcuts don't get the shell's PATH
const launch = join(repo, "scripts", "launch.ts");
const icon = (ext: string) => join(repo, "src", "web", `icon.${ext}`);

function run(command: string, ...args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} failed`);
}

let made: string;
if (process.platform === "win32") {
  const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  made = "NovelForge on the desktop";
  run(
    "powershell",
    "-NoProfile",
    "-Command",
    [
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'NovelForge.lnk'))`,
      `$s.TargetPath = ${quote(bun)}`,
      `$s.Arguments = ${quote(`"${launch}"`)}`,
      `$s.WorkingDirectory = ${quote(repo)}`,
      `$s.IconLocation = ${quote(icon("ico"))}`,
      `$s.Save()`,
    ].join("; "),
  );
} else if (process.platform === "darwin") {
  made = join(homedir(), "Applications", "NovelForge.app");
  const contents = join(made, "Contents");
  mkdirSync(join(contents, "MacOS"), { recursive: true });
  mkdirSync(join(contents, "Resources"), { recursive: true });
  writeFileSync(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>NovelForge</string>
  <key>CFBundleIdentifier</key><string>local.novelforge.launcher</string>
  <key>CFBundleExecutable</key><string>NovelForge</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`,
  );
  // Terminal shows the server's log, and closing its window stops the server, as on the other systems.
  const shell = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  writeFileSync(
    join(contents, "Resources", "open.applescript"),
    `tell application "Terminal"
  do script ${JSON.stringify(`${shell(bun)} ${shell(launch)}`)}
  activate
end tell
`,
  );
  const executable = join(contents, "MacOS", "NovelForge");
  writeFileSync(executable, `#!/bin/sh\nexec osascript "$(dirname "$0")/../Resources/open.applescript"\n`);
  chmodSync(executable, 0o755);
  run("sips", "-s", "format", "icns", icon("png"), "--out", join(contents, "Resources", "icon.icns"));
} else {
  const apps = join(homedir(), ".local", "share", "applications");
  made = join(apps, "novelforge.desktop");
  mkdirSync(apps, { recursive: true });
  writeFileSync(
    made,
    `[Desktop Entry]
Type=Application
Name=NovelForge
Exec="${bun}" "${launch}"
Path=${repo}
Icon=${icon("svg")}
Terminal=true
Categories=Game;
`,
  );
}
console.log(`Made ${made}.`);
