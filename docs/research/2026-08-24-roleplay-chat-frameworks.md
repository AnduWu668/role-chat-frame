# 开源角色扮演聊天框架调研

> 历史调研快照：事实与来源保留供后续优化参考；第 7、8 节对旧 ADR 的映射已经失效，采用建议前需重新对照当前 ADR。

- **调研日期**：2026-08-24
- **方法**：只采一手资料——各项目官方 GitHub 仓库源码、官方文档站、规范原文（Character Card V2/V3 spec 的 Markdown 原文、RisuAI 与 Agnai 的 TypeScript 源码、Letta / mem0 / Open WebUI / elizaOS 官方文档）。每条论断附来源链接，尽量精确到文档页或源码文件。未经一手核实的说法不写入。
- **对照基准**：本仓库 `CONTEXT.md` 术语表与 `docs/adr/0001`–`0015` 共 15 个 ADR。

---

## 1. SillyTavern（SillyTavern/SillyTavern）

**定位**：本地部署的 LLM 聊天前端（AGPL），面向角色扮演，是角色卡生态的事实中心。仓库：[SillyTavern/SillyTavern](https://github.com/SillyTavern/SillyTavern)。

### 角色定义方式

- 角色是一张「角色卡」（Character Card），JSON 内嵌在 PNG 头像文件的 `tEXt` chunk 里分发。V1 只有 `name / description / personality / scenario / first_mes / mes_example` 六个字段；V2 加了 `system_prompt`、`post_history_instructions`、`alternate_greetings`、`character_book`、`tags`、`creator`、`character_version`、`extensions`。来源：[Character Card V2 规范 spec_v2.md](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md)。
- 关键约定：`character_version` **MUST NOT** 用于 prompt 工程，只做展示与排序——版本纯粹是元数据，卡片格式里没有「同一角色跨版本身份连续」的概念（[spec_v2.md `character_version` 节](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md#character_version)）。
- `extensions` 字段必须默认 `{}`，编辑器「must never destroy unknown key-value pairs」——前向兼容靠「未知键不销毁」约定（[spec_v2.md `extensions` 节](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md#extensions)）。
- `character_book` 是卡内嵌的角色专属世界书（lorebook）：带 `scan_depth`、`token_budget`、`recursive_scanning`，条目有 `keys / content / insertion_order / priority / constant / selective / secondary_keys / position` 等（[spec_v2.md `character_book`](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md#character_book)）。
- **V3 规范**（由 RisuAI 作者 kwaroran 起草）：`spec: 'chara_card_v3'`，PNG 用 `ccv3` chunk，新增 CHARX 打包格式（zip，`card.json` + assets）、`assets`、`nickname`、`creator_notes_multilingual`、`group_only_greetings`、append-only 的 `source` 溯源字段；lorebook 条目新增 `use_regex` 和一套写在内容里的「decorators」（`@@depth`、`@@role`、`@@position`、`@@activate_only_after`、`@@dont_activate_after_match` 等），把注入位置、角色、激活时机声明在条目文本内。来源：[SPEC_V3.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)。

### 聊天记录与角色的关系

- 聊天是挂在单个角色（或群组）下的 `.jsonl` 文件，可整体导出再导入；支持从消息处「Create Branch / Create Checkpoint」克隆分叉，按文件名互相链接。来源：[Chat File Management 文档](https://docs.sillytavern.app/usage/core-concepts/chatfilemanagement/)。
- 世界书可分别绑到角色（跨该角色所有聊天生效）、persona（用户人设）、单场聊天（chat lorebook，只在该场生效），并有三种合并插入策略。来源：[World Info 文档 Context-Specific Sources 节](https://docs.sillytavern.app/usage/worldinfo/)。

### 记忆 / 摘要机制

- **Summarize 扩展**（默认安装）：用主模型或辅助模型滚动生成聊天摘要，「The summary is updated and embedded into the chat file's metadata for the message that was the last in context when the summary was generated」——摘要锚定到具体消息，删改该消息会回滚到上一个有效摘要；用户可随时在 UI 里查看、手动改写、暂停自动更新；注入位置与模板可配。**摘要存在聊天文件的 metadata 里，属于单场聊天。** 来源：[Summarize 文档](https://docs.sillytavern.app/extensions/summarize/)。
- **World Info**：关键词触发的动态注入引擎，「functions like a dynamic dictionary」；支持正则键、`scan_depth`、token 预算（超预算按 order/priority 丢弃）、递归激活、常驻（🔵 constant）条目、触发概率、inclusion group、timed effects（sticky/cooldown/delay）。官方明确「If you want deterministic and predictable results, stick to keyword matching」。来源：[World Info 文档](https://docs.sillytavern.app/usage/worldinfo/)。
- **Vector Storage / Chat Vectorization 扩展**：对每条聊天消息做 embedding（400 字符分块），按最近 2 条消息做相似检索，把命中的旧消息「shuffle」进上下文头部或指定深度。文档开头有醒目的**缓存警告**：「Chat Vectorization restructures the prompt prefix between the LLM calls, which can lead to frequent cache misses. … You have to choose one or the other, but not both.」来源：[Chat Vectorization 文档](https://docs.sillytavern.app/extensions/chat-vectorization/)。

### 群聊

- 多角色共享一份聊天记录；发言顺序有 Manual / Natural Order（按提及+Talkativeness 随机）/ List Order / Pooled Order 四种策略。
- 两种上下文组装模式：**Swap character cards**（每次只放当前发言者的卡）和 **Join character cards**（把所有成员卡拼成一个联合前缀）——后者的动机写明是「with altering large chunks of the context is undesirable, e.g. with llama.cpp prompt caching」。
- Auto-mode：开启后每 5 秒自动按发言策略续生成，是 ST 里最接近「主动开口」的机制，但只在群聊内、纯客户端定时器。来源：[Group Chats 文档](https://docs.sillytavern.app/usage/core-concepts/groupchats/)。

### 扩展机制

- UI Extensions：浏览器端 JS，`manifest.json` 声明入口，通过 `SillyTavern.getContext()` 拿到聊天数组（可变！）、角色列表、事件总线；可注册 `generate_interceptor` 拦截生成请求；另有服务端 Server Plugins 和脚本语言 STscript。记忆类功能（Summarize、Vector Storage）本身就是这套扩展。来源：[Writing Extensions 文档](https://docs.sillytavern.app/for-contributors/writing-extensions/)。

### 主动消息与可移植性

- 无内建的跨会话主动消息调度（群聊 auto-mode 仅限页面开着时的定时续写）。
- 可移植性好：角色卡 PNG/JSON 走开放规范；聊天可导出 `.jsonl` 完整再导入；摘要是明文且 UI 可直接编辑。来源：[Chat File Management](https://docs.sillytavern.app/usage/core-concepts/chatfilemanagement/)、[Summarize](https://docs.sillytavern.app/extensions/summarize/)。

---

## 2. RisuAI（kwaroran/RisuAI）

**定位**：跨平台（Web/Tauri）角色聊天前端，Character Card V3 规范的发起者。仓库：[kwaroran/RisuAI](https://github.com/kwaroran/RisuAI)。

### 角色定义

- 原生实现 CCv3：`ccv3` PNG chunk、CHARX、lorebook decorators（见上节 V3 规范，规范本身在 [kwaroran/character-card-spec-v3](https://github.com/kwaroran/character-card-spec-v3)）。

### 记忆架构（源码级）

记忆模块在 [`src/ts/process/memory/`](https://github.com/kwaroran/RisuAI/tree/main/src/ts/process/memory)，有 `supaMemory.ts`、`hypamemory.ts`、`hypav2.ts`、`hypav3.ts`、`hanuraiMemory.ts` 等多套可选算法：

- **SupaMemory**（[supaMemory.ts](https://github.com/kwaroran/RisuAI/blob/main/src/ts/process/memory/supaMemory.ts)）：上下文超限时，把最老的消息按块（≤ maxContextTokens/3）送 LLM 摘要，拼成滚动的 `supaMemory` 字符串；当摘要段落 ≥4 段时**对摘要再做一次摘要**（`summarize(supaMemory)`）压缩；结果以 `system` 消息 `unshift` 到消息列表最前面。状态持久化在 `room.supaMemoryData`——**`room` 是 `Chat` 类型，即记忆存在单场聊天对象上**，并用 `lastId`（消息 memo）记录「已摘要到哪条」的水位线。
- **HypaMemory**（[hypamemory.ts](https://github.com/kwaroran/RisuAI/blob/main/src/ts/process/memory/hypamemory.ts)）：`HypaProcesser` 类，对摘要块做 embedding（本地 MiniLM/bge-m3/nomic 或 OpenAI `text-embedding-3-*`，向量缓存在浏览器 localforage），用最近 4 条对话做相似检索，取 top-3 以 `"past events: " + …` 注入。即「摘要块 + 向量索引」两层：摘要保底、向量召回旧块。
- HypaV2/V3（[hypav2.ts](https://github.com/kwaroran/RisuAI/blob/main/src/ts/process/memory/hypav2.ts)、[hypav3.ts](https://github.com/kwaroran/RisuAI/blob/main/src/ts/process/memory/hypav3.ts)）是同思路的迭代版，文件更大、含任务限流（`taskRateLimiter.ts`），本质仍是「会话内摘要+检索」。

### 会话模型 / 主动消息 / 可移植性

- 记忆按聊天（`Chat.supaMemoryData`）持有，不跨聊天；换一场聊天从零开始。
- 未见跨会话主动消息调度机制（源码中无对应模块）。
- 角色卡随 CCv3 可移植；记忆数据是 JSON 明文（`hypa:` 前缀 + `HypaData[]`）存在聊天对象里，随聊天导出。

---

## 3. Agnaistic / Agnai（agnaistic/agnai）

**定位**：多用户多角色聊天服务，自述「AI Agnostic (Multi-user and Multi-bot) Chat with Fictional Characters. Designed with scale in mind.」**未归档**（`archived: false`，最后 push 2026-06，默认分支 `dev`，AGPL-3.0）。来源：[GitHub 仓库元数据](https://github.com/agnaistic/agnai)。

### Memory Book 设计（源码级）

- 数据结构（[common/types/memory.ts](https://github.com/agnaistic/agnai/blob/dev/common/types/memory.ts)）：`MemoryBook { _id, name, userId, entries[] }`——**book 由用户拥有（`userId`），独立于角色和聊天**，使用时挂到某场聊天上。条目 `MemoryEntry`：`keywords`（触发词）、`entry`（注入文本）、`priority`（「lowest priority will be discarded first」，预算裁剪序）、`weight`（「highest will be at the bottom」，呈现排序）、`enabled`；并保留 V2 character_book 的兼容字段（注释明写「currently unsupported V2 fields which are here so that we don't destroy them」）。
- 匹配与组装（[common/memory.ts](https://github.com/agnaistic/agnai/blob/dev/common/memory.ts)）：`buildMemoryPrompt()` 在最近 `memoryDepth` 条消息里按词边界正则（支持 `*`/`?` 通配）找每个条目**最新一次**命中（`messageAge`）；先按 `priority` 再按 age 排序做 token 预算裁剪（默认 `memoryContextLimit` 500 tokens），再按 `weight` 排序渲染。`characterBookToNative()` / `nativeToCharacterBook()` 与 V2 卡内嵌 character_book 双向转换。
- 另有基于 embedding 的聊天召回类型（`UserEmbed` / `ChatEmbed`，[common/types/memory.ts](https://github.com/agnaistic/agnai/blob/dev/common/types/memory.ts)）。

### 小结

Memory book 本质是**手工编写的关键词知识库**（≈世界书），不是自动抽取的对话记忆；「记得用户说过什么」仍靠聊天记录本身。priority（丢弃序）与 weight（呈现序）分离是它比 V2 规范细的一点。

---

## 4. Letta（原 MemGPT，letta-ai/letta）

**定位**：「stateful agents」运行时/服务器，从 MemGPT 论文工程化而来，agent 是常驻服务对象。仓库：[letta-ai/letta](https://github.com/letta-ai/letta)。

### 记忆分层

官方文档「Context hierarchy」给出四层抽象（[docs](https://docs.letta.com/guides/core-concepts/memory/context-hierarchy/)）：

| 抽象 | 是否常驻上下文 | 工具 | 规模 |
| --- | --- | --- | --- |
| Memory Blocks（core memory） | 是（钉进 system prompt） | `memory_rethink` / `memory_replace` / `memory_insert` | 建议 <50k 字符、<20 块 |
| Files | 部分（可开合） | `open` / `close` / `semantic_search` / `grep` | 5MB |
| Archival Memory | 否，按需检索 | `archival_memory_insert` / `archival_memory_search` | 无上限 |
| External RAG | 否 | 自定义工具/MCP | 无上限 |

- **Memory blocks**：带 `label / description / value / limit` 的上下文段，「always visible - no retrieval needed」，agent 用内置工具**自编辑**，可设 `read_only`，可多 agent 共享（shared blocks）。来源：[Memory blocks 文档](https://docs.letta.com/guides/core-concepts/memory/memory-blocks/)。
- **Archival memory**：语义检索库，「must be queried on-demand via tools」，适合「less important memories … do not always need to be recalled」。来源：[Archival memory 文档](https://docs.letta.com/guides/core-concepts/memory/archival-memory/)。
- **Recall / conversation search**：全部消息持久化，「even after a compaction / eviction, an agent's old messages are still retrievable via the API (for developers) and retrieval tools (for agents)」。来源：[Stateful agents 文档](https://docs.letta.com/guides/core-concepts/stateful-agents/)。

### Agent 常驻模型与主动性

- 「A stateful agent is a persistent AI identity with its own memory, model configuration, tools, and message history」，**记忆挂在 agent 上**，跨该 agent 的多个 conversation 共享（[Stateful agents](https://docs.letta.com/concepts/stateful-agents/)）。要给每个终端用户独立记忆，就得每用户一个 agent（或每用户一块 block）。
- **Sleep-time agents**：`enable_sleeptime: true` 会自动创建一个后台 agent，与主 agent 共享 memory blocks，每 N 步（默认 5，`sleeptime_agent_frequency`）被喂新消息、异步改写记忆块——即「后台反思/整理记忆」作为一等机制。来源：[Sleep-time agents 文档](https://docs.letta.com/guides/agents/architectures/sleeptime/)。

### 与本仓库的直接对照

- Letta 把可变记忆**钉进 system prompt** 且鼓励 agent 随时 `memory_replace`——与本仓库 ADR-0011「变化的记忆不进 system 前缀」正相反；Letta 文档自己也承认并发写 block 是 last-write-wins（[Memory blocks 文档](https://docs.letta.com/guides/core-concepts/memory/memory-blocks/)）。
- Letta 是「agent 常驻 + 后台自醒」，本仓库 ADR-0002/0015 是「按会话按需拉起 + 应用调度主动开口」。
- 可移植性：blocks / archival 都是明文可经 API 读出；另有开放的 agent 导出格式 [Agent File（.af）](https://github.com/letta-ai/agent-file)。

---

## 5. mem0（mem0ai/mem0）

**定位**：独立的记忆层库/托管服务，给任意 agent 加「用户记忆」。仓库：[mem0ai/mem0](https://github.com/mem0ai/mem0)。

### 抽取-更新流水线（源码级）

- OSS 经典两阶段流水线的核心 prompt 在 [mem0/configs/prompts.py](https://github.com/mem0ai/mem0/blob/main/mem0/configs/prompts.py)：
  1. **抽取**：`FACT_RETRIEVAL_PROMPT` 类 prompt 从对话抽出事实（偏好、计划、实体）。
  2. **合并**：`DEFAULT_UPDATE_MEMORY_PROMPT`——「You are a smart memory manager … you can perform four operations: **ADD / UPDATE / DELETE / NONE**」，把新事实与向量检索出的既有记忆逐条比对，输出带 `event` 字段的操作列表（`"event": "ADD" | "UPDATE" | "DELETE" | "NONE"`，UPDATE 需带 `old_memory`）。
- 同一文件里还有 2025-26 新增的 **V3 additive 模式**：`ADDITIVE_EXTRACTION_PROMPT`——「Your sole operation is ADD」，不再改写旧记忆，改为在新记忆上挂 `linked_memory_ids` 链接相关旧记忆。托管平台文档现在也按此口径描述：「New memories are added without overwriting or deleting existing memories」，并支持 `expiration_date`（过期后对 search 隐藏）与 `infer=False` 存原文。来源：[Memory operations 文档](https://docs.mem0.ai/core-concepts/memory-operations)。
- 记忆按 `user_id` / `agent_id` / `run_id` 标识组合归属；平台会自动用同标识的历史对话做指代消解（"He" → "User's dog Biscuit"）。来源：同上文档页。

### 与本仓库「记忆事件」的异同

- **同**：都是「先抽取、再对既有记忆做增/改/废三类判断」；mem0 的 UPDATE/DELETE ≈ 本仓库的「修正/收回」。
- **异**：mem0 经典模式的 UPDATE/DELETE **直接改写工作库**，真相就是当前库（可变状态）；本仓库 ADR-0003 是只追加事件日志 + 可重建投影，真相是日志。mem0 的 V3 转向「只增+链接+过期」恰好说明「破坏性合并」在实践中出过问题（平台文档现称 add 为「additive pipeline」）——这对本仓库「收回不删原事件」是一个方向性佐证。
- mem0 抽取全靠「模型觉得重要」，无「用户显式记住→同步入账」的区分（对照 ADR-0009）。

---

## 6. 补充：Open WebUI 与 elizaOS

### Open WebUI 记忆功能

- 用户级记忆：`Settings > Personalization > Memory` 手动增删改；开启 Native Function Calling 后模型可用内置工具 `add_memory / search_memories / delete_memory` 自主管理；记忆分 `user`（关于用户的事实）与 `context`（其他持久上下文）两类，**注入时分别设字符预算**（`MEMORIES_USER_CHAR_LIMIT` / `MEMORIES_CONTEXT_CHAR_LIMIT`，默认各 2000）。
- 「Open WebUI injects the user's stored memories into the model's system context … on every turn」——记忆直接进 system 上下文（与 ADR-0011 相反）。
- **Background review**：`ENABLE_MEMORY_BACKGROUND_REVIEW` 开启后每 `MEMORIES_REVIEW_INTERVAL_TURNS`（默认 10）回合后台复盘对话、自动更新 `context` 记忆——又一个「每 N 回合异步整理」的实例。
- 记忆按用户隔离（vector DB per-user collection），不区分角色。来源：[Memory & Personalization 文档](https://docs.openwebui.com/features/chat-conversations/memory/)。

### elizaOS（elizaOS/eliza）

- **Character**：TypeScript/JSON 配置对象——`name / bio / system / adjectives / topics / style{all,chat,post} / messageExamples（二维数组少样本）/ knowledge / plugins / settings`，无版本概念，`id` 可自动生成。来源：[Character interface 文档](https://docs.elizaos.ai/agents/character-interface)。
- **Memory**：统一的 `Memory { id, type, roomId, userId?, agentId?, content, embedding?, … }`，类型枚举含 `MESSAGE / FACT / DOCUMENT / RELATIONSHIP / GOAL / TASK / ACTION`；fact 结构化为 `(subject, predicate, object, confidence, source)`，`source` 指回来源消息；按 embedding 相似度检索；文档给的清理/压缩范式是「摘要后**删除原消息**」（`compressMemories` 示例最后 `deleteMemory`）。**记忆主要按 `roomId`（房间/平台频道）组织**，agent 常驻多客户端（Discord/Telegram 等）。来源：[Memory & State 文档](https://docs.elizaos.ai/runtime/memory)、[elizaOS/eliza 仓库](https://github.com/elizaOS/eliza)（`@elizaos/core` 定义 `AgentRuntime`、memory/state 原语）。

---

## 7. 对照分析：与本仓库 15 个 ADR 逐项对照

### 7.1 记忆归属（ADR-0001、0003、0004、0013、0014）

| 框架 | 记忆挂在哪 | 后果 |
| --- | --- | --- |
| SillyTavern | 摘要在**聊天文件 metadata**；世界书可挂角色/persona/聊天 | 换聊天即失忆；「记得我」与「这场聊了什么」焊死 |
| RisuAI | `Chat.supaMemoryData`，**单场聊天** | 同上（源码直接证实） |
| Agnai | MemoryBook 挂**用户**，但内容是手工词条 | 可跨聊天，但不是自动的对话记忆 |
| Letta | 挂 **agent**，跨 conversation 共享 | 多终端用户需每人一个 agent |
| mem0 | `user_id` × `agent_id` × `run_id` 组合 | 最接近「用户 × 角色」二元组 |
| Open WebUI | 挂**用户**，全局一份 | 不区分角色，所有模型共享 |
| elizaOS | 主要挂 **roomId** | 房间导向，非关系导向 |

**本框架优点**：「用户 × 角色标识」二元归属 + 多场会话共用（ADR-0001/0014）在被调研对象里没有完整对应物。ST/Risu 的现状（记忆焊死在聊天文件里）正是 ADR-0001 反对的那种设计，业界痛点真实存在；mem0 的 user×agent 标识组合是最接近的旁证，说明该维度选择是对的。

**本框架优点**：slug 与版本分离、换版本不换记忆（ADR-0013）业界没有——Character Card V2/V3 明文规定 `character_version` 不进 prompt、只做展示，卡片没有身份连续性，重新导入新版卡就是一个新角色，旧聊天/记忆无法跟随。本框架把「决裂才换 slug」写成规则，比卡片生态严谨。

**风险**：CCv2/v3 是事实标准（PNG/CHARX 分发、内嵌 character_book、decorators 生态）。本框架「角色包 = 命名片段集合」若不提供 CCv3 的导入映射（description/personality → 人设片段、character_book → 世界书片段），会失去现成的角色资产生态。

### 7.2 记忆形态与四口（ADR-0003、0006、0007、0008、0009）

- **事件日志 + 投影是业界少见的**。ST/Risu 是「滚动摘要」：有损、不可逆，Risu 还会对摘要再摘要（`supaMemory.ts` 中 `summarize(supaMemory)`），信息逐层丢失且无从对账。mem0 经典模式直接 UPDATE/DELETE 工作库，真相可变。本框架「日志为真相、副本可重建」（ADR-0003）能回答「为什么现在记成这样」，这是所有被调研框架都做不到的。
- **明文导出**（ADR-0004）：Letta blocks、mem0 `get_all`、Open WebUI 记忆列表其实都能读出明文——导出本身不稀缺；稀缺的是把「导出作为验收对账的唯一法定接口」（ADR-0010 联动）。
- **同步/异步抽取分道**（ADR-0009）：业界没有等价物。mem0/Open WebUI 的抽取时机由「模型觉得重要」或固定间隔决定；ADR-0009 用「用户显式记住/收回/承诺」这一可判定准则换取可测试性，更严谨。Open WebUI 的 native-tool 模式（模型当场调 `add_memory`）是最接近「同步入账」的业界实现，可参考其工具协议。
- **抽取水位线**：ST Summarize 把摘要锚定到「最后在上下文里的那条消息」，Risu 用 `lastId` 记录已摘要位置——这正是 ADR-0008「入账完成前检索必须回源」需要的**入账进度指针**的现成做法，值得直接采用。
- **风险（重要）**：本框架四口里**没有「整理/合并」环节**。事件只增（新增/修正/收回），编译口若只做朴素折叠，工作副本长期会碎片化、冗余、互相矛盾。业界三个独立解法都指向同一需求：mem0 的 UPDATE 合并判定、Letta 的 `memory_rethink` + sleep-time agent、Open WebUI 的 background review。本框架可以在「编译」口内做压实（compaction），不需要第五口，但 ADR 目前没有明确编译口允许/要求做语义合并，建议补一条决策。
- **风险**：mem0 从「ADD/UPDATE/DELETE」转向「ADD-only + 链接 + 过期」说明用 LLM 判定 UPDATE/DELETE 的误判成本高（错误合并/误删）。本框架「修正/收回」事件同样依赖 LLM 判定新事实与旧事件的对应关系，这一步是整个默认策略最容易出错的地方，验收剧本应重点覆盖「相似但不同的事实不被误修正」。

### 7.3 上下文组装与 KV cache（ADR-0005、0011、0012）

- ADR-0011 有直接的业界正面印证：ST Chat Vectorization 文档明确警告动态注入「can lead to frequent cache misses … effectively making caching useless」；ST 群聊的 Join character cards 模式动机也是 llama.cpp prompt caching。反例是 Letta（记忆块钉进 system 且 agent 随时改写）和 Open WebUI（记忆每轮注入 system context）——它们为「记忆永远在场」牺牲了缓存。本框架站在缓存这边且有实证支持。
- **风险**：ADR-0005/0011 只规定「不进 system 前缀」，没规定检索块在会话消息流中的**位置**。ST 的经验表明：注入位置越靠前（历史头部），后续消息的 KV 复用被打断得越多；注入在尾部（如 ST 的 in-chat @ depth 2、Risu 直接 unshift 到摘要区之后）对缓存更友好但对模型注意力影响不同。这是实现期必须定的参数，建议在检索口契约里显式声明注入深度。
- 「不把整份工作副本每轮全塞」（ADR-0005）与 Letta 文档的分层建议一致（重要的进 blocks、不常用的进 archival 按需查）——业界同向。

### 7.4 运行时与主动消息（ADR-0002、0015）

- 业界两极：Letta/elizaOS 是**常驻 agent**（Letta 还有后台自醒的 sleep-time agent；elizaOS agent 常驻多客户端）；ST/Risu/Agnai 是**纯被动前端**，没有跨会话主动消息（ST 群聊 auto-mode 只是页面内定时器）。本框架「按需拉起 + 框架只提供口、应用调度」（ADR-0002/0015）落在中间，与 Agnai「designed with scale in mind」的无常驻取向一致，成本模型更适合多用户产品。
- **本框架优点**：ADR-0015 的「回合触发记录 + 忙拒绝」在被调研框架里完全没有对应物——Letta sleep-time 没有触发审计，ST auto-mode 没有并发控制。这是少见的严谨设计。
- **风险**：框架不含调度器意味着每个应用要自己实现「到期项、投递、重试」。Letta 的 `sleeptime_agent_frequency`（每 N 步）和 Open WebUI 的 `MEMORIES_REVIEW_INTERVAL_TURNS`（每 N 回合）说明「按回合数触发的默认调度」是低成本高收益的公约数，框架可以考虑提供一个可选的参考调度器（不进默认，仍守 ADR-0015 的边界）。

### 7.5 验收（ADR-0010）

- ST/Risu/Agnai 完全没有程序化记忆验收；mem0 有研究性 benchmark，但不是面向角色包作者的验收套件。「跑完给定对话→对导出断言（含跨用户不泄漏）」是业界空白，本框架优点明显。
- **风险**：扮演验收的「必现/禁现」对采样随机性敏感，业界连尝试都少（只有 ST 世界书的确定性关键词机制可借来构造可复现刺激）。建议扮演剧本固定 seed/温度或用多次采样通过率而非单次判定。

### 7.6 扩展机制对照（ADR-0007 的边界）

ST 的扩展是「任意 hook + 可变全局状态」（`getContext().chat` 直接可变、`generate_interceptor` 拦截请求），生态繁荣但正是 ADR-0007 明确拒绝的形态——绕过归属、无法对账。本框架用「四口 + 注册名」换约束力，代价是失去 ST 式的野蛮生长能力；这是有意识的取舍，双方证据都摆在那里。

---

## 8. 值得借鉴的具体机制清单

1. **抽取水位线锚定到消息 ID**（ST Summarize 的 metadata 锚定、Risu `lastId`）：给「入账进度」一个指针，回源（ADR-0008）从指针之后扫即可。[Summarize 文档](https://docs.sillytavern.app/extensions/summarize/)、[supaMemory.ts](https://github.com/kwaroran/RisuAI/blob/main/src/ts/process/memory/supaMemory.ts)
2. **mem0 的两阶段合并 prompt**（先抽事实、再与既有记忆逐条比对输出 ADD/UPDATE/DELETE/NONE）：默认策略「抽取」口判定「新增 vs 修正 vs 收回」可直接改造其 `DEFAULT_UPDATE_MEMORY_PROMPT`，含大量分类样例。[prompts.py](https://github.com/mem0ai/mem0/blob/main/mem0/configs/prompts.py)
3. **mem0 的 `expiration_date` 与 ADD-only + `linked_memory_ids`**：承诺/计划类记忆天然带失效期；「链接而非改写」可作为「修正」事件与旧事件的引用结构。[Memory operations 文档](https://docs.mem0.ai/core-concepts/memory-operations)
4. **Letta memory block 的 `label + description + limit`**：工作副本按命名块组织（如 `identity`、`preferences`、`promises`），导出更可读、编译更可控；`read_only` 块 ≈ 本框架的角色定义片段。[Memory blocks 文档](https://docs.letta.com/guides/core-concepts/memory/memory-blocks/)
5. **每 N 回合的后台整理**（Letta sleep-time `sleeptime_agent_frequency`、Open WebUI `MEMORIES_REVIEW_INTERVAL_TURNS`）：异步抽取/编译压实的默认调度节奏，可作为参考实现参数。[Sleep-time 文档](https://docs.letta.com/guides/agents/architectures/sleeptime/)、[Open WebUI Memory 文档](https://docs.openwebui.com/features/chat-conversations/memory/)
6. **世界书的确定性检索器**（关键词 + 常驻 + 预算 + 优先级 + 递归，ST/CCv3）：作为默认记忆策略「检索」口之外的一种可注册策略——ST 文档明说要确定性就用关键词；也是验收剧本构造可复现刺激的工具。[World Info 文档](https://docs.sillytavern.app/usage/worldinfo/)
7. **Agnai 的 priority（预算丢弃序）与 weight（呈现序）分离**：检索口返回块时，裁剪次序和拼装次序是两个维度，别用一个数。[common/memory.ts](https://github.com/agnaistic/agnai/blob/dev/common/memory.ts)
8. **CCv3 decorators 的「位置声明在内容里」**（`@@depth`、`@@role`、`@@position`）：片段自带注入深度/角色声明，框架不必为每类片段发明新字段。[SPEC_V3.md Decorators 节](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)
9. **`extensions` 未知键不销毁**（CCv2/v3）：角色包片段的前向兼容原则，导入导出必守。[spec_v2.md](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md#extensions)
10. **elizaOS fact 的 `(subject, predicate, object, confidence, source)`**：记忆事件 payload 的结构化参考；`source` 指回原始消息，正好承载本框架「原文必落库 + 回源」的锚点。[Memory & State 文档](https://docs.elizaos.ai/runtime/memory)
11. **记忆的用户可见可编辑 UI**（ST Summarize 的当前摘要框 + Restore Previous、Open WebUI Personalization 面板、Letta 桌面端 memory viewer）：业界共识是让用户直接看到并纠正记忆；本框架的导出口可以顺势长出「查看当前看法 + 显式收回」的产品面。[Summarize 文档](https://docs.sillytavern.app/extensions/summarize/)、[Open WebUI Memory 文档](https://docs.openwebui.com/features/chat-conversations/memory/)
12. **Open WebUI 的 user/context 两类记忆分预算注入**：检索口返回的「关于用户的事实」与「其他持久上下文」分别限额，防止一类挤占另一类。[Open WebUI Memory 文档](https://docs.openwebui.com/features/chat-conversations/memory/)
