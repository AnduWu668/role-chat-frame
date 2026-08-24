# 存储接口属于核心，存储实现属于应用

核心定义只读的 `CharacterDefinitionStore`、`PersonaStore`，以及支持分页读取、按 `turnId` 查找和条件提交的 `SessionStore`；应用提供内存、文件、SQL、NoSQL 或远程适配器。核心在召回记忆和调用模型前先按 `sessionId + turnId` 查找已提交回合：用户输入相同就恢复已保存的权威回合，用户输入不同则报告 `turn-id-conflict`。

会话提交仍必须携带不透明的 `expectedRevision` 和稳定的 `turnId`，并先检查 `sessionId + turnId`、再检查版本冲突。已有回合的用户输入相同时返回该权威回合，不比较重新生成的模型输出；只有用户输入不同时才是 `turn-id-conflict`。没有已有回合时才比较 `expectedRevision` 并原子写入。这样并发竞争仍不会重复写入，响应丢失后的重试也不依赖模型再次生成相同文本。

不提供通用 `Storage<T>`，也不把创建、列表、删除、认证、迁移或记忆数据管理塞进聊天热路径接口。不同数据的读取和一致性需求并不相同；记忆持久化继续由各 `MemorySystem` 自己负责。
