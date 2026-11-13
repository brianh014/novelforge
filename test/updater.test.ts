import { afterAll, expect, test } from "bun:test";
import { tarGz, zip } from "../scripts/zip";
import { downloadName, isNewer, UpdateFailed, unpack, updater, VERSION } from "../src/updater";

const program = new TextEncoder().encode("the program ".repeat(500));

let release: object | undefined;
const github = Bun.serve({
  port: 0,
  fetch: () => (release ? Response.json(release) : Response.json({ message: "Not Found" }, { status: 404 })),
});
afterAll(() => github.stop(true));

test("versions order as semver, with a release after its pre-releases", () => {
  expect(isNewer("0.1.0", "0.1.0-alpha.4")).toBe(true);
  expect(isNewer("0.1.0-alpha.10", "0.1.0-alpha.9")).toBe(true);
  expect(isNewer("0.2.0-alpha.1", "0.1.9")).toBe(true);
  expect(isNewer("0.1.0", "0.1.0")).toBe(false);
  expect(isNewer("0.1.0-alpha.4", "0.1.0")).toBe(false);
  expect(isNewer("0.1.0-beta", "0.1.0-alpha.9")).toBe(true);
  expect(isNewer("1.0.0", "0.9.9")).toBe(true);
});

test("each copy looks for the download it came from", () => {
  expect(downloadName("win32", "x64", false)).toBe("NovelForge-Windows.zip");
  expect(downloadName("darwin", "arm64", true)).toBe("NovelForge-Server-Mac-AppleSilicon.tar.gz");
  expect(downloadName("darwin", "x64", false)).toBe("NovelForge-Mac-Intel.tar.gz");
  expect(downloadName("linux", "x64", true)).toBe("NovelForge-Server-Linux.tar.gz");
  expect(downloadName("linux", "arm64", false)).toBeUndefined();
});

test("the program comes out of a Windows zip and a Mac or Linux tar.gz whole", () => {
  expect(unpack("NovelForge-Windows.zip", zip("NovelForge.exe", program))).toEqual(program);
  const mac = tarGz([
    { name: "NovelForge.app/", mode: 0o755 },
    { name: "NovelForge.app/Contents/Info.plist", data: new TextEncoder().encode("<plist/>"), mode: 0o644 },
    { name: "NovelForge.app/Contents/MacOS/NovelForge", data: program, mode: 0o755 },
  ]);
  expect(unpack("NovelForge-Mac-Intel.tar.gz", mac)).toEqual(program);

  const damaged = zip("NovelForge.exe", program);
  damaged[14] = (damaged[14] ?? 0) ^ 0xff;
  expect(() => unpack("NovelForge-Windows.zip", damaged)).toThrow(UpdateFailed);
});

test("a newer release on GitHub is offered, and an older or missing one isn't", async () => {
  const latest = `http://127.0.0.1:${github.port}/`;
  expect(await updater(latest).status()).toEqual({ version: VERSION, latest: undefined, installable: false });

  release = { tag_name: "v99.0.0", html_url: "https://github.com/brianh014/novelforge/releases/tag/v99.0.0", body: "New things", assets: [] };
  const updates = updater(latest);
  expect(await updates.status()).toEqual({
    version: VERSION,
    latest: { version: "99.0.0", url: "https://github.com/brianh014/novelforge/releases/tag/v99.0.0", notes: "New things" },
    // Tests run from source, which updates with git, not by replacing Bun.
    installable: false,
  });
  await expect(updates.install()).rejects.toThrow("can't update itself");

  release = { ...release, tag_name: `v${VERSION}` };
  expect((await updater(latest).status()).latest).toBeUndefined();
});
