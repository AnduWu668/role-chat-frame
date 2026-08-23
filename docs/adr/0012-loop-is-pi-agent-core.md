# 对话循环用 pi-agent-core，不套 coding-agent

每个回合用 `@earendil-works/pi-agent-core` 的 `Agent`：稳定人设放 `systemPrompt`，本轮记忆经 `transformContext` 注入，不写进 system。角色包、记忆四口、会话落库、回源、验收都在 loop 外，由本框架做。不 fork Pi，也不用 `createAgentSession` 的默认编码提示和四件套工具。需要 `/tree` 或 TUI 时再另议，不作为第一界面。
