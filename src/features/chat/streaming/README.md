## 核心功能

`streaming` 目录负责三件事：

1. 把后端返回的字节流解析成完整的 SSE 事件。
2. 把协议事件翻译成 domain action。
3. 维护只在流处理中需要的临时状态，例如当前 text block 的长度、未闭合 citation、正在流式拼装的 tool_result `display_content`。

## 当前协议

### message 事件

- `message_start`
- `message_snapshot`
- `message_update`
- `message_limit`
- `message_stop`

约定：

- `message_start` / `message_snapshot` 返回完整对象。
- `message_update.delta` 只承载消息级 patch，例如 `stop_reason`、`stop_sequence`。
- `message_stop` 只是结束信号，不再携带状态字段。

示例：

```txt
event: message_start
data: {"type":"message_start","message":{"content":[],"created_at":"2026-03-19T09:10:36.622Z","id":"chatcompl_019d055c6d4775a99edc470e646aadd8","model":"claude-sonnet-4-6","parent_uuid":"019d055c-6d47-75a9-9edc-4084cfdf26eb","role":"assistant","stop_reason":null,"stop_sequence":null,"type":"message","updated_at":"2026-03-19T09:10:36.622Z","uuid":"019d055c-6d47-75a9-9edc-470e646aadd8"}}

event: message_update
data: {"type":"message_update","delta":{"stop_reason":"end_turn","stop_sequence":null}}

event: message_stop
data: {"type":"message_stop"}
```

### content_block 事件

- `content_block_start`
- `content_block_delta`
- `content_block_update`
- `content_block_stop`

约定：

- `content_block_delta` 只保留真正的流式增量，例如 `text_delta`、`citation_start_delta`、`citation_end_delta`、`input_json_delta`。
- `content_block_update.update` 承载对象字段更新，不再把工具调用的 patch 塞进 `delta`。
- `content_block_stop` 只返回 `index + stop_timestamp`。

完整案例 A：`text + citation`

```txt
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"citations":[],"start_timestamp":"2026-03-19T08:52:39.775Z","stop_timestamp":null,"text":"","type":"text","flags":null}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Mock response to: **OpenAI Codex pricing 2026**\n\n"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"citation_start_delta","citation":{"uuid":"citation-1","title":"How Affordable Is GPT-5 Codex Pricing for Developers in 2026","url":"https://apidog.com/blog/codex-pricing/","metadata":{"type":"webpage_metadata","site_domain":"apidog.com","site_name":"Apidog"},"origin_tool_name":"web_search","sources":[{"uuid":"citation-source-1","title":"How Affordable Is GPT-5 Codex Pricing for Developers in 2026","url":"https://apidog.com/blog/codex-pricing/","icon_url":"https://www.google.com/s2/favicons?sz=64&domain=apidog.com","source":"Apidog"}]}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"每五小时 30–150 个本地任务（含周限额），支持 CLI 和 IDE 集成"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"citation_end_delta","citation_uuid":"citation-1"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"。"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0,"stop_timestamp":"2026-03-19T09:09:02.407Z"}
```

完整案例 B：`tool_use + tool_result`

```txt
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"display_content":null,"icon_name":"globe","id":"tool_1","input":null,"message":"Searching the web","name":"web_search","start_timestamp":"2026-03-19T14:08:49.866Z","stop_timestamp":null,"type":"tool_use","flags":null}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"OpenAI Cod"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"ex pricing 2026\"}"}}

event: content_block_update
data: {"type":"content_block_update","index":0,"update":{"input":{"query":"OpenAI Codex pricing 2026"},"message":"Fetching: https://developers.openai.com/codex/pricing/","display_content":{"preview_url":"https://developers.openai.com/codex/pricing/"}}}

event: content_block_stop
data: {"type":"content_block_stop","index":0,"stop_timestamp":"2026-03-19T14:19:56.685Z"}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"display_content":null,"icon_name":"globe","is_error":false,"message":"Found 3 sources","name":"web_search","start_timestamp":"2026-03-19T14:19:57.187Z","stop_timestamp":null,"tool_use_id":"tool_1","type":"tool_result","flags":null}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"[{\"title\":\"DeepSeek API Pricing\",\"url\":\"https://apidog.com/blog/codex-pricing/\"}]"}}

event: content_block_update
data: {"type":"content_block_update","index":1,"update":{"message":"Found 3 sources","display_content":[{"title":"DeepSeek API Pricing","url":"https://apidog.com/blog/codex-pricing/"}]}}

event: content_block_stop
data: {"type":"content_block_stop","index":1,"stop_timestamp":"2026-03-19T14:20:00.132Z"}
```

