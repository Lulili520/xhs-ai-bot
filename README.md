# 小红书 AI 客服机器人

通过 Playwright 操作小红书专业号客服页面，检测新文字消息并串行回复。支持 DeepSeek Chat Completions、OpenAI Responses API、短期会话上下文、超时重试以及无密钥/接口故障时的安全降级回复。

机器人还会在独立标签页监控店铺动态回收报价。客户询问金价时，AI 只能根据最新缓存报价回答；报价超过允许时间未更新时会拒绝引用旧价格。

金价问题只读取 `GOLD_PRODUCT_NAME=黄金` 对应的“回购价”，不会读取销售价、高低价或其他品类，并从多种自然话术中选择回复。其他问题由 AI 结合最近对话简短交流，在合适时自然引导加微信；回复提到“微信”或“名片”时，程序会从“获客工具”自动发送指定微信名片。同一次运行中每位客户最多发送一次，避免重复打扰。

## 启动

要求 Node.js 18+、本机 Chrome，以及可登录的小红书专业号账号。

```bash
npm install
cp .env.example .env
npm start
```

多账号统一配置在 `accounts.json`，每个账号必须使用不同的 `profileDir`。一键启动所有 `enabled` 账号：

```bash
npm run start:all
```

某个账号还没登录时，对应 Chrome 窗口会停留在登录页面；完成登录后该账号自动进入客服服务。主终端按 `Ctrl+C` 会统一关闭全部账号，单个账号意外退出会在 5 秒后自动重启。

第一次运行会打开 Chrome，请手动登录。登录信息保存在 `xhs-profile/`，其中包含敏感凭据，不要上传或分享。

运行日志会同时保存在 `data/service.log`，终端关闭后仍可排查漏回复、AI 错误和名片发送失败。

默认使用 DeepSeek。把官方密钥填入 `DEEPSEEK_API_KEY` 后，直接执行 `npm start` 即可；启动命令会自动加载 `.env`。程序使用 `deepseek-v4-flash`，并自动关闭不必要的思考模式。不设置密钥也可以运行，但只会使用安全降级话术。

切换回 OpenAI 时设置 `AI_PROVIDER=openai`，并配置 `OPENAI_API_KEY`、`OPENAI_MODEL` 和 `OPENAI_BASE_URL`。

微信名片默认选择企业微信：`WECHAT_CARD_TYPE=enterprise`。个人微信使用 `personal`。程序通过标题“企微”和说明中的“@成员”识别企业微信，通过“微信”和“号码”识别个人微信，不会跨类型回退。
若当前账号对应类型只有一张卡片，`WECHAT_CARD_NAME` 可以留空并自动选择；存在多张时必须填写完整标题，避免发错。设置 `WECHAT_CARD_ENABLED=false` 可关闭自动发卡片。

## 安全边界

- 只回复程序启动后的新文字消息。
- 发送前校验联系人、原消息以及是否已有人工回复。
- AI 不应编造订单、价格、库存、物流和售后状态。
- AI 超时或失败时自动降级，不把接口错误发送给客户。
- 会话上下文目前只保存在内存，重启后清空。

## 验证

```bash
npm run check
npm test
```
