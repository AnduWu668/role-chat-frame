import assert from "node:assert/strict";
import test from "node:test";

import { executeTurn } from "../dist/index.js";

test("executes and commits one complete turn before observing it", async () => {
  const calls = [];
  const previousTurn = {
    id: "turn-previous",
    input: "Do you remember me?",
    output: "Yes.",
  };
  const authoritativeTurn = {
    id: "turn-current",
    input: "Hello again",
    output: "Welcome back!",
  };
  let assembledParts;
  let modelInput;
  let observedTurn;

  const sessionStore = {
    async read(input) {
      calls.push(["read-session", input]);
      return {
        sessionId: "session-1",
        userId: "user-1",
        personaId: "persona-1",
        revision: "revision-1",
        turns: [previousTurn],
        nextCursor: "older-page",
      };
    },
    async commit(input) {
      calls.push(["commit", input]);
      return {
        status: "committed",
        revision: "revision-2",
        turn: authoritativeTurn,
      };
    },
  };
  const personaStore = {
    async get(id) {
      calls.push(["read-persona", id]);
      return {
        id,
        characterDefinitionId: "character-1",
        overrideFragments: [{ name: "mood", content: "Cheerful" }],
      };
    },
  };
  const characterDefinitionStore = {
    async get(id) {
      calls.push(["read-character-definition", id]);
      return {
        id,
        fragments: [{ name: "identity", content: "A patient librarian" }],
      };
    },
  };
  const memoryBinding = {
    system: {
      async recall(context) {
        calls.push(["recall", context]);
        return [{ source: "profile", content: "The user likes mysteries" }];
      },
      async observe(context, turn) {
        calls.push(["observe", context]);
        observedTurn = turn;
      },
    },
  };
  const contextAssembler = {
    async assemble(parts) {
      calls.push(["assemble"]);
      assembledParts = parts;
      return { messages: [{ role: "user", content: "assembled" }] };
    },
  };
  const model = {
    async generate(input) {
      calls.push(["generate"]);
      modelInput = input;
      return { content: "Welcome back" };
    },
  };

  const result = await executeTurn(
    {
      characterDefinitionStore,
      personaStore,
      sessionStore,
      contextAssembler,
      model,
      historyPageSize: 20,
    },
    {
      sessionId: "session-1",
      turnId: "turn-current",
      input: "Hello again",
      memoryBinding,
    },
  );

  assert.deepEqual(result, {
    ok: true,
    status: "committed",
    revision: "revision-2",
    turn: authoritativeTurn,
  });
  assert.deepEqual(assembledParts, {
    characterDefinitionFragments: [
      { name: "identity", content: "A patient librarian" },
    ],
    personaOverrideFragments: [{ name: "mood", content: "Cheerful" }],
    sessionMessages: [
      {
        turnId: "turn-previous",
        role: "user",
        content: "Do you remember me?",
      },
      {
        turnId: "turn-previous",
        role: "assistant",
        content: "Yes.",
      },
    ],
    memoryBlocks: [
      { source: "profile", content: "The user likes mysteries" },
    ],
    input: "Hello again",
  });
  assert.deepEqual(modelInput, {
    messages: [{ role: "user", content: "assembled" }],
  });
  assert.deepEqual(observedTurn, authoritativeTurn);
  assert.deepEqual(calls, [
    ["read-session", { sessionId: "session-1", limit: 20 }],
    ["read-persona", "persona-1"],
    ["read-character-definition", "character-1"],
    [
      "recall",
      {
        turnId: "turn-current",
        userId: "user-1",
        personaId: "persona-1",
        sessionId: "session-1",
        input: "Hello again",
      },
    ],
    ["assemble"],
    ["generate"],
    [
      "commit",
      {
        sessionId: "session-1",
        expectedRevision: "revision-1",
        turnId: "turn-current",
        turn: { input: "Hello again", output: "Welcome back" },
      },
    ],
    [
      "observe",
      {
        turnId: "turn-current",
        userId: "user-1",
        personaId: "persona-1",
        sessionId: "session-1",
        input: "Hello again",
      },
    ],
  ]);
});

test("reports typed failures without observing an uncommitted turn", async (t) => {
  const cases = [
    ["missing session", "session-not-found"],
    ["missing persona", "persona-not-found"],
    ["missing character definition", "character-definition-not-found"],
    ["recall", "recall-failed"],
    ["assembly", "context-assembly-failed"],
    ["model", "model-invocation-failed"],
    ["commit", "commit-failed"],
  ];

  for (const [failureAt, expectedCategory] of cases) {
    await t.test(failureAt, async () => {
      const cause = new Error(`${failureAt} failed`);
      const calls = [];
      const sessionStore = {
        async read() {
          calls.push("read-session");
          if (failureAt === "missing session") return null;
          return {
            sessionId: "session-1",
            userId: "user-1",
            personaId: "persona-1",
            revision: "revision-1",
            turns: [],
          };
        },
        async commit() {
          calls.push("commit");
          if (failureAt === "commit") throw cause;
          return {
            status: "committed",
            revision: "revision-2",
            turn: { id: "turn-1", input: "hello", output: "hi" },
          };
        },
      };
      const result = await executeTurn(
        {
          sessionStore,
          personaStore: {
            async get(id) {
              calls.push("read-persona");
              if (failureAt === "missing persona") return null;
              return {
                id,
                characterDefinitionId: "character-1",
                overrideFragments: [],
              };
            },
          },
          characterDefinitionStore: {
            async get(id) {
              calls.push("read-character-definition");
              if (failureAt === "missing character definition") return null;
              return { id, fragments: [] };
            },
          },
          contextAssembler: {
            async assemble() {
              calls.push("assemble");
              if (failureAt === "assembly") throw cause;
              return { messages: [] };
            },
          },
          model: {
            async generate() {
              calls.push("model");
              if (failureAt === "model") throw cause;
              return { content: "hi" };
            },
          },
          historyPageSize: 10,
        },
        {
          sessionId: "session-1",
          turnId: "turn-1",
          input: "hello",
          memoryBinding: {
            system: {
              async recall() {
                calls.push("recall");
                if (failureAt === "recall") throw cause;
                return [];
              },
              async observe() {
                calls.push("observe");
              },
            },
          },
        },
      );

      assert.equal(result.ok, false);
      assert.equal(result.error.category, expectedCategory);
      if (expectedCategory.endsWith("failed")) {
        assert.equal(result.error.cause, cause);
      }
      assert.equal(calls.includes("observe"), false);
      if (failureAt !== "commit") {
        assert.equal(calls.includes("commit"), false);
      }
    });
  }
});

