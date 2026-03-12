# useChat 设计规范

本文档是当前项目中 `useChat`、mock SSE 接口和首页演示 UI 的最新设计参考。

## 1. 范围

- 当前实现单会话聊天，支持：
  - 普通发送
  - 停止生成
  - assistant 重新生成
  - user 消息侧重新生成入口
  - user 消息编辑并生成新分支
  - user / assistant 两侧分支切换
- 首页输入区支持用 shadcn `Select` 切换本次提交使用的模型。
- `messages` 对外仍然是数组，但内部真实状态已经不是线性数组，而是消息树。
- 当前项目是 TanStack Start。
- 当前不直连外部 `claude.ai`，而是在项目内提供 mock SSE 接口。
- 请求 API 和 conversation id 仍然在 hook 内部固定；模型改为由首页输入区选择后随请求发送。

## 2. useChat 对外 API

返回值：

```ts
{
  editUserMessage,
  getBranchState,
  messages,
  input,
  onInputChange,
  regenerate,
  regenerateUserMessage,
  selectBranch,
  sendMessage,
  status,
  stop,
}
```

### 2.1 messages

```ts
interface Message {
  uuid: string;
  index: number;
  content: ContentType[];
  role: "user" | "system" | "assistant";
  model: string;
  created_at: string;
  updated_at: string;
  stop_reason: "end_turn" | "stop_sequence" | "user_canceled" | null;
  files: string[];
  metadata: {
    message_limit?: MessageLimit;
  };
  parent_message_uuid: string;
}

interface ContentType {
  start_timestamp: string;
  stop_timestamp: string | null;
  type: "text" | "tool_use";
}

interface TextContentBlock extends ContentType {
  type: "text";
  text: string;
  citations: Citation[];
}

interface Citation {
  uuid: string;
  start_index: number;
  end_index: number;
  title: string | null;
  url: string | null;
  metadata: {
    type?: string;
    site_domain?: string;
    favicon_url?: string;
    site_name?: string;
  } | null;
  origin_tool_name: string | null;
  sources: CitationSource[];
}

interface CitationSource {
  uuid: string;
  title: string | null;
  url: string | null;
  icon_url: string | null;
  source: string | null;
}

interface ToolUseContentBlock extends ContentType {
  type: "tool_use";
  id: string;
  name: string;
  icon_name: string | null;
  input: Record<string, unknown> | null;
  message: string | null;
  display_content: unknown | null;
  tool_result: ToolResultContentBlock | null;
}

interface ToolResultContentBlock {
  type: "tool_result";
  tool_use_id: string;
  name: string;
  icon_name: string | null;
  message: string | null;
  display_content: unknown | null;
  is_error: boolean;
  start_timestamp: string;
  stop_timestamp: string | null;
}

interface MessageLimit {
  type: "within_limit" | string;
  resetsAt: string | number | null;
  remaining: number | null;
  perModelLimit: number | null;
  representativeClaim: string | null;
  overageDisabledReason: string | null;
  overageInUse: boolean;
  windows: Record<
    string,
    {
      status: string;
      resets_at: number | null;
      utilization: number | null;
    }
  >;
}
```

约束：

- `messages` 表示“当前活跃分支”的线性顺序数组，但它是由内部树结构派生出来的。
- 每条消息都保留 `uuid`、`parent_message_uuid` 和 `index`。
- 首条用户消息的 `parent_message_uuid` 使用固定根节点：
  `"00000000-0000-4000-8000-000000000000"`。
- `index` 只表示消息创建顺序，不参与分支顺序判断。
- 例如：`user = 0`、`assistant = 1`、同一 user 下重新生成出的 `assistant = 2`、下一条 user 再是 `3`。
- 用户消息的 `content` 当前只支持单个文本块。
- assistant 消息支持文本块和工具调用块混排。
- `text` block 的 `text` 保存原始 Markdown 源串；`citations` 是挂在该 block 上的区间注解。
- 工具调用块在前端状态中会把 `tool_result` 嵌套到对应 `tool_use` 下，不单独作为第二个消息块展示。
- assistant 消息在流式生成期间允许 `stop_reason = null`。
- `model` 直接挂在消息顶层字段上，user 和 assistant 都保留。
- `message_limit` 落到 assistant 消息的 `metadata.message_limit` 中。

