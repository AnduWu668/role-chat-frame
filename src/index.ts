declare const characterDefinitionIdBrand: unique symbol;
declare const personaIdBrand: unique symbol;
declare const userIdBrand: unique symbol;
declare const sessionIdBrand: unique symbol;
declare const turnIdBrand: unique symbol;
declare const sessionRevisionBrand: unique symbol;
declare const sessionCursorBrand: unique symbol;

export type CharacterDefinitionId = string & {
  readonly [characterDefinitionIdBrand]: "CharacterDefinitionId";
};
export type PersonaId = string & { readonly [personaIdBrand]: "PersonaId" };
export type UserId = string & { readonly [userIdBrand]: "UserId" };
export type SessionId = string & { readonly [sessionIdBrand]: "SessionId" };
export type TurnId = string & { readonly [turnIdBrand]: "TurnId" };
export type SessionRevision = string & {
  readonly [sessionRevisionBrand]: "SessionRevision";
};
export type SessionCursor = string & {
  readonly [sessionCursorBrand]: "SessionCursor";
};

export interface CharacterFragment {
  readonly name: string;
  readonly content: string;
}

export interface CharacterDefinition {
  readonly id: CharacterDefinitionId;
  readonly fragments: readonly CharacterFragment[];
}

export interface Persona {
  readonly id: PersonaId;
  readonly characterDefinitionId: CharacterDefinitionId;
  readonly overrideFragments: readonly CharacterFragment[];
}

export interface Turn {
  readonly id: TurnId;
  readonly input: string;
  readonly output: string;
}

export interface NewTurn {
  readonly input: string;
  readonly output: string;
}

export interface SessionPage {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  readonly personaId: PersonaId;
  readonly revision: SessionRevision;
  readonly turns: readonly Turn[];
  readonly nextCursor?: SessionCursor;
}

export interface CharacterDefinitionStore {
  get(id: CharacterDefinitionId): Promise<CharacterDefinition | null>;
}

export interface PersonaStore {
  get(id: PersonaId): Promise<Persona | null>;
}

export interface SessionStore {
  read(input: {
    readonly sessionId: SessionId;
    readonly before?: SessionCursor;
    readonly limit: number;
  }): Promise<SessionPage | null>;
  commit(input: {
    readonly sessionId: SessionId;
    readonly expectedRevision: SessionRevision;
    readonly turnId: TurnId;
    readonly turn: NewTurn;
  }): Promise<CommitResult>;
}

export type CommitResult =
  | {
      readonly status: "committed";
      readonly revision: SessionRevision;
      readonly turn: Turn;
    }
  | {
      readonly status: "conflict";
      readonly revision: SessionRevision;
    };

export interface TurnContext {
  readonly turnId: TurnId;
  readonly userId: UserId;
  readonly personaId: PersonaId;
  readonly sessionId: SessionId;
  readonly input: string;
}

export interface MemoryBlock {
  readonly source: string;
  readonly content: string;
}

export interface MemorySystem {
  recall(context: TurnContext): Promise<readonly MemoryBlock[]>;
  /** Must be idempotent by Turn ID because a committed Turn may be observed again. */
  observe(context: TurnContext, turn: Turn): Promise<void>;
}

export interface MemoryBinding {
  readonly system: MemorySystem;
}

export interface SessionMessage {
  readonly turnId: TurnId;
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ContextParts {
  readonly characterDefinitionFragments: readonly CharacterFragment[];
  readonly personaOverrideFragments: readonly CharacterFragment[];
  readonly sessionMessages: readonly SessionMessage[];
  readonly memoryBlocks: readonly MemoryBlock[];
  readonly input: string;
}

export interface ModelMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ModelInput {
  readonly messages: readonly ModelMessage[];
}

export interface ContextAssembler {
  assemble(parts: ContextParts): Promise<ModelInput>;
}

export interface DefaultContextAssemblerOptions {
  readonly maxTokens: number;
  readonly countTokens: (input: ModelInput) => number;
}

export class ContextBudgetExceededError extends Error {
  readonly name = "ContextBudgetExceededError";

