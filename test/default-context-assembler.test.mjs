import assert from "node:assert/strict";
import test from "node:test";

import {
  ContextBudgetExceededError,
  DefaultContextAssembler,
} from "../dist/index.js";

test("assembles every context part in the documented order", async () => {
  const assembler = new DefaultContextAssembler({
    maxTokens: 100,
    countTokens: ({ messages }) => messages.length,
  });

  const result = await assembler.assemble({
    characterDefinitionFragments: [
      { name: "identity", content: "character" },
    ],
    personaOverrideFragments: [{ name: "mood", content: "persona" }],
    sessionMessages: [
      { turnId: "turn-1", role: "user", content: "old question" },
      { turnId: "turn-1", role: "assistant", content: "old answer" },
    ],
    memoryBlocks: [{ source: "profile", content: "memory" }],
    input: "current input",
  });

  assert.deepEqual(result, {
    messages: [
      { role: "system", content: "character" },
      { role: "system", content: "persona" },
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "system", content: "memory" },
      { role: "user", content: "current input" },
    ],
  });
});

test("removes oldest session messages until the context fits", async () => {
  const assembler = new DefaultContextAssembler({
    maxTokens: 12,
    countTokens: ({ messages }) =>
      messages.reduce((tokens, { content }) => tokens + content.length, 0),
  });

  const result = await assembler.assemble({
    characterDefinitionFragments: [{ name: "character", content: "cc" }],
    personaOverrideFragments: [{ name: "persona", content: "pp" }],
    sessionMessages: [
      { turnId: "turn-1", role: "user", content: "1111" },
      { turnId: "turn-1", role: "assistant", content: "222" },
      { turnId: "turn-2", role: "user", content: "3" },
    ],
    memoryBlocks: [{ source: "memory", content: "mm" }],
    input: "ii",
  });

  assert.deepEqual(result, {
    messages: [
      { role: "system", content: "cc" },
      { role: "system", content: "pp" },
      { role: "assistant", content: "222" },
      { role: "user", content: "3" },
      { role: "system", content: "mm" },
      { role: "user", content: "ii" },
    ],
  });
});

test("fails with a typed error when fixed context exceeds the budget", async () => {
  const assembler = new DefaultContextAssembler({
    maxTokens: 7,
    countTokens: ({ messages }) =>
      messages.reduce((tokens, { content }) => tokens + content.length, 0),
  });

  await assert.rejects(
    assembler.assemble({
      characterDefinitionFragments: [{ name: "character", content: "cc" }],
      personaOverrideFragments: [{ name: "persona", content: "pp" }],
      sessionMessages: [],
      memoryBlocks: [{ source: "memory", content: "mm" }],
      input: "ii",
    }),
    (error) => {
      assert.equal(error instanceof ContextBudgetExceededError, true);
      assert.equal(error.maxTokens, 7);
      assert.equal(error.requiredTokens, 8);
      return true;
    },
  );
});

test("rejects an invalid token count instead of bypassing the budget", async () => {
  const assembler = new DefaultContextAssembler({
    maxTokens: 0,
    countTokens: () => -1,
  });

  await assert.rejects(
    assembler.assemble({
      characterDefinitionFragments: [],
      personaOverrideFragments: [],
      sessionMessages: [],
      memoryBlocks: [],
      input: "must not bypass the budget",
    }),
    RangeError,
  );
});

test("rejects invalid maximum token budgets", () => {
  for (const maxTokens of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => new DefaultContextAssembler({ maxTokens, countTokens: () => 0 }),
      RangeError,
    );
  }
});
