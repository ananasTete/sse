# useChat 设计规范

本文档是当前项目中 `useChat`、mock SSE 接口和首页演示 UI 的最新设计参考。

## 1. 范围

- 当前实现单会话聊天，并支持 assistant 重新生成与分支切换。
- `messages` 对外仍然是数组，但内部真实状态已经不是线性数组，而是消息树。
- 当前项目是 TanStack Start。
- 当前不直连外部 `claude.ai`，而是在项目内提供 mock SSE 接口。
- hook 参数暂不开放，请求 API、模型、conversation id 先在 hook 内部写死。

## 2. useChat 对外 API

返回值：

```ts
{
  getBranchState,
  messages,
  input,
  onInputChange,
  regenerate,
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
  created_at: string;
  updated_at: string;
  stop_reason: "end_turn" | "stop_sequence" | "user_canceled" | null;
  attachments: unknown[];
  files: unknown[];
  metadata: {
    message_limit?: MessageLimit;
  };
  parent_message_uuid: string;
}

interface ContentType {
  start_timestamp: string;
  stop_timestamp: string | null;
  type: "text";
  text: string;
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
- assistant 消息在流式生成期间允许 `stop_reason = null`。
- `message_limit` 落到 assistant 消息的 `metadata.message_limit` 中。

### 2.2 input / onInputChange

- 用于受控表单。
- 提交成功后自动清空。

### 2.3 sendMessage

```ts
type sendMessage = (message: SendMessageInput) => Promise<void>;

interface SendMessageInput {
  prompt: string;
  attachments?: unknown[];
  files?: unknown[];
}
```

约束：

- `sendMessage` 使用对象入参，便于后续扩展。
- `prompt` 会先做 `trim()`。
- `prompt` 为空时直接抛错。
- 当 `status` 为 `submitted` 或 `streaming` 时再次调用 `sendMessage`，直接抛错。
- 当前版本不做排队，也不做“自动中断上一条再发送下一条”。
- `sendMessage` 成功返回表示本轮流已经完整消费到 `message_stop`。

### 2.4 regenerate

```ts
type regenerate = (assistantMessageUuid: string) => Promise<void>;
```

约束：

- `regenerate` 只能对 assistant 消息调用。
- `regenerate` 会复用目标 assistant 的父 user 消息。
- 重新生成时不会创建新的 user 消息。
- 新 assistant 消息的 `parent_message_uuid` 与旧 assistant 保持一致。
- 请求体中的 `trigger` 为 `"regenerate"`。
- 当 `status` 为 `submitted` 或 `streaming` 时调用 `regenerate`，直接抛错。

### 2.5 getBranchState / selectBranch

```ts
type getBranchState = (assistantMessageUuid: string) => string[];
type selectBranch = (assistantMessageUuid: string) => void;
```

约束：

- `getBranchState(assistantMessageUuid)` 返回该 assistant 所在父节点下的全部 `child_uuids`。
- `selectBranch(assistantMessageUuid)` 传入目标 assistant 分支的 uuid。
- `selectBranch` 会把该 assistant 设为其父节点当前激活分支。
- 切换分支后，会从该 assistant 开始继续向下寻找当前叶子节点，重新派生 `messages`。
- 当前正在 `submitted` 或 `streaming` 时不允许切分支，直接抛错。

### 2.6 stop

```ts
type stop = () => void;
```

约束：

- `stop()` 中断当前流式请求。
- 已收到的 assistant 文本必须保留。
- 当前 assistant 消息的 `stop_reason` 置为 `user_canceled`。
- 中断完成后 `status` 回到 `ready`。

### 2.7 status

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
{
  prompt: 'hi',
  parent_message_uuid: '019ccd92-d437-70fc-a9fc-5a893f12fa70',
  model: 'claude-sonnet-4-6',
  trigger: 'submit',
  turn_message_uuids: {
    user_message_uuid: '019cd069-55c3-7190-a212-cac6a56e74ab',
    assistant_message_uuid: '019cd069-55c3-7904-aac3-569c7605069b'
  },
  attachments: [],
  files: [],
}
```

组装规则：

- `prompt` 来自 `sendMessage(...).prompt`。
- `sendMessage` 时，`parent_message_uuid` 取当前分支最后一条消息的 `uuid`。
- `regenerate` 时，`parent_message_uuid` 取目标 assistant 的 `parent_message_uuid`。
- 如果当前没有任何消息，则使用固定根节点 `"00000000-0000-4000-8000-000000000000"`。
- `model` 当前固定为 `claude-sonnet-4-6`。
- `trigger` 只支持 `"submit"` 和 `"regenerate"`。
- `turn_message_uuids.user_message_uuid` 和 `turn_message_uuids.assistant_message_uuid` 由 hook 在发送前自动生成。
- `regenerate` 时不会生成新的 user message uuid，而是直接复用父 user 消息的 uuid。
- message uuid 使用 `uuid` 库的 UUID v7。
- `attachments` 和 `files` 默认空数组。
- 当前 mock 服务端会回显请求体中的 `assistant_message_uuid`，但前端流消费仍以 `message_start.message.uuid` 为准。