test("rejects an invalid history page size before reading storage", async (t) => {
  for (const historyPageSize of [0, -1, 1.5]) {
    await t.test(String(historyPageSize), async () => {
      let read = false;
      const unused = {
        async get() {
          throw new Error("must not be called");
        },
      };
      const result = await executeTurn(
        {
          characterDefinitionStore: unused,
          personaStore: unused,
          sessionStore: {
            async read() {
              read = true;
              throw new Error("must not be called");
            },
            async commit() {
              throw new Error("must not be called");
            },
          },
          contextAssembler: {
            async assemble() {
              throw new Error("must not be called");
            },
          },
          model: {
            async generate() {
              throw new Error("must not be called");
            },
          },
          historyPageSize,
        },
        {
          sessionId: "session-1",
          turnId: "turn-1",
          input: "hello",
          memoryBinding: {
            system: {
              async recall() {
                throw new Error("must not be called");
              },
              async observe() {
                throw new Error("must not be called");
              },
            },
          },
        },
      );

      assert.deepEqual(result, {
        ok: false,
        error: { category: "invalid-input" },
      });
      assert.equal(read, false);
    });
  }
});

test("reports a conditional commit conflict without observing", async () => {
  let observed = false;
  const result = await executeTurn(
    {
      characterDefinitionStore: {
        async get(id) {
          return { id, fragments: [] };
        },
      },
      personaStore: {
        async get(id) {
          return {
            id,
            characterDefinitionId: "character-1",
            overrideFragments: [],
          };
        },
      },
      sessionStore: {
        async read() {
          return {
            sessionId: "session-1",
            userId: "user-1",
            personaId: "persona-1",
            revision: "revision-1",
            turns: [],
          };
        },
        async commit() {
          return { status: "conflict", revision: "revision-2" };
        },
      },
      contextAssembler: {
        async assemble() {
          return { messages: [] };
        },
      },
      model: {
        async generate() {
          return { content: "hi" };
        },
      },
      historyPageSize: 10,
    },
    {
      sessionId: "session-1",
      turnId: "turn-1",
      input: "hello",
      memoryBinding: {
        system: {
          async recall() {
            return [];
          },
          async observe() {
            observed = true;
          },
        },
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: { category: "commit-conflict", revision: "revision-2" },
  });
  assert.equal(observed, false);
});

test("reports typed storage read failures and stops the turn", async (t) => {
  for (const store of ["session", "persona", "character-definition"]) {
    await t.test(store, async () => {
      const cause = new Error(`${store} unavailable`);
      const calls = [];
      const result = await executeMinimalTurn({ failureAt: store, cause, calls });

      assert.deepEqual(result, {
        ok: false,
        error: { category: "store-read-failed", store, cause },
      });
      assert.equal(calls.includes("commit"), false);
      assert.equal(calls.includes("observe"), false);
    });
  }
});

test("returns the committed turn when observation fails", async () => {
  const cause = new Error("memory unavailable");
  const calls = [];
  const result = await executeMinimalTurn({
    failureAt: "observe",
    cause,
    calls,
  });

  assert.deepEqual(result, {
    ok: true,
    status: "committed",
    revision: "revision-2",
    turn: { id: "turn-1", input: "hello", output: "hi" },
    observationFailure: { category: "observation-failed", cause },
  });
  assert.deepEqual(calls.slice(-2), ["commit", "observe"]);
});

async function executeMinimalTurn({ failureAt, cause, calls }) {
  return executeTurn(
    {
      sessionStore: {
        async read() {
          calls.push("read-session");
          if (failureAt === "session") throw cause;
          return {
            sessionId: "session-1",
            userId: "user-1",
            personaId: "persona-1",
            revision: "revision-1",
            turns: [],
          };
        },
        async commit() {
          calls.push("commit");
          return {
            status: "committed",
            revision: "revision-2",
            turn: { id: "turn-1", input: "hello", output: "hi" },
          };
        },
      },
      personaStore: {
        async get(id) {
          calls.push("read-persona");
          if (failureAt === "persona") throw cause;
          return {
            id,
            characterDefinitionId: "character-1",
            overrideFragments: [],
          };
        },
      },
      characterDefinitionStore: {
        async get(id) {
          calls.push("read-character-definition");
          if (failureAt === "character-definition") throw cause;
          return { id, fragments: [] };
        },
      },
      contextAssembler: {
        async assemble() {
          calls.push("assemble");
          return { messages: [] };
        },
      },
      model: {
        async generate() {
          calls.push("model");
          return { content: "hi" };
        },
      },
      historyPageSize: 10,
    },
    {
      sessionId: "session-1",
      turnId: "turn-1",
      input: "hello",
      memoryBinding: {
        system: {
          async recall() {
            calls.push("recall");
            return [];
          },
          async observe() {
            calls.push("observe");
            if (failureAt === "observe") throw cause;
          },
        },
      },
    },
  );
}
