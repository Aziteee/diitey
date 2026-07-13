# 内容 reload 固定使用启动时的站点程序

内容 `reload` 只重建内容快照并替换有效发布视图，始终使用服务启动时固定的站点程序（主题、插件、页面计划、island 与 `programRevision`）。主进程与 snapshot worker 必须确认同一 `programRevision`；worker 超时或崩溃后保留当前有效发布视图，并将 reload 标记为不可用，要求重启站点，而不是从当前磁盘静默重新加载扩展。相比每次 reload 重新解析扩展，这避免页面、插件运行时和 island 资源混用不同版本，代价是主题、插件或 `site.config.ts` 变更必须通过进程重启生效。
