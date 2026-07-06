# LLM 路由 PRD

## 概述

LLM Router 以 **OpenAI 兼容协议**（`/v1/chat/completions`）作为统一接口，所有供应商通过可配置的 `baseUrl` + `apiKey` 接入。参考 [cc-switch](https://github.com/farion1231/cc-switch) 的供应商管理模式。

## 设计原则

1. **OpenAI 协议为主**：所有供应商统一走 `chat/completions` 格式
2. **供应商可扩展**：用户可添加任意 OpenAI 兼容端点
3. **Web UI 切换**：在设置页切换当前供应商和模型
4. **预设模板**：内置火山豆包、OpenAI、OpenRouter、Ollama 等预设

## 供应商注册表

配置路径：`~/.kako/config/providers.json`

```json
{
  "version": 1,
  "active": {
    "providerId": "volcengine-doubao",
    "model": "ep-your-endpoint-id"
  },
  "providers": [
    {
      "id": "volcengine-doubao",
      "name": "火山引擎豆包",
      "protocol": "openai-compatible",
      "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
      "apiKey": "${ARK_API_KEY}",
      "models": ["ep-your-endpoint-id"],
      "defaultModel": "ep-your-endpoint-id",
      "enabled": true,
      "preset": "volcengine-doubao"
    }
  ]
}
```

## 内置预设

| 预设 ID | 名称 | Base URL |
|---------|------|----------|
| `volcengine-doubao` | 火山引擎豆包 | `https://ark.cn-beijing.volces.com/api/v3` |
| `openai` | OpenAI | `https://api.openai.com/v1` |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` |
| `ollama` | Ollama 本地 | `http://localhost:11434/v1` |
| `custom` | 自定义 | 用户填写 |

## 火山豆包测试配置

1. 登录 [火山方舟控制台](https://console.volcengine.com/ark)
2. 创建 API Key → 环境变量 `ARK_API_KEY`
3. 创建模型接入点 → 获得 `ep-xxxxxxxx` 模型 ID
4. 在 Web UI 点击「添加火山豆包」，填入 Key 和接入点 ID
5. 点击「测试」验证连通性

## 统一接口

```typescript
interface LLMRouter {
  complete(request: LLMRequest): Promise<LLMCompletion>;
  stream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
}
```

内部实现：`openaiCompatibleStream()` / `openaiCompatibleComplete()` → `POST {baseUrl}/chat/completions`

## 模型选择优先级

1. Agent 定义 `model` 字段（若非空）
2. `providers.json` → `active.model`
3. Provider `defaultModel`
4. Provider `models[0]`

## Web UI（apps/web）

| 功能 | 说明 |
|------|------|
| 供应商列表 | 查看/编辑/删除已注册供应商 |
| 添加预设 | 一键从模板创建（豆包优先） |
| 切换当前 | 设置 active provider + model |
| 测试连接 | 发送测试 prompt，显示延迟和响应 |
| MCP 管理 | 见 [10-mcp.md](./10-mcp.md) |

启动方式：

```bash
pnpm dev:server   # API :3721
pnpm dev:web      # UI  :5173
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/providers` | GET/POST | 供应商列表 / 保存 |
| `/api/providers/from-preset` | POST | 从预设创建 |
| `/api/providers/active` | GET/PUT | 当前选择 |
| `/api/providers/test` | POST | 测试连通性 |
| `/api/presets` | GET | 预设模板列表 |

## 流式输出

- SSE 流 → CLI/App 实时渲染
- 支持 `text_delta` 和 `tool_call_delta`
- 流结束附带 token usage

## 重试与 fallback

```json
{
  "routing": {
    "fallbackChain": [
      { "providerId": "volcengine-doubao", "model": "ep-xxx" },
      { "providerId": "openai", "model": "gpt-4o" }
    ],
    "maxRetries": 3,
    "retryDelayMs": 1000
  }
}
```

## 迁移说明

旧版 `providers.yaml` 仍可读，但新安装默认使用 `providers.json`。所有供应商统一为 `openai-compatible` 协议；Anthropic 原生 adapter 保留代码但不再默认启用。

## Phase 划分

| 能力 | Phase | 状态 |
|------|-------|------|
| OpenAI 兼容统一协议 | 1.5 | ✅ |
| 供应商注册表 + 预设 | 1.5 | ✅ |
| Web UI 切换/测试 | 1.5 | ✅ |
| 火山豆包预设 | 1.5 | ✅ |
| Token 成本仪表盘 | 3 | 待定 |
