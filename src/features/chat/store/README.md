# Conversation Store Architecture

## Overview

本目录承载聊天会话的全局状态管理实现。当前设计目标只有三个：

1. 把副作用和领域状态更新分开
2. 支持多会话并发与页面切换后的流式续传
3. 保持状态边界清晰，但不过度设计

当前实现采用：

- Zustand 负责全局 store
- `conversation-store.ts` 负责副作用编排与运行态更新
- `conversation-state.ts` 负责 domain reducer
- `conversation-selectors.ts` 负责派生读取

## Core Model

每个会话在 store 中的结构是：

```ts
interface ConversationState {
  domain: ChatConversationDetail
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

### Domain

`domain` 只保存会话详情对象模型，也就是服务端语义上的会话内容：

```ts
interface ChatConversationDetail {
  uuid: string
  title: string
  created_at: string
  updated_at: string
  current_leaf_message_uuid: string | null
  mapping: ConversationMapping
}
```

这里回答的问题是：

- 这段会话是什么
- 当前持久化的消息树是什么
- 当前服务端视角的主分支叶子是谁

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

### Runtime

`runtime` 保存所有不属于 `ChatConversationDetail` 的本地状态：

```ts
interface ConversationRuntimeState {
  status: ChatStatus
  activeRequest: {
    assistantMessageUuid: string
    controller: AbortController
  } | null
  errorMessage: string | null
  active_child_uuid_by_parent_uuid: Record<string, string>
  next_message_index: number
}
```

这里回答的问题是：

- 当前前端是否正在提交或流式生成
- 当前请求句柄是谁，能不能取消
- 当前本地错误是什么
- 每个父节点当前选中的子分支是谁
- 下一条本地追加消息应该拿什么顺序号

### Derived

有一类数据不存状态，只通过 selector 计算：

- 当前分支消息数组
- 每条消息的 `branchInfo`
- UI 展示用 `plainText`
- 当前 assistant 消息是否处于 streaming

这些都在 `state/conversation-selectors.ts` 中派生，不进入 `domain` 或 `runtime`。

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

### `conversation-state.ts`

负责：

- `ConversationAction` 定义
- `reduceConversationDomain(...)`
- 消息树 append / merge / branch select
- block delta / tool result / citation 等 domain 更新

它不负责：

- fetch
- SSE 读取
- AbortController
- `status` / `activeRequest` / `errorMessage`

### `conversation-runtime.ts`

负责：

- `ConversationRuntimeState` 类型
- 运行态初始化
- `buildActiveChildMap(...)`
- `getNextMessageIndex(...)`

### `conversation-selectors.ts`

负责纯派生读取：

- `selectCurrentBranchMessages(...)`
- `selectBranchChildUuids(...)`
- `getMessageByUuid(...)`
- `findIncompleteStreamMessageUuid(...)`

### `store/conversation-selectors.ts`

负责把 Zustand store 包成面向组件的 hooks：

- `useConversationMessages`
- `useConversationStatus`
- `useConversationErrorMessage`
- `useConversationSummary`
- `useMessage`

## Update Rules

### 1. Hydrate / Refresh

服务端详情回来时：

- `domain = detail`
- `runtime.active_child_uuid_by_parent_uuid = buildActiveChildMap(...)`
- `runtime.next_message_index = getNextMessageIndex(...)`
- `runtime.status = "ready"`
- `runtime.activeRequest = null`
- `runtime.errorMessage = null`

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
- `content_block_delta` -> 各类 text/tool actions
- `message_delta` -> `message-stop-reason-updated`
- `message_limit` -> `message-metadata-updated`
- `title` -> `title-updated`

也就是说，stream 层只做“事件翻译”，不直接改 Zustand state。

### 4. Domain Dispatch

`dispatchDomain(conversationId, action)` 是 domain 更新的唯一入口。

内部流程是：

1. 取出当前 `conversation.domain`
2. 取出 reducer 所需的 runtime 辅助字段
3. 调用 `reduceConversationDomain(...)`
4. 把返回的 `domain` 和 runtime 辅助结果写回 store

这样可以把：

- `mapping`
- `current_leaf_message_uuid`
- `active_child_uuid_by_parent_uuid`
- `next_message_index`

这种天然耦合的更新收拢到一个地方。

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
2. reducer 内更新：
   - `runtime.active_child_uuid_by_parent_uuid`
   - `domain.current_leaf_message_uuid`
3. store 再异步调用接口持久化 leaf

如果持久化失败，只写 `runtime.errorMessage`，不强制回滚当前 UI 分支。

## Busy Semantics

当前“会话是否忙碌”的判断统一通过 `isConversationBusy(...)`：

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

这套设计不是为了“更标准”，而是为了控制复杂度。

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
- 不把 runtime 再拆成更细的 request/view 子层
- 不把 action 再拆成多个碎文件

换句话说，这是一套“足够清晰，但不过度设计”的实现。

## Typical Data Flow

```text
用户输入
  -> ConversationComposer 本地 state
  -> useConversationStore.getState().sendMessage(...)
  -> conversation-store.ts 编排请求
  -> processChatCompletionStream(...)
  -> dispatchDomain(conversationId, action)
  -> reduceConversationDomain(...)
  -> useConversationMessages / useConversationStatus
  -> UI 更新
```

## Notes

- 输入框 `input`、`selectedModel`、编辑态等仍然保持组件本地状态
- 当前分支消息数组始终是派生值，不允许冗余缓存到 runtime
- `domain` 的唯一来源应该是服务端 detail 模型和 domain actions
- 新增逻辑时，优先先判断它属于 `domain`、`runtime` 还是 `derived`

## File Map

```text
store/
├── conversation-store.ts
├── conversation-selectors.ts
└── README.md

state/
├── conversation-state.ts
├── conversation-runtime.ts
├── conversation-selectors.ts
└── index.ts
```
