import { expect, test } from "bun:test";
import { ART_EXAMPLES } from "../src/web/art-examples";
import { artStyleText, OWN_ART_STYLE, readArtStyle } from "../src/web/art-style-picker";
import { ART_STYLES, withArtStyleFor } from "../src/web/art-styles";

const DIGITAL = "Modern Digital Painting & Concept Art";
const stored = `${DIGITAL}: ${ART_STYLES[DIGITAL]}`;
const qwen = { imageProvider: "local", comfyMode: "simple", comfyFamily: "qwen21" } as const;

test("Qwen Image 2.1 gets its own wording for a named style that it draws wrong", () => {
  const { artStyle } = withArtStyleFor({ artStyle: stored }, qwen);

  expect(artStyle).toStartWith(`${DIGITAL}: High-end digital illustration in the style of ArtStation`);
});

test("the shared wording stays for other families, other ways of drawing, other styles and the player's own words", () => {
  const same = (artStyle: string, settings: Parameters<typeof withArtStyleFor>[1]) =>
    expect(withArtStyleFor({ artStyle }, settings).artStyle).toBe(artStyle);

  same(stored, { ...qwen, comfyFamily: "flux2" });
  same(stored, { ...qwen, comfyMode: "advanced" });
  same(stored, { ...qwen, imageProvider: "openrouter" });
  same(`Cinematic Photorealism: ${ART_STYLES["Cinematic Photorealism"]}`, qwen);
  same("Moody charcoal sketches, like a Modern Digital Painting & Concept Art study", qwen);
});

test("a Save's Art Style reads back as the named style it was saved as, or as the player's own words", () => {
  expect(readArtStyle(artStyleText(DIGITAL, ""))).toEqual({ name: DIGITAL, own: "" });
  expect(readArtStyle("Moody charcoal sketches")).toEqual({ name: OWN_ART_STYLE, own: "Moody charcoal sketches" });
  expect(readArtStyle(`${DIGITAL}: an older description`)).toEqual({ name: OWN_ART_STYLE, own: `${DIGITAL}: an older description` });
});

test("every named Art Style has an example, and a wrong name can't hide one", () => {
  expect(Object.keys(ART_EXAMPLES).toSorted()).toEqual(Object.keys(ART_STYLES).toSorted());
});