  constructor(
    readonly maxTokens: number,
    readonly requiredTokens: number,
  ) {
    super(
      `Fixed context requires ${requiredTokens} tokens, exceeding the ${maxTokens}-token budget`,
    );
  }
}

export class DefaultContextAssembler implements ContextAssembler {
  constructor(private readonly options: DefaultContextAssemblerOptions) {
    if (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 0) {
      throw new RangeError("maxTokens must be a non-negative safe integer");
    }
  }

  async assemble(parts: ContextParts): Promise<ModelInput> {
    let requiredTokens = 0;
    for (let omitted = 0; omitted <= parts.sessionMessages.length; omitted++) {
      const input: ModelInput = {
        messages: [
          ...parts.characterDefinitionFragments.map(({ content }) => ({
            role: "system" as const,
            content,
          })),
          ...parts.personaOverrideFragments.map(({ content }) => ({
            role: "system" as const,
            content,
          })),
          ...parts.sessionMessages
            .slice(omitted)
            .map(({ role, content }) => ({ role, content })),
          ...parts.memoryBlocks.map(({ content }) => ({
            role: "system" as const,
            content,
          })),
          { role: "user", content: parts.input },
        ],
      };
      requiredTokens = this.options.countTokens(input);
      if (!Number.isSafeInteger(requiredTokens) || requiredTokens < 0) {
        throw new RangeError(
          "countTokens must return a non-negative safe integer",
        );
      }
      if (requiredTokens <= this.options.maxTokens) {
        return input;
      }
    }
    throw new ContextBudgetExceededError(
      this.options.maxTokens,
      requiredTokens,
    );
  }
}

export interface ModelOutput {
  readonly content: string;
}

export interface ChatModel {
  generate(input: ModelInput): Promise<ModelOutput>;
}

export interface TurnExecutorDependencies {
  readonly characterDefinitionStore: CharacterDefinitionStore;
  readonly personaStore: PersonaStore;
  readonly sessionStore: SessionStore;
  readonly contextAssembler: ContextAssembler;
  readonly model: ChatModel;
  readonly historyPageSize: number;
}

export interface ExecuteTurnInput {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly input: string;
  readonly memoryBindings: readonly MemoryBinding[];
}

export type TurnExecutionError =
  | { readonly category: "invalid-input" }
  | { readonly category: "session-not-found" }
  | { readonly category: "persona-not-found" }
  | { readonly category: "character-definition-not-found" }
  | {
      readonly category: "store-read-failed";
      readonly store: "session" | "persona" | "character-definition";
      readonly cause: unknown;
    }
  | { readonly category: "recall-failed"; readonly cause: unknown }
  | {
      readonly category: "context-budget-exceeded";
      readonly cause: ContextBudgetExceededError;
    }
  | { readonly category: "context-assembly-failed"; readonly cause: unknown }
  | { readonly category: "model-invocation-failed"; readonly cause: unknown }
  | { readonly category: "commit-failed"; readonly cause: unknown }
  | { readonly category: "commit-conflict"; readonly revision: SessionRevision };

export interface ObservationFailure {
  readonly category: "observation-failed";
  readonly memoryBinding: MemoryBinding;
  readonly cause: unknown;
}

export type TurnExecutionResult =
  | {
      readonly ok: true;
      readonly status: "committed";
      readonly revision: SessionRevision;
      readonly turn: Turn;
      readonly observationFailures?: readonly ObservationFailure[];
    }
  | { readonly ok: false; readonly error: TurnExecutionError };

export async function executeTurn(
  dependencies: TurnExecutorDependencies,
  input: ExecuteTurnInput,
): Promise<TurnExecutionResult> {
  if (
    !Number.isInteger(dependencies.historyPageSize) ||
    dependencies.historyPageSize <= 0
  ) {
    return { ok: false, error: { category: "invalid-input" } };
  }

  let page: SessionPage | null;
  try {
    page = await dependencies.sessionStore.read({
      sessionId: input.sessionId,
      limit: dependencies.historyPageSize,
    });
  } catch (cause) {
    return {
      ok: false,
      error: { category: "store-read-failed", store: "session", cause },
    };
  }
  if (page === null) {
    return { ok: false, error: { category: "session-not-found" } };
  }

  let persona: Persona | null;
  try {
    persona = await dependencies.personaStore.get(page.personaId);
  } catch (cause) {
    return {
      ok: false,
      error: { category: "store-read-failed", store: "persona", cause },
    };
  }
  if (persona === null) {
    return { ok: false, error: { category: "persona-not-found" } };
  }

  let characterDefinition: CharacterDefinition | null;
  try {
    characterDefinition = await dependencies.characterDefinitionStore.get(
      persona.characterDefinitionId,
    );
  } catch (cause) {
    return {
      ok: false,
      error: {
        category: "store-read-failed",
        store: "character-definition",
        cause,
      },
    };
  }
  if (characterDefinition === null) {
    return {
      ok: false,
      error: { category: "character-definition-not-found" },
    };
  }

  const context: TurnContext = {
    turnId: input.turnId,
    userId: page.userId,
    personaId: page.personaId,
    sessionId: page.sessionId,
    input: input.input,
  };
  let memoryBlocks: readonly MemoryBlock[];
  try {
    memoryBlocks = (
      await Promise.all(
        input.memoryBindings.map(({ system }) => system.recall(context)),
      )
    ).flat();
  } catch (cause) {
    return { ok: false, error: { category: "recall-failed", cause } };
  }
  const sessionMessages: SessionMessage[] = [];
  for (const turn of page.turns) {
    sessionMessages.push(
      { turnId: turn.id, role: "user", content: turn.input },
      { turnId: turn.id, role: "assistant", content: turn.output },
    );
  }
  let modelInput: ModelInput;
  try {
    modelInput = await dependencies.contextAssembler.assemble({
      characterDefinitionFragments: characterDefinition.fragments,
      personaOverrideFragments: persona.overrideFragments,
      sessionMessages,
      memoryBlocks,
      input: input.input,
    });
  } catch (cause) {
    if (cause instanceof ContextBudgetExceededError) {
      return {
        ok: false,
        error: { category: "context-budget-exceeded", cause },
      };
    }
    return {
      ok: false,
      error: { category: "context-assembly-failed", cause },
    };
  }
  let modelOutput: ModelOutput;
  try {
    modelOutput = await dependencies.model.generate(modelInput);
  } catch (cause) {
    return {
      ok: false,
      error: { category: "model-invocation-failed", cause },
    };
  }
  let commit: CommitResult;
  try {
    commit = await dependencies.sessionStore.commit({
      sessionId: input.sessionId,
      expectedRevision: page.revision,
      turnId: input.turnId,
      turn: { input: input.input, output: modelOutput.content },
    });
  } catch (cause) {
    return { ok: false, error: { category: "commit-failed", cause } };
  }
  if (commit.status === "conflict") {
    return {
      ok: false,
      error: { category: "commit-conflict", revision: commit.revision },
    };
  }

  const observationFailures = (
    await Promise.all(
      input.memoryBindings.map(
        async (memoryBinding): Promise<ObservationFailure[]> => {
          try {
            await memoryBinding.system.observe(context, commit.turn);
            return [];
          } catch (cause) {
            return [{ category: "observation-failed", memoryBinding, cause }];
          }
        },
      ),
    )
  ).flat();
  return {
    ok: true,
    status: "committed",
    revision: commit.revision,
    turn: commit.turn,
    ...(observationFailures.length === 0 ? {} : { observationFailures }),
  };
}
