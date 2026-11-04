import { expect, test } from "bun:test";
import { ART_EXAMPLES } from "../src/web/art-examples";
import { ART_STYLES } from "../src/web/art-styles";

test("every named Art Style has an example, and a wrong name can't hide one", () => {
  expect(Object.keys(ART_EXAMPLES).toSorted()).toEqual(Object.keys(ART_STYLES).toSorted());
});
