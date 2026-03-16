## 核心流程

streaming 目录现在主要在做三件事：

1. 把后端返回的字节流解析成完整的 SSE 事件
这里通过 ReadableStream 的 reader.read()、TextDecoder，再配合 EventSourceParser，把碎片字节拼成一条条完整 SSE 消息。

2. 把 SSE 协议事件翻译成 domain action。
例如 message_start、content_block_start、content_block_delta，会被转换成 message-appended、content-block-started、text-block-delta-received 这类 dispatchDomain action，来更新数据。

3. 维护“仅流处理中需要”的临时状态。
activeContentBlocks 它负责处理：

text 的增量长度和 citation 起止位置
tool_use 的 partial_json 缓冲
tool_result 按 tool_use_id 挂回父 block

## SSE 事件及数据

当前 `completion-stream.ts` 一共处理 9 种事件：

它能带来什么数据，以及为什么？

| event | data |
| --- | --- |
| `message_start` | `{ type: "message_start", message: { content: [], id, model, parent_uuid, role: "assistant", stop_reason: null, stop_sequence, type: "message", uuid } }` |
| `message_snapshot` | `{ type: "message_snapshot", message: NewChatMessage }` |
| `content_block_start` | `{ type: "content_block_start", index, content_block }`。其中 `content_block.type` 可能为：`text`（`citations`, `start_timestamp`, `stop_timestamp`, `text`）、`tool_use`（`display_content`, `icon_name`, `id`, `input`, `message`, `name`, `start_timestamp`, `stop_timestamp`）、`tool_result`（`display_content`, `icon_name`, `is_error`, `message`, `name`, `start_timestamp`, `stop_timestamp`, `tool_use_id`）。 |
| `content_block_delta` | `{ type: "content_block_delta", index, delta }`。其中 `delta.type` 可能为：`text_delta`（`text`）、`citation_start_delta`（`citation`）、`citation_end_delta`（`citation_uuid`）、`input_json_delta`（`partial_json`）、`tool_use_block_update_delta`（`display_content`, `message`）、`tool_result_block_update_delta`（`display_content`, `is_error?`, `message`）。 |
| `content_block_stop` | `{ type: "content_block_stop", index, stop_timestamp }` |
| `message_delta` | `{ type: "message_delta", delta: { stop_reason, stop_sequence } }` |
| `message_limit` | `{ type: "message_limit", message_limit: ChatMessageLimit }` |
| `message_stop` | `{ type: "message_stop" }` |
| `title` | `{ title: string }` |

## activeContentBlocks 计算 citations
