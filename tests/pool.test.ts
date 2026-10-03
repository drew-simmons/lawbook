import { expect, test } from "vitest";
import { mapLimit } from "../src/pool.ts";

/** A promise settled from outside, so a test controls the finishing order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every settled promise run its continuations. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("mapLimit keeps results in input order when calls finish out of order", async () => {
  const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
  const result = mapLimit([0, 1, 2], 3, (index) => gates[index]!.promise);
  gates[2]!.resolve("c");
  gates[0]!.resolve("a");
  gates[1]!.resolve("b");
  expect(await result).toEqual(["a", "b", "c"]);
});

test("mapLimit never has more than limit calls in flight", async () => {
  const gates = Array.from({ length: 5 }, () => deferred<number>());
  const started: number[] = [];
  const result = mapLimit([0, 1, 2, 3, 4], 2, (index) => {
    started.push(index);
    return gates[index]!.promise;
  });
  await tick();
  expect(started).toEqual([0, 1]);
  gates[1]!.resolve(1);
  await tick();
  expect(started).toEqual([0, 1, 2]);
  for (const [index, gate] of gates.entries()) {
    gate.resolve(index);
  }
  expect(await result).toEqual([0, 1, 2, 3, 4]);
});

test("mapLimit with no items resolves to an empty array without calling fn", async () => {
  let calls = 0;
  const result = await mapLimit([], 4, async () => {
    calls += 1;
  });
  expect(result).toEqual([]);
  expect(calls).toBe(0);
});

test("mapLimit rejects when a call rejects", async () => {
  const result = mapLimit([1, 2], 2, async (item) => {
    if (item === 2) {
      throw new Error("two");
    }
    return item;
  });
  await expect(result).rejects.toThrow("two");
});
