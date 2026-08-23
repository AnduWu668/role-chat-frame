# role-chat-frame

远程：https://github.com/AnduWu668/role-chat-frame

一对一角色聊天框架。产品层只维护用户和角色；会话、记忆策略、对话循环在框架里。

当前仓库先落下 grill 结论，实现尚未开始。

- 术语：[CONTEXT.md](CONTEXT.md)
- 决策：`docs/adr/`

| ADR | 标题 |
| --- | --- |
| [0001](docs/adr/0001-memory-belongs-to-user-character.md) | 记忆挂在关系上，不挂在单场会话上 |
| [0002](docs/adr/0002-runtime-is-per-session-and-on-demand.md) | 运行时按会话按需拉起 |
| [0003](docs/adr/0003-default-memory-is-event-log-plus-projection.md) | 默认记忆是事件日志加投影 |
| [0004](docs/adr/0004-memory-strategy-must-export-plaintext.md) | 自定义记忆策略必须能导出明文 |
| [0005](docs/adr/0005-context-is-prefix-session-and-retrieved-memory.md) | 上下文是前缀、近期会话、检索记忆 |
| [0006](docs/adr/0006-default-memory-strategy-is-auto-attached.md) | 未声明时自动挂默认记忆策略 |
| [0007](docs/adr/0007-memory-strategy-has-four-ports.md) | 记忆策略只有四口 |
| [0008](docs/adr/0008-extract-before-session-compact.md) | 原文必落库；抽取可异步；检索回源 |
| [0009](docs/adr/0009-sync-extract-for-remember-retract-promise.md) | 显式记住、收回、承诺走同步抽取 |
| [0010](docs/adr/0010-acceptance-is-export-asserts-and-roleplay-scripts.md) | 验收：导出断言 + 扮演剧本 |
| [0011](docs/adr/0011-changing-memory-must-not-enter-system-prefix.md) | 变化的记忆不进 system 前缀 |
| [0012](docs/adr/0012-loop-is-pi-agent-core.md) | 对话循环用 pi-agent-core |
| [0013](docs/adr/0013-character-is-slug-plus-version.md) | slug 稳定，版本只换前缀 |
| [0014](docs/adr/0014-product-is-user-and-character-session-is-framework.md) | 产品认用户和角色；会话在框架；重开显式调用 |