## tool_use / tool_result 规则

### tool_use

- `content_block_start` 创建壳对象。
- 当前项目仍通过 `content_block_delta(type = "input_json_delta")` 发送 `input` 的 partial JSON，并用 `partial-json` 实时解析。
- `content_block_update.update.input` 仍会保留，作为完整 input 快照；当前项目不依赖它做实时解析。
- `content_block_update.update.message` / `display_content` 用于更新标题和展开态展示。
- `content_block_stop` 不再兜底返回 input。

### tool_result

- `content_block_start` 创建独立的 `tool_result` block。
- `content_block_delta(type = "input_json_delta")` 继续用于流式拼装 `display_content`。
- `content_block_update` 可覆盖 `message`、`display_content`、`is_error`。
- 前端最终仍会把 `tool_result` 挂到对应 `tool_use.tool_result` 上。

## activeContentBlocks 的意义

`activeContentBlocks` 是一个 `Map<number, ActiveContentBlock>`，key 是 stream 中的 `content_block.index`。它只在流处理期间存在。

### 1. `text`

```ts
{
  type: "text";
  textLength: number;
  openCitations: Map<string, { citation; startIndex }>;
}
```

- `textLength`：每收到 `text_delta`，就把 delta 的字符数累加上去。
- `openCitations`：在 `citation_start_delta` 记录起点，在 `citation_end_delta` 用当前 `textLength` 计算终点。

### 2. `tool_use`

```ts
{
  type: "tool_use";
  inputJsonBuffer: string;
}
```

- `inputJsonBuffer`：累计 `input_json_delta.partial_json`，并用 `partial-json` 做容错解析。
- 它既负责支持当前 UI 的实时 input 展示，也负责在 `content_block_update` 到来前维护中间态。

### 3. `tool_result`

```ts
{
  type: "tool_result";
  toolUseId: string;
  displayContentJsonBuffer: string;
}
```

- `displayContentJsonBuffer`：累计 `input_json_delta.partial_json`，尝试解析完整 `display_content`。
- `toolUseId`：把 `tool_result` 的更新挂回父 `tool_use`。

## 事件到 action 的映射

- `message_start` -> `message-appended`
- `message_snapshot` -> `message-snapshot-received`
- `message_update` -> `message-updated`
- `message_limit` -> `message-metadata-updated`
- `content_block_start` -> `content-block-started` / `tool-result-started`
- `content_block_delta` -> `text-block-delta-received` / `text-block-citation-added` / `tool-result-updated`
- `content_block_update` -> `tool-use-updated` / `tool-result-updated`
- `content_block_stop` -> `content-block-stopped` / `tool-result-stopped`
- `title` -> `title-updated`

## 关于 `event` 和 `data.type`

当前实现会同时输出：

```txt
event: content_block_update
data: {"type":"content_block_update", ...}
```

但业务分发仍然以 `data.type` 为准，原因是：

1. TypeScript 可以基于 `type` 做联合类型收窄。
2. JSON payload 在重放、持久化、迁移到非 SSE 传输层时仍然自描述。
3. `event:` 只是传输层镜像，便于调试和在某些服务端逻辑中快速判断事件边界。
