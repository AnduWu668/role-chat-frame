# 变化的记忆不写入 system 前缀

角色定义进 `pi-agent-core` 的 `systemPrompt`，并保持稳定。检索到的用户记忆另块注入，不拼进同一根 system 字符串。Prompt / KV cache 要精确前缀匹配：system 里一改记忆，整条 system 以及后面的对话都会从第一个改动处重算。人设每轮几乎不变，记忆每轮可能变，二者不能焊在一起。
