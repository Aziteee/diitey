# Mail 插件

SMTP 邮件投递能力。仅声明 `mail.send` 插件服务，**不**暴露 public Action（避免开放中继）。其它插件通过核心插件服务调用触发投递。

## 启用

```ts
plugins: [
  {
    use: "./plugins/mail/plugin.ts",
    config: {
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "noreply@example.com",
      pass: process.env.SMTP_PASS ?? "",
      from: "Site <noreply@example.com>",
      sendTimeoutMs: 3000,
    },
  },
],
```

配置变更需重启。

## 服务

### `mail.send`

输入：

```ts
{
  to: string;       // 收件地址
  subject: string;
  text: string;     // 纯文本正文
  replyTo?: string | null;
}
```

输出：`{ sent: true }`。

SMTP 失败或超时时抛错；调用方（如 comments）应自行决定是否吞掉错误。
