# role-chat-frame

远程：https://github.com/AnduWu668/role-chat-frame

通用、可组合的一对一角色聊天内核：一份角色定义可以实例化任意多个分身；一个回合可以同时接入任意多个记忆系统。

当前仓库实现最小领域、扩展契约和完整回合执行；模型、存储与具体记忆由应用提供。

## 核心

- **角色定义**：可复用的内容模板，不保存用户、会话或记忆。
- **分身**：角色定义的一次实例化，有独立的稳定标识和可选覆盖内容。同一定义可以创建任意多个分身。
- **会话**：某个用户与某个分身之间的消息记录。
- **记忆系统**：应用提供的实现，只需在回合前召回、回合后观察。
- **记忆绑定**：挂到应用或分身上的有序记忆系统列表；同一回合会调用列表中的每个系统。
- **上下文组装器**：把角色内容、会话、记忆块和当前输入转换成模型输入；应用可替换它来决定注入位置、token 预算和裁剪顺序。

## 最小接口

```ts
interface MemorySystem {
  recall(context: TurnContext): Promise<MemoryBlock[]>
  observe(context: TurnContext, turn: Turn): Promise<void>
}

interface ContextAssembler {
  assemble(parts: ContextParts): Promise<ModelInput>
}

interface CharacterDefinitionStore {
  get(id: CharacterDefinitionId): Promise<CharacterDefinition | null>
}

interface PersonaStore {
  get(id: PersonaId): Promise<Persona | null>
}

interface SessionStore {
  read(input: {
    sessionId: SessionId
    before?: SessionCursor
    limit: number
  }): Promise<SessionPage | null>

  findTurn(input: {
    sessionId: SessionId
    turnId: TurnId
  }): Promise<Turn | null>

  commit(input: {
    sessionId: SessionId
    expectedRevision: SessionRevision
    turnId: TurnId
    turn: NewTurn
  }): Promise<CommitResult>
}

interface SessionPage {
  sessionId: SessionId
  userId: UserId
  personaId: PersonaId
  revision: SessionRevision
  turns: Turn[]
  nextCursor?: SessionCursor
}
```

`TurnContext` 提供 `turnId`、`userId`、`personaId`、`sessionId` 和当前输入。记忆系统自行选择作用域，因此可以实现关系记忆、跨分身用户档案、分身世界状态、单场摘要或静态世界书。

`ContextParts` 只包含已经解析好的角色定义片段、分身覆盖片段、按时间排序的会话消息、按绑定顺序返回的记忆块和当前输入。上下文组装器只负责模型输入的组装，不读取或保存业务数据。默认组装器按“角色定义、分身覆盖、会话消息、记忆块、当前输入”的顺序组装；超出已配置预算时先移除最旧的会话消息，仍然超限则明确失败，不静默裁掉角色、记忆或当前输入。应用需要 CCv3 decorators、模型专用消息角色或不同预算策略时可整体替换。

`CharacterDefinitionStore` 和 `PersonaStore` 只提供回合热路径所需的按标识读取。创建、修改、删除、搜索和列表属于应用的管理接口，不进入核心。

`SessionStore.read` 返回会话的 `userId`、`personaId`、当前 `revision`、按时间正序排列的一页回合，以及可选的 `nextCursor`；不传 `before` 时读取最新一页，传入后继续读取更早历史。`limit` 必须为正数，`SessionCursor` 和 `SessionRevision` 都是不透明值，调用方不得解析或自行构造。

`SessionStore.findTurn` 按 `sessionId + turnId` 查找已提交回合，不受历史分页影响。框架在召回记忆和调用模型前先执行这次查找；找到且用户输入相同就恢复已保存的权威回合，找到但用户输入不同则报告 `turn-id-conflict`。

`SessionStore.commit` 以读取到的 `expectedRevision` 做条件提交，并返回以下四种结果：

```ts
type CommitResult =
  | { status: "committed"; revision: SessionRevision; turn: Turn }
  | { status: "duplicate"; revision: SessionRevision; turn: Turn }
  | { status: "conflict"; revision: SessionRevision }
  | { status: "turn-id-conflict"; revision: SessionRevision }
```

提交时仍先检查 `sessionId + turnId`：已有回合的用户输入相同就返回已经保存的权威回合，不比较本次生成的输出，也不受旧 `expectedRevision` 影响；只有用户输入不同时才报告 `turn-id-conflict`。没有已有回合时才比较版本；`conflict` 表示会话已被其他执行者推进，本次回复不得写入。应用决定是否发起重试，核心负责识别同一逻辑回合并恢复已提交结果。

## 一次回合

1. 按 `sessionId` 串行进入回合，读取当前会话并按 `turnId` 查找已提交回合。
2. 已有回合且用户输入相同则跳过生成，恢复该权威回合；输入不同则失败。
3. 没有已有回合时，解析角色定义和分身覆盖内容。
4. 向每个已绑定的记忆系统召回内容。
5. 由上下文组装器生成模型输入。
6. 调用应用提供的对话模型。
7. 按 `turnId` 原子提交用户输入和模型输出；若竞争者已提交相同输入，则采用其权威回合。
8. 把最终的权威回合交给每个记忆系统观察。

同一会话的下一个回合要等上一个回合的全部观察尝试结束后才能开始，不同会话可以并行。召回、组装、模型调用或首次提交失败时，不产生完成回合，也不调用 `observe`；单个记忆系统若要在召回失败时降级，应在自己的实现内返回空结果。恢复到已提交回合时仍会调用 `observe`，以覆盖提交成功后、观察完成前中断的恢复场景。

`observe` 发生在提交之后。框架会尝试通知全部记忆系统；其中一个失败不能阻止其他系统。观察失败不得回滚已经保存的回复，而应随成功结果单独报告；它可能因重试收到相同 `turnId`，因此记忆实现必须保证重复观察安全。

记忆系统自己决定数据归属、存储、抽取、整理和检索方式。关系记忆、用户档案、世界书、会话摘要、向量记忆或远程记忆服务可以并存，框架不要求它们采用同一种内部模型。导出、导入、删除、复制和管理界面是可选管理能力，不进入所有实现都必须承担的聊天热路径接口。

## 边界

框架定义角色、分身和会话所需的存储接口，但不内置数据库实现、ORM、迁移或事务技术。模型厂商、HTTP/SSE、认证、UI、调度器、主动消息、重试队列和具体记忆算法也由应用和适配器负责；记忆数据继续由各 `MemorySystem` 自己持久化。

- 术语：[CONTEXT.md](CONTEXT.md)
- 调研：[开源角色扮演聊天框架调研](docs/research/2026-08-24-roleplay-chat-frameworks.md)
- 决策：

| ADR | 决定 |
| --- | --- |
| [0001](docs/adr/0001-definition-and-persona-are-separate.md) | 角色定义与分身分离 |
| [0002](docs/adr/0002-memory-systems-are-composable.md) | 多个记忆系统通过最小契约组合 |
| [0003](docs/adr/0003-core-only-orchestrates-turns.md) | 核心只编排回合 |
| [0004](docs/adr/0004-context-assembly-is-replaceable.md) | 上下文组装是一个可替换策略 |
| [0005](docs/adr/0005-commit-before-memory-observation.md) | 回合提交后才通知记忆系统 |
| [0006](docs/adr/0006-turns-are-serialized-per-session.md) | 同一会话的回合必须串行 |
| [0007](docs/adr/0007-storage-interfaces-belong-to-core.md) | 存储接口属于核心，存储实现属于应用 |
