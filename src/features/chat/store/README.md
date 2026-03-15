# 全局聊天状态管理架构设计

## 概述

本目录实现了基于 Zustand 的全局聊天状态管理架构，彻底废弃了原有的 `useChat` Hook，实现了以下核心目标：

1. **状态与 UI 解耦**：所有状态管理和 SSE 异步请求都在 React 生命周期之外运行
2. **多会话并发**：支持同时进行多个对话的流式生成，互不干扰
3. **页面切换不中断**：即使组件卸载，后台流式生成继续，回来时无缝接管显示
4. **原子化订阅**：组件按需订阅，避免不必要的重渲染

## 架构设计

### 状态层 (state/chat-state.ts)

```typescript
// 精简后的 ChatState，只包含核心对话数据
export interface ChatState {
  active_child_uuid_by_parent_uuid: Record<string, string>
  current_leaf_message_uuid: string | null
  mapping: Record<string, ConversationNode>
  next_message_index: number
  status: ChatStatus // 'ready' | 'submitted' | 'streaming' | 'error'
}

// 移除了 input 相关状态，交由 UI 组件自行管理
```

**关键设计决策：**
- 剥离了 `input` 状态，避免高频键盘输入影响全局性能
- 保留复杂的消息树结构（支持分支切换）
- 纯函数 `chatReducer` 处理所有状态更新，易于测试和维护

### 全局 Store (store/chat-store.ts)

```typescript
interface ConversationState extends ChatState {
  activeRequest: ActiveRequest | null // 管理当前进行中的 SSE 请求
}

interface ChatStore {
  conversations: Record<string, ConversationState> // 多会话隔离
  initConversation: (id: string, initialLeaf?: string | null) => void
  dispatch: (id: string, action: ChatAction) => void
  sendMessage: (id: string, input: SendMessageInput) => Promise<void>
  // ... 其他业务方法
}
```

**核心特性：**
- **多会话字典结构**：`conversations[conversationId]` 完全隔离不同会话
- **后台请求管理**：`activeRequest` + `AbortController` 在组件卸载后仍保持连接
- **复用现有 Reducer**：直接调用 `chatReducer`，无需重写业务逻辑

### 原子化选择器 (store/chat-selectors.ts)

```typescript
export const useConversationMessages = (id: string) => 
  useChatStore(useShallow(state => {
    const conv = state.conversations[id]
    return conv ? selectCurrentBranchMessages(conv) : []
  }))

export const useConversationStatus = (id: string) => 
  useChatStore(state => state.conversations[id]?.status ?? 'ready')
```

**性能优化：**
- 使用 `useShallow` 避免不必要的重渲染
- 组件只订阅自己关心的数据片段
- 消息列表变化不会影响输入框，反之亦然

## UI 组件改造

### ConversationView 组件

```typescript
// 改造前：依赖巨型 useChat Hook
const { messages, status, sendMessage, stop } = useChat({...})

// 改造后：按需订阅 + 精准调用
const messages = useConversationMessages(conversationId)
const status = useConversationStatus(conversationId)
const sendMessage = useChatStore(state => state.sendMessage)
```

**关键改进：**
- 消除了 Prop Drilling，组件直接订阅所需状态
- 方法调用需要传入 `conversationId`，支持多会话操作
- `onConversationChanged` 回调通过 `.finally()` 包装，保持原有逻辑

### ConversationComposer 组件

```typescript
// 完全本地化输入状态管理
const [input, setInput] = useState('')

const handleSubmit = async () => {
  const text = input.trim()
  setInput('') // 立即清空本地状态
  await sendMessage(conversationId, { model: selectedModel, prompt: text })
}
```

**设计优势：**
- 输入框状态完全本地化，避免全局状态频繁更新
- 高频键盘输入只影响当前组件，性能最优
- 发送时立即清空，用户体验流畅

## 数据流图

```
用户输入 → ConversationComposer (本地状态)
    ↓
sendMessage(conversationId, payload)
    ↓
useChatStore.sendMessage (全局 Store)
    ↓
fetch + consumeChatCompletionStream (后台 SSE)
    ↓
dispatch(conversationId, action) → chatReducer → 状态更新
    ↓
useConversationMessages/useConversationStatus (原子订阅)
    ↓
UI 组件重渲染（仅相关组件）
```

## 核心收益

### 1. 后台持久生成
- 组件卸载 → Store 继续接收 SSE 数据
- 页面切换回来 → UI 自动显示最新内容
- 多标签页同时生成 → 互不干扰

### 2. 极致性能
- 输入框打字：只重渲染输入组件
- 消息流式输出：只重渲染消息列表
- 状态变化：精准订阅，避免级联更新

### 3. 代码简洁
- 无需复杂的 Prop Drilling
- UI 组件职责单一，易于测试
- 业务逻辑集中，便于维护

## 迁移指南

### 从 useChat 迁移

```typescript
// 旧代码
const { messages, status, sendMessage } = useChat({ conversationId })

// 新代码
const messages = useConversationMessages(conversationId)
const status = useConversationStatus(conversationId)
const sendMessage = useChatStore(state => state.sendMessage)

// 调用时传入 conversationId
await sendMessage(conversationId, { model, prompt })
```

### 初始化会话

```typescript
// 在组件挂载时初始化
useEffect(() => {
  init(conversationId, initialLeaf, mapping)
}, [conversationId, init])
```

## 最佳实践

1. **避免在循环中使用 Hooks**：如需循环内数据，直接从 Store 获取原始状态
2. **保持选择器纯粹**：选择器只做数据派生，不包含副作用
3. **合理使用 useShallow**：对于对象/数组返回值，避免不必要的深度比较
4. **错误处理集中化**：在 Store 层统一处理网络错误和异常

## 文件结构

```
store/
├── chat-store.ts      # 全局 Zustand Store，包含所有业务逻辑
├── chat-selectors.ts  # 原子化选择器 Hooks
└── README.md         # 本文档
```

这种架构设计确保了聊天功能的可扩展性、性能和用户体验的极致平衡。
