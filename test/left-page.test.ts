import { afterEach, expect, test } from "bun:test";
import { leftFolded, rememberLeftFolded } from "../src/web/menu";

const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function storage(value: unknown) {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => value });
}

afterEach(() => {
  if (real) Object.defineProperty(globalThis, "localStorage", real);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

test("the left page starts open, and remembers being folded either way", () => {
  const kept = new Map<string, string>();
  storage({ getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => kept.set(key, value) });
  expect(leftFolded()).toBe(false);
  rememberLeftFolded(true);
  expect(leftFolded()).toBe(true);
  rememberLeftFolded(false);
  expect(leftFolded()).toBe(false);
});

test("blocked storage only loses the choice", () => {
  const blocked = () => {
    throw new Error("blocked");
  };
  storage({ getItem: blocked, setItem: blocked });
  expect(leftFolded()).toBe(false);
  expect(() => rememberLeftFolded(true)).not.toThrow();
});
