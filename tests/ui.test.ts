import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommandQueue } from "../packages/ui/src/shared";

test("export waits for queued edits and a failed command does not poison later saves", async () => {
  const enqueue = createCommandQueue();
  let complete!: () => void;
  const gate = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let text = "old";
  const save = enqueue(async () => {
    await gate;
    text = "new";
  });
  const exported = enqueue(async () => text);
  complete();
  await save;
  assert.equal(await exported, "new");
  await assert.rejects(
    enqueue(async () => {
      throw new Error("invalid time");
    }),
    /invalid time/,
  );
  assert.equal(await enqueue(async () => "next save"), "next save");
});