### 2.2 input / onInputChange

- 用于受控表单。
- 提交成功后自动清空。

### 2.3 sendMessage

```ts
type sendMessage = (message: SendMessageInput) => Promise<void>;

interface SendMessageInput {
  prompt: string;
  files?: string[];
  model?: string;
  parentMessageUuid?: string;
}
```

约束：

- `sendMessage` 使用对象入参，便于后续扩展。
- `prompt` 会先做 `trim()`。
- `prompt` 为空时直接抛错。
- `parentMessageUuid` 可选：
  - 不传时，默认挂到当前分支的 `current_leaf_message_uuid` 下。
  - 传入时，在指定父节点下创建新的 user message。
- `model` 不传时回退默认模型；传入时会同时写进本地 user message 和请求体。
- `files` 只传文件 id 数组；未来接入上传后，预览对象应单独拉取和维护，不写进 completion 请求体。
- 首页主输入框会调用 `sendMessage({ prompt, model })`。
- `sendMessage` 是底层 primitive；“编辑用户消息”会再包一层更明确的 `editUserMessage(...)`。
- 当 `status` 为 `submitted` 或 `streaming` 时再次调用 `sendMessage`，直接抛错。
- 当前版本不做排队，也不做“自动中断上一条再发送下一条”。
- `sendMessage` 成功返回表示本轮流已经完整消费到 `message_stop`。

### 2.4 regenerateUserMessage

```ts
type regenerateUserMessage = (
  userMessageUuid: string,
  input?: RegenerateMessageInput
) => Promise<void>;
```

约束：

- `regenerateUserMessage` 只能对 user 消息调用。
- 会复用该 user 消息的 `files`。
- 重新生成时不会创建新的 user 消息。
- 新 assistant 消息的 `parent_message_uuid` 指向该 user 消息本身。
- 请求体中的 `trigger` 为 `"regenerate"`。
- `prompt` 允许为空字符串；服务端应优先基于 `parent_message_uuid` 回溯原 user 消息。
- 当 `status` 为 `submitted` 或 `streaming` 时调用，直接抛错。

### 2.5 regenerate

```ts
type regenerate = (
  assistantMessageUuid: string,
  input?: RegenerateMessageInput
) => Promise<void>;
```

约束：

- `regenerate` 只能对 assistant 消息调用。
- 它会先解析出 assistant 的父 user，再复用 `regenerateUserMessage(...)`。
- 因此 user 消息下方和 assistant 消息下方的重新生成入口，效果完全一致。

### 2.6 editUserMessage

```ts
type editUserMessage = (
  userMessageUuid: string,
  input: {
    model: string;
    prompt: string;
  }
) => Promise<void>;
```

约束：

- `editUserMessage` 只能对 user 消息调用。
- 它不会原地覆盖旧消息，而是在该 user 消息的 `parent_message_uuid` 下创建一个新的 user sibling。
- 新 user sibling 使用“当前输入区选择的模型”，不会沿用旧 user message 的 `model`。
- 随后继续走普通 `sendMessage` 的 `submit` 流程。
- 所以“编辑”在产品语义上等价于“基于这条历史 user 消息 fork 一个新版本”。
- 原 user 分支仍然保留，可通过分支切换回看。

### 2.7 getBranchState / selectBranch

```ts
type getBranchState = (parentMessageUuid: string) => string[];
type selectBranch = (messageUuid: string) => void;
```

约束：

- `getBranchState(parentMessageUuid)` 返回某个父节点下的全部 `child_uuids`。
- 这个 parent 可以是：
  - 某条 user 的 `uuid`，用来查看它下面的 assistant siblings
  - 某条 user 的父节点 `uuid`，用来查看这条 user 所在层的 user siblings
