# Conversation Store Architecture

## Overview

本目录承载聊天会话的全局状态管理实现。当前设计目标只有三个：

1. 把副作用和领域状态更新分开
2. 支持多会话并发与页面切换后的流式续传
3. 保持状态边界清晰，但不过度设计

当前实现采用：

- Zustand 负责全局 store
- `conversation-store.ts` 负责副作用编排与运行态更新
- `conversation-reducer.ts` 负责 domain reducer
- `conversation-selectors.ts` 负责基于 store 的派生读取

## Core Model

每个会话在 store 中的结构是：

```ts
interface ConversationState {
  domain: ConversationDomainState
  runtime: ConversationRuntimeState
}
```

顶层 store 为：

```ts
interface ConversationStore {
  conversations: Record<string, ConversationState>
}
```

也就是每个 `conversationId` 对应一份独立会话状态，彼此隔离。

## State Layers

### Domain vs Runtime 区分原则

核心问题是：**"这条数据，描述的是业务实体本身，还是程序当前在做什么？"**

| 维度 | Domain | Runtime |
|------|--------|---------|
| 描述的是 | 世界是什么样的（What the world IS） | 程序正在做什么（What the program IS DOING） |
| 页面刷新后 | 应该恢复 | 自然消亡 |
| 可序列化 | ✅ 是 | ❌ 不一定（如 AbortController） |
| 来源 | 后端实体或其派生 | 异步操作、UI 流程 |

### Domain

`ConversationDomainState` 在 `ChatConversationDetail`（后端 DTO）基础上，额外增加了两个**前端领域层维护的派生字段**：

```ts
interface ConversationDomainState extends ChatConversationDetail {
  // 消息树的"活跃路径索引"：每个父节点当前选中的子分支
  // 可从 mapping + current_leaf_message_uuid 派生，但在 domain 内维护以保持一致性
  active_child_uuid_by_parent_uuid: Record<string, string>

  // 下一条本地追加消息的顺序号，等价于 MAX(message.index) + 1
  next_message_index: number
}
```

这里回答的问题是：

- 这段会话是什么
- 当前持久化的消息树是什么
- 当前服务端视角的主分支叶子是谁
- 每个父节点当前选中的子分支是谁（活跃路径）
- 下一条本地消息应该拿什么顺序号

`mapping` 是一棵扁平树：

```ts
interface ConversationNode {
  uuid: string
  parent_uuid: string | null
  child_uuids: string[]
  message: ChatMessage | null
}
```

消息本体、文本块、tool_use、tool_result、citation 都属于 `domain`。

> **注意**：`active_child_uuid_by_parent_uuid` 和 `next_message_index` 曾被归类到 Runtime。
> 但它们描述的是"对话树现在是什么样的"，是可以从 `mapping` 派生的领域状态，
> 不是"程序正在做什么"，因此归属 Domain。

### Runtime

`runtime` 只保存**真正的运行时瞬态**：随请求生命周期产生、随进程消亡的数据。

```ts
interface ConversationRuntimeState {
  status: ChatStatus          // 当前流式状态
  activeRequest: {            // 当前请求句柄，用于取消
    assistantMessageUuid: string
    controller: AbortController  // 不可序列化
  } | null
  errorMessage: string | null // 当前本地错误
}
```

这里回答的问题是：

- 当前前端是否正在提交或流式生成
- 当前请求句柄是谁，能不能取消
- 当前本地错误是什么

### Derived

有一类数据不存状态，只通过 selector 计算：

- 当前分支消息数组
- 每条消息的 `branchInfo`
- UI 展示用 `plainText`
- 当前 assistant 消息是否处于 streaming

这些都在 `conversation-selectors.ts` 中派生，不进入 `domain` 或 `runtime`。

## File Responsibilities

### `conversation-store.ts`

负责：

- 创建和维护 `conversations`
- `sendMessage` / `regenerate` / `resumeStream` / `stop`
- 管理 `AbortController`
- 更新 `runtime.status`
- 更新 `runtime.activeRequest`
- 更新 `runtime.errorMessage`
- 调用 `dispatchDomain(...)`

它不负责：

- 手写深层消息树变更
- 直接在多个地方散落操作 `mapping`

### `conversation-reducer.ts`

负责：

- `ConversationDomainState` 类型（含 `active_child_uuid_by_parent_uuid`、`next_message_index`）
- `ConversationAction` 定义
- `reduceConversationDomain(domain, action) => domain`：domain 状态机的纯函数
- 消息树 append / merge / branch select
- block delta / tool result / citation 等 domain 更新

它不负责：

- fetch
- SSE 读取
- AbortController
- `status` / `activeRequest` / `errorMessage`

Reducer 签名严格为 `(domain, action) => domain`，不接收也不修改 runtime。

### `conversation-runtime.ts`

负责：

- `ConversationRuntimeState` 类型（仅含 status / activeRequest / errorMessage）
- 运行态初始化
- `buildActiveChildMap(...)` — hydrate 时初始化 `domain.active_child_uuid_by_parent_uuid`
- `getNextMessageIndex(...)` — hydrate 时初始化 `domain.next_message_index`

### `conversation-selectors.ts`

负责纯派生读取：

- `selectCurrentBranchMessages(...)`
- `selectBranchChildUuids(...)`
- `getMessageByUuid(...)`
- `findIncompleteStreamMessageUuid(...)`

## Update Rules

### 1. Hydrate / Refresh

服务端详情回来时，domain 在后端 DTO 基础上初始化派生字段：

