import { afterEach, expect, test } from "bun:test";
import { imageModelLists } from "../src/image-adapter";

const never = new AbortController().signal;
let stop = () => {};

afterEach(() => stop());

/** Stand-ins for OpenRouter's and Wiro's catalogs, recording whether a key was sent. */
function catalogs(openRouter: () => Response, wiro: () => Response) {
  const keys: (string | null)[] = [];
  const server = Bun.serve({
    port: 0,
    routes: {
      "/or/images/models": (req) => {
        keys.push(req.headers.get("authorization"));
        return openRouter();
      },
      "/wiro/Tool/List": async (req) => {
        keys.push(req.headers.get("x-api-key"));
        expect((await req.json()).categories).toEqual(["text-to-image"]);
        return wiro();
      },
    },
  });
  stop = () => server.stop(true);
  return { keys, list: imageModelLists(new URL("/or", server.url).href, new URL("/wiro", server.url).href) };
}

test("each provider's catalog lists its models by the id the Image model field takes, with no key sent", async () => {
  const { keys, list } = catalogs(
    () => Response.json({ data: [{ id: "bytedance/seedream-5.5" }, { id: 7 }] }),
    () => Response.json({ tool: [{ cleanslugowner: "bytedance", cleanslugproject: "seedream-5-5" }, { cleanslugowner: "broken" }] }),
  );

  expect(await list("openrouter", never)).toEqual(["bytedance/seedream-5.5"]);
  expect(await list("wiro", never)).toEqual(["bytedance/seedream-5-5"]);
  expect(keys).toEqual([null, null]);
});

test("a catalog that fails or answers nonsense lists nothing", async () => {
  const { list } = catalogs(
    () => new Response("down", { status: 503 }),
    () => new Response("not json"),
  );

  expect(await list("openrouter", never)).toEqual([]);
  expect(await list("wiro", never)).toEqual([]);
});