- `selectBranch(messageUuid)` 传入目标 sibling 的 uuid。
- `selectBranch` 会把该消息设为其父节点当前激活分支。
- 切换分支后，会从该消息开始继续向下寻找当前叶子节点，重新派生 `messages`。
- 当前正在 `submitted` 或 `streaming` 时不允许切分支，直接抛错。

### 2.8 stop

```ts
type stop = () => void;
```

约束：

- `stop()` 中断当前流式请求。
- 已收到的 assistant 文本必须保留。
- 当前 assistant 消息的 `stop_reason` 置为 `user_canceled`。
- 中断完成后 `status` 回到 `ready`。

### 2.9 status

```ts
type ChatStatus = "ready" | "submitted" | "streaming" | "error";
```

状态含义：

- `submitted`：请求已发出，但还没收到首个流事件。
- `streaming`：正在接收流式 chunk。
- `ready`：本轮已完成，可以继续发送。
- `error`：请求失败或流消费失败。

补充说明：

- 当前版本不在 hook 返回值中暴露 `error` 对象。
- 如果流式请求中途失败，保留已收到的 assistant 文本，并将 `status` 置为 `error`。

## 3. 请求协议

前端当前请求本项目内接口：

```http
POST /api/chat_conversations/{conversationId}/completion
```

- `{conversationId}` 当前可以先用任意固定值占位。

请求体：

```ts
type ChatCompletionRequest =
  | {
      prompt: 'hi'
      parent_message_uuid: '019ccd92-d437-70fc-a9fc-5a893f12fa70'
      model: 'claude-sonnet-4-6'
      trigger: 'submit'
      turn_message_uuids: {
        user_message_uuid: '019cd069-55c3-7190-a212-cac6a56e74ab'
        assistant_message_uuid: '019cd069-55c3-7904-aac3-569c7605069b'
      }
      files: []
    }
  | {
      prompt: ''
      parent_message_uuid: '019cd069-55c3-7190-a212-cac6a56e74ab'
      model: 'claude-sonnet-4-6'
      trigger: 'regenerate'
      turn_message_uuids: {
        assistant_message_uuid: '019cd069-55c3-7904-aac3-569c7605069b'
      }
      files: []
    }
```

组装规则：

- `prompt` 来自 `sendMessage(...).prompt`。
- `sendMessage` 时，`parent_message_uuid` 默认取当前分支最后一条消息的 `uuid`。
- `sendMessage` 也可显式指定 `parentMessageUuid`，用于在某个旧父节点下提交新的 user sibling。
- `editUserMessage` 内部就是利用这一点，把新的 user 版本挂到被编辑 user 的父节点下。
- `regenerate` / `regenerateUserMessage` 时，`parent_message_uuid` 取目标 user message 的 `uuid`。
- 如果当前没有任何消息，则使用固定根节点 `"00000000-0000-4000-8000-000000000000"`。
- `model` 来自首页输入区当前选择的模型；重新生成时直接复用目标 message 自身记录的 `model`。
- `trigger` 只支持 `"submit"` 和 `"regenerate"`。
- `turn_message_uuids.user_message_uuid` 和 `turn_message_uuids.assistant_message_uuid` 由 hook 在发送前自动生成。
- `regenerate` 时不会生成新的 user message uuid，请求体里也不会再传这个字段。
- message uuid 使用 `uuid` 库的 UUID v7。
- `files` 默认空数组，且只传文件 id。
- 当前 mock 服务端会回显请求体中的 `assistant_message_uuid`，但前端流消费仍以 `message_start.message.uuid` 为准。
- 当前 mock 在 `trigger: "regenerate"` 且 `prompt === ""` 时，会输出一个带 `parent_message_uuid` 的兜底文案，方便观察行为。
- 当前 mock 会主动插入可见延迟，方便在首页观察 `tool_use` 标题流光、标题切换和展开内容变化。

## 4. files

当前项目里，消息和 completion 请求只保留 `files`。

当前约束：

- `files`：文件 id 数组，表示“这次请求要读哪些文件”。
- 未来如果接入上传，上传成功后应立刻调用接口拿到上传对象，单独用于本地预览和拼接用户消息展示。
- completion 接口中的 `files` 仍然只传 id，不传完整文件对象。

