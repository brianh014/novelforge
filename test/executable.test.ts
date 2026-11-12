import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { delta, fakeOpenAi, postJson, tempFolder } from "./support";

const folder = tempFolder();
const executable = join(folder.path, process.platform === "win32" ? "novelforge.exe" : "novelforge");
const provider = fakeOpenAi([[delta(JSON.stringify({ narration: "The tide rises." }))]]);

// Loopback, as Windows Firewall asks about every new executable that opens a network port, and each run builds a new one.
async function launch() {
  const app = Bun.spawn([executable], { cwd: folder.path, env: { ...process.env, PORT: "0", HOST: "127.0.0.1", NO_BROWSER: "1" }, stdout: "pipe" });
  const { value } = await app.stdout.getReader().read();
  const url = new TextDecoder().decode(value).match(/http:\S+/)![0];
  return { app, url: new URL(url) };
}

beforeAll(async () => {
  await Bun.write(
    join(folder.path, "settings.json"),
    JSON.stringify({ textBaseUrl: provider.baseUrl, textModel: "fake/model" }),
  );
  const build = Bun.spawn([process.execPath, "build", "src/main.ts", "--compile", "--production", "--outfile", executable], {
    stdout: "ignore",
  });
  expect(await build.exited).toBe(0);
}, 60_000);

afterAll(() => {
  provider.stop();
  folder.remove();
});

test("the compiled app plays a Turn, keeps it through a kill, and stores the Save next to itself", async () => {
  const first = await launch();
  const created = await postJson(new URL("/saves", first.url), { worldBrief: "A drowned city", pc: { name: "Ash" } });
  const { id } = (await created.json()) as { id: string };
  expect(await fetch(new URL("/settings", first.url)).then((r) => r.json())).toMatchObject({ defaultLogLevel: "warning", logLevel: null });
  await postJson(new URL(`/saves/${id}/turns`, first.url), { input: "I wade forward." });
  first.app.kill(9);
  await first.app.exited;

  const second = await launch();
  const { messages } = (await fetch(new URL(`/saves/${id}/messages`, second.url)).then((r) => r.json())) as {
    messages: { role: string }[];
  };
  second.app.kill();
  await second.app.exited;

  expect(messages.map((m) => m.role)).toEqual(["player", "narrator"]);
  expect(provider.requests).toHaveLength(1);
  expect(readdirSync(join(folder.path, "Saves"))).toEqual([`${id}.sqlite`]);
}, 30_000);

test("the compiled app serves the SPA from inside itself", async () => {
  const { app, url } = await launch();
  const page = await fetch(url).then((r) => r.text());
  const assets = [...page.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]!);
  const responses = await Promise.all(assets.map((asset) => fetch(new URL(asset, url))));
  const script = await responses[assets.findIndex((asset) => asset.endsWith(".js"))]!.text();
  app.kill();
  await app.exited;

  expect(page).toContain('<div id="root">');
  expect(assets.some((asset) => asset.endsWith(".css"))).toBe(true);
  expect(responses.map((response) => response.status)).toEqual(assets.map(() => 200));
  expect(script).toContain("Main Menu");
});

test("the compiled app offers Quit, which ends it", async () => {
  const { app, url } = await launch();
  expect(await fetch(new URL("/settings", url)).then((r) => r.json())).toMatchObject({ canQuit: true });
  expect((await fetch(new URL("/quit", url), { method: "POST" })).status).toBe(204);
  expect(await app.exited).toBe(0);
});

// Through Bun, one program the firewall asks about once. It reads what the app says rather than connecting, as whether
// a connection gets through depends on the firewall's rules for each network, not on the app.
test("the app listens on the LAN by default", async () => {
  const { HOST: _, ...env } = process.env;
  const app = Bun.spawn([process.execPath, "run", join(import.meta.dir, "../src/main.ts")], {
    cwd: folder.path,
    env: { ...env, PORT: "0" },
    stdout: "pipe",
    timeout: 10_000,
  });
  const lanAddress = Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === "IPv4" && !address.internal)?.address;

  let printed = "";
  for await (const part of app.stdout) {
    printed += new TextDecoder().decode(part);
    if (printed.includes(`http://${lanAddress}:`) || !lanAddress) break;
  }
  app.kill();
  await app.exited;

  if (lanAddress) expect(printed).toContain(`On your network: http://${lanAddress}:`);
}, 15_000);