```ts
domain = {
  ...detail,
  active_child_uuid_by_parent_uuid: buildActiveChildMap(detail.mapping, detail.current_leaf_message_uuid),
  next_message_index: getNextMessageIndex(detail.mapping),
}
runtime = createInitialConversationRuntimeState() // { status: 'ready', activeRequest: null, errorMessage: null }
```

如果检测到存在未结束的 assistant message，则继续走 `resumeStream(...)`。

### 2. Send Message

发送消息时：

1. 用 `isConversationBusy(...)` 判断当前会话是否在进行中
2. 先通过 `dispatchDomain({ type: "message-appended" })` 乐观追加 user message
3. 更新 `runtime.status = "submitted"`
4. 创建并保存 `runtime.activeRequest`
5. 发起 completion 请求

### 3. Streaming Events

SSE 处理在 `streaming/completion-stream.ts` 中完成。

流事件会被翻译成 `ConversationAction`，例如：

- `message_start` -> `message-appended`
- `message_snapshot` -> `message-snapshot-received`
- `message_update` -> `message-updated`
- `content_block_delta` -> 各类 text/tool_use/tool_result actions
- `content_block_update` -> `tool-use-updated` / `tool-result-updated`
- `message_limit` -> `message-metadata-updated`
- `title` -> `title-updated`

也就是说，stream 层只做"事件翻译"，不直接改 Zustand state。

### 4. Domain Dispatch

`dispatchDomain(conversationId, action)` 是 domain 更新的唯一入口。

内部流程是：

```ts
conversation.domain = reduceConversationDomain(conversation.domain, action)
```

Reducer 接收完整的 `ConversationDomainState`（包含 `active_child_uuid_by_parent_uuid` 和 `next_message_index`），一次性完成所有相关字段的一致性更新，Store 只做简单赋值。

### 5. Status / Request Lifecycle

请求生命周期不进 reducer，而是在 store 中直接维护：

- 提交前：`status = "submitted"`
- assistant message 开始后：`status = "streaming"`
- 正常结束：`status = "ready"`
- 失败：`status = "error"`
- 取消或 finally：清理 `activeRequest`

这是当前设计里最重要的边界之一：

- 会话内容变化 -> `dispatchDomain`
- 请求生命周期变化 -> store 直接更新 runtime

### 6. Branch Selection

切换分支时：

1. `dispatchDomain({ type: "branch-selected" })`
2. reducer 内在 domain 上一致性更新：
   - `domain.active_child_uuid_by_parent_uuid`
   - `domain.current_leaf_message_uuid`
3. store 再异步调用接口持久化 leaf

如果持久化失败，只写 `runtime.errorMessage`，不强制回滚当前 UI 分支。

## Busy Semantics

当前"会话是否忙碌"的判断统一通过 `isConversationBusy(...)`：

```ts
function isConversationBusy(runtime?: Pick<ConversationRuntimeState, "status" | "activeRequest"> | null) {
  return (
    runtime?.status === "submitted" ||
    runtime?.status === "streaming" ||
    runtime?.activeRequest != null
  )
}
```

这里不只看 `status`，还要看 `activeRequest`，因为两者在 `finally` 清理前可能存在短暂不同步窗口。

## Why This Design

这套设计不是为了"更标准"，而是为了控制复杂度。

### 保留的复杂度

- 多会话
- SSE 流式增量更新
- 工具调用生命周期
- branch / regenerate
- 页面切换后恢复流

### 避免的复杂度

- 不上状态机
- 不引入 Redux Toolkit
- 不把 selector 结果写回 store
- 不把 action 再拆成多个碎文件

### 为什么 active_child_uuid_by_parent_uuid 和 next_message_index 属于 Domain

这两个字段描述的是"对话树现在是什么样的"：

- `active_child_uuid_by_parent_uuid` 是树的活跃路径索引，随 `mapping` 和 `current_leaf_message_uuid` 可完整重建
- `next_message_index` 是消息的自增序号，等价于对 `mapping` 的一个聚合统计

它们不描述"程序正在做什么"，不依赖进程存活，理应属于 Domain。

将它们纳入 Domain 的好处：

1. Reducer 签名纯净：`(domain, action) => domain`
2. Store 的 `dispatchDomain` 只做简单赋值，无需协调 domain/runtime 双向同步
3. Domain Reducer 的单元测试无需构造 runtime mock

## Typical Data Flow

```text
用户输入
  -> ConversationComposer 本地 state
  -> useConversationStore.getState().sendMessage(...)
  -> conversation-store.ts 编排请求
  -> processChatCompletionStream(...)
  -> dispatchDomain(conversationId, action)
  -> reduceConversationDomain(domain, action)
  -> useConversationMessages / useConversationStatus
  -> UI 更新
```

## Notes

- 输入框 `input`、`selectedModel`、编辑态等仍然保持组件本地状态
- 当前分支消息数组始终是派生值，不允许冗余缓存到 runtime
- `domain` 的唯一来源应该是服务端 detail 模型和 domain actions
- 新增逻辑时，优先先判断它属于 `domain`、`runtime` 还是 `derived`
- 判断依据：描述业务实体 -> `domain`；描述程序行为 -> `runtime`；可从已有状态计算 -> `derived`

## File Map

```text
store/
├── conversation-store.ts      # 副作用编排、runtime 管理、dispatchDomain
├── conversation-reducer.ts    # domain 状态机（纯函数）
├── conversation-runtime.ts    # runtime 类型、初始化、hydrate 工具函数
├── conversation-selectors.ts  # 派生读取（纯函数）
├── message-builders.ts        # 消息构建工具
└── README.md
```