## 4. files 和 attachments

当前项目里，两者都只是透传字段，还没有真正分化行为。

建议语义：

- `attachments`：消息级附带内容，偏“这条消息带了什么”。
- `files`：提供给模型读取或处理的文件实体，偏“这次请求要读哪些文件”。

当前阶段：

- 二者都作为协议预留字段。
- 当前 UI、hook、mock SSE 不对它们做不同处理。

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

示例：

```txt
event: message_start
data: {"type":"message_start","message":{"id":"chatcompl_017LfCWBpwHhqdB7cmR2iwqp","type":"message","role":"assistant","model":"","parent_uuid":"019cd069-55c3-7190-a212-cac6a56e74ab","uuid":"019cd069-55c3-7904-aac3-569c7605069b","content":[],"stop_reason":null,"stop_sequence":null,"trace_id":"fb6c7644d9319a2435e99f2c3a8f867b","request_id":"req_011CYriJ8e9RxjUvKjTsQpck"}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"start_timestamp":"2026-03-09T02:24:51.814385Z","stop_timestamp":null,"flags":null,"type":"text","text":"","citations":[]}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" Hi"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"! How can I help you today"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"?"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0,"stop_timestamp":"2026-03-09T02:24:51.938292Z"}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null}}

event: message_limit
data: {"type":"message_limit","message_limit":{"type":"within_limit","resetsAt":null,"remaining":null,"perModelLimit":null,"representativeClaim":"five_hour","overageDisabledReason":"overage_not_provisioned","overageInUse":false,"windows":{"5h":{"status":"within_limit","resets_at":1773039600,"utilization":0.01}}}}

event: message_stop
data: {"type":"message_stop"}
```

事件到本地状态的映射：

- `message_start`：创建 assistant 消息壳，uuid 使用服务端返回的 assistant uuid。
- `message_start` 同时作为后续 `content_block_*`、`message_delta`、`message_limit` 的关联起点；这些事件本身不携带消息 uuid，所以流消费层会先缓存 `message_start.message.uuid`。
- `content_block_start`：初始化对应 `content[index]`。
- `content_block_delta`：追加文本到对应 `content[index].text`。
- `content_block_stop`：写入该 block 的 `stop_timestamp`。
- `message_delta`：合并 `stop_reason` 等消息级字段。
- `message_limit`：合并到当前 assistant 消息的 `metadata.message_limit`。
- `message_stop`：结束本轮流式生成，`status` 进入 `ready`。

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
- `sendMessage` 抛错时，前端先以轻量错误提示呈现。
- assistant 消息下方包含重新生成入口。
- assistant 消息下方包含分支切换控件，例如 `< 2/2 >`。

## 10. 关键实现流程

发送流程：

1. 调用 `sendMessage({ prompt, attachments, files })`。
2. 立即插入本地 user message，并把它挂到当前 `current_leaf_message_uuid` 下。
3. 生成本轮 `user_message_uuid` 和 `assistant_message_uuid`。
4. 组装 `trigger: "submit"` 的请求体并发起 `POST /api/chat_conversations/{conversationId}/completion`。
5. `status` 进入 `submitted`。
6. 收到 `message_start` 后，以 `message_start.message.uuid` 作为本轮 assistant 消息的真实 uuid，并创建 assistant 消息壳。
7. 收到 `content_block_delta` 后持续追加 assistant 文本；后续流事件都依赖上一步缓存的 assistant uuid。
8. 收到 `message_limit` 后把数据合并到 assistant `metadata`。
9. 收到 `message_stop` 后 `status` 回到 `ready`。

重新生成流程：

1. 调用 `regenerate(assistantMessageUuid)`。
2. 找到目标 assistant 的父 user 消息。
3. 复用该 user 消息的 `attachments`、`files` 和文本内容。
4. 组装 `trigger: "regenerate"` 的请求体，`parent_message_uuid` 与旧 assistant 保持一致。
5. 不创建新的 user 消息。
6. 收到 `message_start` 后，把新 assistant 追加到同一父节点的 `child_uuids` 中。
7. 同时更新该父节点的 `active_child_uuid_by_parent_uuid`，并把 `current_leaf_message_uuid` 切到新分支。

分支切换流程：

1. UI 通过 `getBranchState(assistantMessageUuid)` 拿到当前 assistant 所在父节点的全部 `child_uuids`。
2. 用户点击 `<` 或 `>` 后，UI 选择目标 assistant uuid 并调用 `selectBranch(targetAssistantUuid)`。
3. reducer 更新对应父节点的 `active_child_uuid_by_parent_uuid`。
4. 从这个 assistant 开始继续向下解析当前激活子链。
5. 得到新的 `current_leaf_message_uuid`，并重新派生当前 `messages`。

停止流程：

1. 调用 `stop()`。
2. `AbortController.abort()` 中断当前请求。
3. 保留已生成的 assistant 文本。
4. 将 assistant 消息的 `stop_reason` 置为 `user_canceled`。
5. `status` 回到 `ready`。