当前阶段：

- 不做文件上传。
- 当前 UI、hook、mock SSE 只透传 `files`。

## 5. SSE 协议

当前 mock 先覆盖已确认的事件集：

- `message_start`
- `content_block_start`
- `content_block_delta`
- `content_block_stop`
- `message_delta`
- `message_limit`
- `message_stop`

当前 mock 暂不实现：

- 其他尚未确认或当前 hook 不依赖的扩展事件。

当前已支持的 `content_block` 类型：

- `text`
- `tool_use`
- `tool_result`

其中：

- SSE 原始协议里 `tool_use` 和 `tool_result` 仍然是两个独立 block。
- 前端解析后会把 `tool_result` 挂到对应 `tool_use.tool_result` 上。
- `text` block 支持 `citations` 字段，并支持在流式阶段通过 `citation_start_delta` / `citation_end_delta` 标记区间。
- 协议里工具块统一使用 `display_content`，不再使用 `content`。
- `tool_use` 期间可通过 `tool_use_block_update_delta` 覆盖当前标题和展开内容。
- `tool_result` 出现后，UI 标题严格使用 `tool_result.message ?? firstInputValue`，不再回退到 `tool_use.message`。

示例：

```txt
event: message_start
data: {"type":"message_start","message":{"id":"chatcompl_017LfCWBpwHhqdB7cmR2iwqp","type":"message","role":"assistant","model":"claude-sonnet-4-6","parent_uuid":"019cd069-55c3-7190-a212-cac6a56e74ab","uuid":"019cd069-55c3-7904-aac3-569c7605069b","content":[],"stop_reason":null,"stop_sequence":null,"trace_id":"fb6c7644d9319a2435e99f2c3a8f867b","request_id":"req_011CYriJ8e9RxjUvKjTsQpck"}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"start_timestamp":"2026-03-11T11:49:38.941722Z","stop_timestamp":null,"flags":null,"type":"tool_use","id":"toolu_01WJUzuUvtXAnr5qH5F6C7xC","name":"web_search","input":{},"message":"Searching the web","icon_name":"globe","display_content":null}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"OpenAI Codex pricing 2026\"}"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"tool_use_block_update_delta","message":"Fetching: https://developers.openai.com/codex/pricing/","display_content":{"preview_url":"https://developers.openai.com/codex/pricing/"}}}

event: content_block_stop
data: {"type":"content_block_stop","index":0,"stop_timestamp":"2026-03-11T11:49:39.048579Z"}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"start_timestamp":"2026-03-11T11:49:39.093133Z","stop_timestamp":null,"flags":null,"type":"tool_result","tool_use_id":"toolu_01WJUzuUvtXAnr5qH5F6C7xC","name":"web_search","message":"Found 3 sources","icon_name":"globe","display_content":null,"is_error":false}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"[{\"type\":\"knowledge\",\"title\":\"Codex Pricing\",\"url\":\"https://developers.openai.com/codex/pricing/\",\"metadata\":{\"type\":\"webpage_metadata\",\"site_domain\":\"openai.com\",\"favicon_url\":\"https://www.google.com/s2/favicons?sz=64&domain=openai.com\",\"site_name\":\"OpenAI\"},\"is_missing\":false}]" }}

event: content_block_stop
data: {"type":"content_block_stop","index":1,"stop_timestamp":"2026-03-11T11:49:39.193133Z"}

event: content_block_start
data: {"type":"content_block_start","index":2,"content_block":{"start_timestamp":"2026-03-11T11:49:39.293133Z","stop_timestamp":null,"flags":null,"type":"text","text":"","citations":[]}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"Mock response to: **OpenAI Codex pricing 2026**\n\n"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"citation_start_delta","citation":{"uuid":"citation-apidog-pricing","title":"How Affordable Is GPT-5 Codex Pricing for Developers in 2026","url":"https://apidog.com/blog/codex-pricing/","metadata":{"type":"webpage_metadata","site_domain":"apidog.com","favicon_url":"https://www.google.com/s2/favicons?sz=64&domain=apidog.com","site_name":"Apidog"},"origin_tool_name":"web_search","sources":[{"uuid":"citation-source-apidog-pricing","title":"How Affordable Is GPT-5 Codex Pricing for Developers in 2026","url":"https://apidog.com/blog/codex-pricing/","icon_url":"https://www.google.com/s2/favicons?sz=64&domain=apidog.com","source":"Apidog"}]}}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"每五小时 30–150 个本地任务（含周限额），支持 CLI 和 IDE 集成"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"citation_end_delta","citation_uuid":"citation-apidog-pricing"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"。\n\n- `web_search` returned 3 knowledge items\n- Citation pills should appear inline after the cited span\n- Markdown formatting should remain intact while the text streams in"}}

event: content_block_stop
data: {"type":"content_block_stop","index":2,"stop_timestamp":"2026-03-11T11:49:39.338292Z"}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null}}

event: message_limit
data: {"type":"message_limit","message_limit":{"type":"within_limit","resetsAt":null,"remaining":null,"perModelLimit":null,"representativeClaim":"five_hour","overageDisabledReason":"overage_not_provisioned","overageInUse":false,"windows":{"5h":{"status":"within_limit","resets_at":1773039600,"utilization":0.01}}}}

event: message_stop
data: {"type":"message_stop"}
```

