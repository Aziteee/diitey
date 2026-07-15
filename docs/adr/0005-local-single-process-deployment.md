# V1 采用本地单进程部署

V1 固定为单站点、单 Bun 进程、持久化本地磁盘和 SQLite，不支持 Serverless、多实例或共享文件系统。这个选择用水平扩展和托管部署兼容性换取文件内容、进程内快照、速率限制与本地数据库之间简单且确定的协调模型；未来若引入多实例，需要重新设计内容分发、并发写入、缓存一致性和限流语义，而不能假定现有保证自然成立。

publicServer 默认只监听 loopback（`127.0.0.1`），可通过部署参数显式对外监听。核心按可能公网访问设计 admin 应用层安全：外部 origin 由显式 public origin 配置固定，不从 `Forwarded` / `X-Forwarded-*` 猜测；admin 启用且 public origin 非 loopback 时要求 HTTPS public origin。TLS 终止与反向代理由部署者负责。
