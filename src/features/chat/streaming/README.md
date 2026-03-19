## 核心流程

streaming 目录现在主要在做三件事：

1. 把后端返回的字节流解析成完整的 SSE 事件
   这里通过 ReadableStream 的 reader.read()、TextDecoder，再配合 EventSourceParser，把碎片字节拼成一条条完整 SSE 消息。

2. 把 SSE 协议事件翻译成 domain action。
   例如 message_start、content_block_start、content_block_delta，会被转换成 message-appended、content-block-started、text-block-delta-received 这类 dispatchDomain action，来更新数据。

3. 维护"仅流处理中需要"的临时状态。
   activeContentBlocks 它负责处理：

text 的增量长度和 citation 起止位置
tool_use 的 partial_json 缓冲
tool_result 按 tool_use_id 挂回父 block

## SSE 事件及数据

当前 `completion-stream.ts` 一共处理 9 种事件：

它能带来什么数据，以及为什么？

## activeContentBlocks 计算 citations

## SSE 协议规则

- 在 start 事件中，完整对象。
- 在 delta 事件中，增量更新的数据，一定是增量更新的吗？
- 在 stop 事件中，结束时需要的信息，如 stop_timestamp

### 具体协议

message 包含 start、stop 两个事件

```
data: {"message":{"content":[],"created_at":"2026-03-19T09:10:36.622Z","id":"chatcompl_019d055c6d4775a99edc470e646aadd8","model":"claude-sonnet-4-6","parent_uuid":"019d055c-6d47-75a9-9edc-4084cfdf26eb","role":"assistant","stop_reason":null,"stop_sequence":null,"type":"message","updated_at":"2026-03-19T09:10:36.622Z","uuid":"019d055c-6d47-75a9-9edc-470e646aadd8"},"type":"message_start"}

data: {"message":{"stop_reason":"end_turn","stop_sequence":null},"type":"message_stop"}
```

content_block 包含 start、delta、stop 三个事件

```
data: {"type":"content_block_start", "index":2, "content_block":{"citations":[],"start_timestamp":"2026-03-19T08:52:39.775Z","stop_timestamp":null,"text":"","type":"text"},}

data: {"delta":{"text":"hi","type":"text_delta"},"index":2,"type":"content_block_delta"}

data: {"content_block":{"stop_timestamp":"2026-03-19T09:09:02.407Z"},"index":2,"type":"content_block_stop"}
```

统一原则：start 事件携带初始化数据，stop 事件携带结束数据。
delta 仅用于内容增量，不承载元数据。message 和 content_block 遵循相同的 bracket 协议。

## 为什么 `data.type` 承担类型判别，SSE `event` 统一使用 `message`？

### 背景

SSE 协议中，每条消息有两层结构：

```
event: <事件名>        ← 传输层（SSE 原生字段）
data: {"type": "..."}  ← 应用层（JSON payload）
```

在最初的设计中，`event` 和 `data.type` 重复携带了相同的类型信息。
经过权衡，我们决定 **只在 `data.type` 中维护类型信息**，SSE `event` 统一使用默认值 `message`（即不发送 `event:` 行）。

### 为什么保留 `data.type`？

`data.type` 是 JSON payload 中的类型字段，服务于应用层逻辑：

1. **TypeScript 类型收窄（Discriminated Union）**
   — `switch (parsed.type)` 可以让 TS 编译器自动推断 payload 的精确类型，获得完整的类型安全。SSE 的 `event` 字段在代码中是 `string`，做不到这一点。

2. **传输无关性**
   — 如果未来从 SSE 切换到 WebSocket 或其他协议，JSON payload 仍然是自描述的，不依赖传输层提供类型信息。

3. **存储与回放**
   — 当持久化事件或做重放时，存储的是 JSON data，不会保留 SSE 的 `event:` 行。如果没有 `data.type`，事件类型信息会丢失。

4. **统一处理**
   — 批量处理事件（如数组遍历、日志输出）时，每条数据自带 `type` 字段，不需要额外传递或关联外部信息。

### 为什么 `event` 可以统一使用 `message`？

既然 `data.type` 已经承担了全部的类型判别职责，SSE `event` 字段的分发能力就变得冗余了：

1. **实际不使用 EventSource API 的原生分发**
   — 现代前端都用 `fetch` + `ReadableStream` 手动解析 SSE（因为 `EventSource` 不支持 POST、不支持自定义 headers），所以 SSE `event` 字段的原生事件路由（`addEventListener('content_block_start', ...)`）从未被使用。

2. **消除冗余，降低不一致风险**
   — 类型信息只在 `data.type` 一处维护，不会出现 `event` 和 `data.type` 不一致的情况。

3. **减少传输字节**
   — 不发送 `event:` 行，每条 SSE 消息少输出约 20–30 字节。

### 当前的数据流架构

```
服务端:
  data: {"type": "content_block_start", ...}\n\n    ← 不发送 event: 行

前端 SSE parser:
  event 默认为 "message"，忽略
  data 解析为 JSON

completion-stream.ts:
  const parsed = JSON.parse(data)
  switch (parsed.type) {                              ← 基于 data.type 分发
    case "content_block_start": ...
    case "content_block_delta": ...
    ...
  }
```

## 为什么每条消息要有 index ?

他表示全局创建顺序

最新消息判定
不用判断谁在哪条分支、也不用沿着树找"最后生成的节点"，直接取 max(index) 就行。现在"找最新未完成 assistant"就是这么做的：conversation-selectors.ts (line 124)

恢复
页面刷新后，如果有残留的流式消息，需要挑一条继续 resume。有 index 时，直接选全局最新那条未完成消息；没有的话，就得依赖更脆弱的规则，比如比较时间戳、猜当前分支，或者额外持久化"上次恢复目标"。

调试
看日志或 dump 数据时，index=17 比 "这是某个 parent_uuid 下的第 3 个 child" 更直观。你能很快回答"这条消息是在第几个创建出来的""是不是 regenerate 后新长出来的"。

稳定排序
mapping 是个字典，天然没有可靠的全局顺序。要做导出、排查、后台检查、兜底展示时，可以按 index 排序，得到稳定一致的结果。否则就只能依赖对象遍历顺序或 created_at，前者语义弱，后者可能有同一时刻冲突。