事件到本地状态的映射：

- `message_start`：创建 assistant 消息壳，uuid 使用服务端返回的 assistant uuid。
- `message_start` 中的 `message.model` 会直接写入 assistant 消息的顶层 `model` 字段。
- `message_start` 同时作为后续 `content_block_*`、`message_delta`、`message_limit` 的关联起点；这些事件本身不携带消息 uuid，所以流消费层会先缓存 `message_start.message.uuid`。
- `content_block_start(type = "text")`：初始化对应 `content[index]` 文本块。
- `content_block_delta(type = "text_delta")`：追加文本到对应 `content[index].text`。
- `content_block_delta(type = "citation_start_delta")`：记录“当前 text block 已接收长度”作为 citation 的 `start_index`，并缓存 citation 元数据。
- `content_block_delta(type = "citation_end_delta")`：用“当前 text block 已接收长度”作为 `end_index`，生成完整 citation 并追加到 `content[index].citations`。
- `content_block_start(type = "tool_use")`：创建工具调用块。
- `content_block_delta(type = "input_json_delta")` 且当前块是 `tool_use`：持续解析并更新 `tool_use.input`。
- `content_block_delta(type = "tool_use_block_update_delta")`：覆盖 `tool_use.message` 和 `tool_use.display_content`。
- `content_block_start(type = "tool_result")`：通过 `tool_use_id` 挂到对应 `tool_use.tool_result`。
- `content_block_delta(type = "input_json_delta")` 且当前块是 `tool_result`：持续解析并更新 `tool_result.display_content`。
- `content_block_delta(type = "tool_result_block_update_delta")`：覆盖 `tool_result.message`、`tool_result.display_content` 和可选错误态。
- `content_block_stop(type = "tool_result")`：同时写入 `tool_result.stop_timestamp` 和外层 `tool_use.stop_timestamp`，把它视作整次工具调用完成时间。
- 其他 `content_block_stop`：写入该 block 的 `stop_timestamp`。
- `message_delta`：合并 `stop_reason` 等消息级字段。
- `message_limit`：合并到当前 assistant 消息的 `metadata.message_limit`。
- `message_stop`：结束本轮流式生成，`status` 进入 `ready`。

### 5.1 如何理解 citation

- `citation` 是挂在 `text block` 上的文本区间注解，不是正文字符串的一部分。
- 区间基于原始 Markdown 源串，而不是基于最终渲染后的纯文本。
- 流式场景下不能通过 `source: "目标文本"` 方式定位，因为：
  - 目标文本可能尚未完整到达
  - 同样的文本内容可能在正文中重复出现
  - Markdown 语法和空白符会让基于文本匹配的定位变得脆弱
- 因此协议用 `citation_start_delta` / `citation_end_delta` 表达“区间开始 / 区间结束”，前端在消费流时基于当前 block 已接收文本长度计算出 `[start_index, end_index)`。
- 当前实现里索引单位使用 JavaScript `string` 的 UTF-16 offset。

