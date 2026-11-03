import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { delta, fakeOpenAi, postJson, tempFolder } from "./support";

const folder = tempFolder();
const executable = join(folder.path, process.platform === "win32" ? "novelforge.exe" : "novelforge");
const provider = fakeOpenAi([[delta(JSON.stringify({ narration: "The tide rises." }))]]);

async function launch() {
  const app = Bun.spawn([executable], { env: { ...process.env, PORT: "0" }, stdout: "pipe" });
  const { value } = await app.stdout.getReader().read();
  const url = new TextDecoder().decode(value).match(/http:\S+/)![0];
  return { app, url: new URL(url) };
}

beforeAll(async () => {
  await Bun.write(
    join(folder.path, "settings.json"),
    JSON.stringify({ textBaseUrl: provider.baseUrl, textModel: "fake/model" }),
  );
  const build = Bun.spawn([process.execPath, "build", "src/main.ts", "--compile", "--outfile", executable], {
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

test("the compiled app listens on localhost only", async () => {
  const { app, url } = await launch();
  const lanAddress = Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === "IPv4" && !address.internal)?.address;
  const reachable = async (host: string) =>
    fetch(`http://${host}:${url.port}/saves`).then(
      () => true,
      () => false,
    );

  const local = await reachable("127.0.0.1");
  const lan = lanAddress ? await reachable(lanAddress) : false;
  app.kill();
  await app.exited;

  expect(local).toBe(true);
  expect(lan).toBe(false);
});
