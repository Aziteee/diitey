# 运行日志：Pino、start 进程 stdout，插件经服务上下文

V1 用 [Pino](https://getpino.io/) 做运行可观测性日志：仅 `diitey start` 进程写入，**全部打到 stdout**（info/warn/error 不分流）。默认输出 JSON Lines；当 stdout 是 TTY 时用 `pino-pretty` 做人类可读行。最低级别由 `DIITEY_LOG_LEVEL` 控制（error / warn / info，默认 info）。`pino` 与 `pino-pretty` 均为正式依赖。不写本地日志文件，也不在 admin surface 查询历史日志——采集与轮转交给部署侧。

**谁写**：核心主动记录进程启停、站点程序形成、插件迁移生命周期、内容 reload、请求期未处理错误与 5xx。插件仅通过 `PluginServiceContext` 注入的 logger 写 `level + message`（核心用 child logger 固定 `pluginId` 等 bindings）；主题服务端代码不注入 logger；snapshot worker 不直接写日志，构建成败由主进程记。`diitey reload|status` 的 JSON 结果继续独占该命令的 stdout；运行日志只出现在 `start` 服务进程。

**明确不做**：默认 HTTP 全量 access log、管理审计日志存储、内容正文或密钥/token/cookie 入日志、error→stderr 分流、模块顶层或 `definePlugin` 静态定义阶段写日志。迁移仍为声明式 SQL，无 JS migrate hook；迁移可观测性只靠核心事件。

相对「手写文本 logger」或「自管日志文件 / admin 查日志」，选 Pino 换取结构化 JSON 与 child logger，并用 TTY 检测兼顾本地可读性；与 ADR-0005 单进程本地部署一致，并保持插件服务为动态能力的受支持边界。