### 5.2 为什么使用半开区间

- citation 统一使用 `[start_index, end_index)`，即含头不含尾。
- 这样可以直接使用 `text.slice(start_index, end_index)` 获取被标注的源串片段。
- 区间长度恒等于 `end_index - start_index`。
- 相邻 citation 可以自然写成 `[10, 20)` 和 `[20, 30)`，没有重叠和歧义。
- 对流式实现最直接：`citation_start_delta` 记录当前长度为 `start_index`，`citation_end_delta` 记录当前长度为 `end_index`，不需要额外修正。

## 6. 如何处理 EventSource 响应

方案

```
Fetch API + ReadableStream + eventsource-parser
```

消费链路

```txt
response.body.getReader() -> TextDecoder -> eventsource-parser -> ParsedSseEvent
```

```
字节数组 -> 文本字符串 -> 完整 SSE 对象
```

设计约束：

- 不使用原生 `EventSource API`，因为只支持 GET（不能传 body 就不能传 prompt 和模型信息等内容）
- 使用 `fetch + ReadableStream + AbortController` 实现流式消费和停止生成。
- SSE 文本事件解析使用 `eventsource-parser`，不再维护自定义底层解析逻辑。

为什么不用 `response.text()`：

- `response.text()` 会等整个响应结束后才返回。
- 这样拿不到中间 chunk，无法驱动流式 UI。

`getReader()` 和 `TextDecoder` 的职责：

- `reader.read()` 负责从流里逐步读取字节数组。
- `decoder.decode(value, { stream: true })` 负责把字节块安全地增量解码成字符串。
- 解析后的字符串再交给 `eventsource-parser`。

### decode 解码成文本字符串之后为什么还要 parser ？给出案例

答：因为 `decode` 只解决了“字节 -> 文本”，没有解决“文本 -> SSE 事件”。

`TextDecoder` 做完之后，你拿到的只是普通字符串块，可能长这样：

```txt
event: message_start
data: {"type":"message_start","message":{"uuid":"a"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"text":"Hel"}}
```

但 SSE 真正需要的是“按协议切成一条条事件”。

一个最直观的例子是：网络分块不等于事件分块。

服务端原本发的是一条完整事件：

```txt
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"text":"Hello"}}

```

但网络层可能把它拆成两次到达：

第一次 `reader.read()`：

```txt
event: content_block_delta
data: {"type":"content_block_d
```

第二次 `reader.read()`：

```txt
elta","index":0,"delta":{"text":"Hello"}}

```

这时候：

- `TextDecoder` 能把两段字节都正确变成字符串
- 但它不知道哪里是一条完整 SSE 事件
- 更不知道要等到空行 `\n\n` 才能算“事件结束”

parser 就是干这个的。它会：

1. 缓存不完整的半截文本
2. 识别 `event:`、`data:` 这些字段
3. 直到遇到空行，才产出一条完整事件对象

最终才会变成我们能消费的结构，例如：

```ts
{
  event: "content_block_delta",
  data: "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"text\":\"Hello\"}}"
}
```

再举一个更简单的类比：

- `TextDecoder` 像是把录音转成文字
- SSE parser 像是按标点和格式把文字切成一句一句可执行的指令

如果没有 parser，你就得自己手写处理这些协议细节：

- 事件可能跨 chunk
- 一个 chunk 里可能有多条事件
- `data:` 可能有多行
- 默认事件名是 `message`
- 要靠空行判断事件结束

所以不是“decode 之后多此一举再 parse”，而是两层职责完全不同：

- `decode`: 字节层
- `parser`: 协议层

```txt
字节数组 -> 字符串 -> 完整事件对象
```

## 7. 内部实现约束

- hook 内部不再直接维护线性 `messages[]` 作为主状态。
- 真实状态使用消息树结构：

```ts
type ConversationNode = {
  uuid: string;
  parent_uuid: string | null;
  child_uuids: string[];
  message: Message | null;
};
```

