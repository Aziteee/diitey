# 核心拥有受鉴权 admin surface

核心在 publicServer 的 `/_admin` 命名空间上拥有独立的管理 surface：登录会话、document、资源构建与托管、插件 admin 页路由和 admin Action 分派。admin 与发布站点共用 origin 和 publicServer，但不属于主题发布信息架构；主题 document、主题 islands 与 `ThemeDefinition.routes` 不参与 admin。

插件可声明至多一个只在 admin surface 出现的浏览器组件（插件 admin island）。核心拥有路径、鉴权、SSR shell 与 Action 访问契约；插件不声明自定义 admin path，也不获得发布路由或主题 chrome 控制权。这是对 ADR-0003「插件无浏览器组件」的显式窄化：例外仅限受鉴权 admin surface，不授权插件注入发布页 UI。

未配置 admin token 时整个 `/_admin` 命名空间返回 404，且不构建 admin 资源。admin 启用时，非 loopback public origin 必须为 HTTPS；核心不信任转发头推导外部 origin。

**残余风险**：admin 与发布页同 origin，同 origin XSS 可升级为已登录操作者的 admin 操作。cookie path 与 CSRF 不能形成 origin 隔离。V1 接受该风险并为 admin 响应设置严格 CSP；若未来要承载不可信发布脚本，必须把 admin 迁移到独立 origin。