- reducer 主状态至少包含：

```ts
{
  mapping: Record<string, ConversationNode>,
  current_leaf_message_uuid: string | null,
  active_child_uuid_by_parent_uuid: Record<string, string>,
  next_message_index: number,
  input: string,
  status: ChatStatus,
}
```

- `mapping` 保存所有消息节点。
- `current_leaf_message_uuid` 表示当前激活分支的最后一个消息 uuid。
- `active_child_uuid_by_parent_uuid[parent_uuid]` 表示该父节点当前激活的 child。
- 如果某个父节点没有显式 active child，则默认取 `child_uuids[0]`。
- `messages` 通过 `current_leaf_message_uuid -> parent_uuid` 回溯生成。
- 当前版本不接入 TanStack Query。
- 内部状态管理使用 reducer。
- 当前 reducer 使用 `immer` 简化嵌套对象更新。
- `useChat` 只保留 hook 编排逻辑。
- reducer、消息构造、SSE 流消费应拆到独立模块，避免单文件膨胀。
- 当前代码里 UUID 生成使用 `uuid` 库的 `v7()`。

## 8. Mock 响应策略

- 当前 mock 接口会返回确定性、较长的多段文本。
- 响应会回显用户输入的 `prompt`。
- 如果是 `regenerate` 且 `prompt` 为空，会回显 `parent_message_uuid`，便于验证“从既有 user 消息重试”的语义。
- 这样可以更清楚地观察：
  - 流式分块
  - 自动滚动
  - 中途停止
  - assistant metadata 更新

## 9. 首页演示 UI

首页只作为 `useChat` 的极简演示壳，不承担协议逻辑。

约束：

- 页面结构固定为单栏聊天布局。
- 上方是对话流，下方是输入框。
- 视觉风格保持工具型和低干扰。
- 不使用大圆角、说明性大段文案、装饰性渐变或大面积留白。
- 对话区显示当前激活分支的 `messages`。
- 对话区必须在页面内部独立滚动，不能退化成整页滚动。
- 输入区与对话区必须分开占位，不能覆盖底部消息内容。
- 新 chunk 到达时自动滚动到底部。
- assistant 正在生成时，最后一条 assistant 气泡要有明确的流式反馈。
- 输入区包含发送和停止两个动作。
- 输入区底部包含一个 shadcn `Select` 模型切换器。
- `sendMessage` 抛错时，前端先以轻量错误提示呈现。
- user 消息下方包含：
  - 编辑入口
  - 重新生成入口
  - user sibling 分支切换控件，例如 `< 2/2 >`
- assistant 消息下方包含：
  - 重新生成入口
  - assistant sibling 分支切换控件，例如 `< 2/2 >`
- user 进入编辑态后，原消息会切成一个铺满消息宽度的 `textarea`，下方显示取消和确认。
- 编辑确认后不会覆盖旧消息，而是创建一个新的 user 分支并继续生成 assistant。

## 10. 关键实现流程

发送流程：

1. 调用 `sendMessage({ prompt, files, model })`。
2. 立即插入本地 user message，并把它挂到当前 `current_leaf_message_uuid` 下，同时把所选模型写入 `message.model`。
3. 生成本轮 `user_message_uuid` 和 `assistant_message_uuid`。
4. 组装 `trigger: "submit"` 的请求体并发起 `POST /api/chat_conversations/{conversationId}/completion`。
5. `status` 进入 `submitted`。
6. 收到 `message_start` 后，以 `message_start.message.uuid` 作为本轮 assistant 消息的真实 uuid，并创建 assistant 消息壳，同时把服务端返回的 `message.model` 写入 assistant message。
7. 收到 `content_block_delta` 后持续追加 assistant 文本；后续流事件都依赖上一步缓存的 assistant uuid。
8. 收到 `message_limit` 后把数据合并到 assistant `metadata`。
9. 收到 `message_stop` 后 `status` 回到 `ready`。

重新生成流程：

1. 调用 `regenerateUserMessage(userMessageUuid)`，或调用 `regenerate(assistantMessageUuid)`。
2. 找到目标 message，并直接读取它自己记录的 `model`。
3. 如果目标是 assistant，则先回到它的父 user，再继续发 regenerate 请求。
4. 复用目标 user 消息的 `files`，并把上一步拿到的 `model` 放进请求体。
5. 组装 `trigger: "regenerate"` 的请求体，`parent_message_uuid` 取目标 user 的 `uuid`。
6. 不创建新的 user 消息。
7. 收到 `message_start` 后，把新 assistant 追加到该 user 节点的 `child_uuids` 中。
8. 同时更新该父节点的 `active_child_uuid_by_parent_uuid`，并把 `current_leaf_message_uuid` 切到新分支。

编辑用户消息流程：

1. 用户点击某条 user 消息下方的编辑按钮。
2. UI 进入编辑态，展示可修改文本的 `textarea`。
3. 用户确认后调用 `editUserMessage(userMessageUuid, { prompt, model })`，其中 `model` 来自当前输入区选择。
4. hook 找到原 user 消息，并读取它的 `parent_message_uuid`、`files`。
5. 内部转调 `sendMessage({ prompt, files, parentMessageUuid, model })`。
6. 创建新的 user sibling，并立即把它设为该父节点的当前激活分支。
7. 后续 assistant 继续按普通 `submit` 流程生成。

分支切换流程：

1. UI 通过 `getBranchState(parentMessageUuid)` 拿到某个父节点下的全部 `child_uuids`。
2. user 消息下方展示的是该 user 所在层的 user siblings。
3. assistant 消息下方展示的是该 user 下的 assistant siblings。
4. 用户点击 `<` 或 `>` 后，UI 选择目标 sibling uuid 并调用 `selectBranch(targetMessageUuid)`。
5. reducer 更新对应父节点的 `active_child_uuid_by_parent_uuid`。
6. 从这个被选中的消息开始继续向下解析当前激活子链。
7. 得到新的 `current_leaf_message_uuid`，并重新派生当前 `messages`。

停止流程：

1. 调用 `stop()`。
2. `AbortController.abort()` 中断当前请求。
3. 保留已生成的 assistant 文本。
4. 将 assistant 消息的 `stop_reason` 置为 `user_canceled`。
5. `status` 回到 `ready`。

## remark / remark-glm / react-markdown

1. remark（核心解析器）：将 Markdown 文本解析成抽象语法树（AST），开发者可以通过编写或使用各种插件，对这棵树进行增删改查，最后再把它转回 Markdown 文本或者转换成 HTML。
2. remark-gfm（语法扩展插件）：它是 remark 的一个官方插件，标准的 Markdown 规范（CommonMark）其实是非常基础的，它不支持表格（Tables）、删除线（Strikethrough ~~文字~~）、任务列表（Task lists - [x]）和网址自动链接等高级语法。remark-gfm 的作用就是给 remark 引擎加上这些扩展能力，让解析器能够认识并正确处理这些常用的 GitHub 扩展语法。
3. react-markdown：底层正是依赖了 remark 引擎。它接收一段 Markdown 字符串，解析它，并将它直接渲染成 React 组件（React Elements）。

### citation 如何插入到 Markdown 渲染中

- `text` block 始终保存原始 Markdown 源串，citation 不会写回正文字符串。
- 渲染时通过自定义 `remark` 插件，基于 citation 的索引区间把附加节点插入 Markdown AST。
- 当前 UI 选择在 citation 区间末尾插入一个 inline citation pill，因此 citation 属于渲染层增强，而不是正文内容本身。
- 这样做的收益：
  - 不污染 Markdown 语义
  - 复制正文时 citation 不会参与
  - 可以保持段落、列表、表格等 Markdown 结构继续由 `react-markdown` 正常渲染
  - citation 的 hover card / click 行为可以由独立 React 组件处理

约束：

- citation 当前只作用于单个 `text block`。
- citation 边界应尽量避免切进 Markdown 语法标记内部。
- 为了保证 Markdown 结构稳定，流式分块必须保留换行符；不能在 chunk 阶段丢失 `\n`，否则列表和段落会退化成普通文本。
