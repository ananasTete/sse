# SSE 断点续传实现计划 (方案 A：快照+增量)

## 1. 概述
本方案旨在解决用户刷新页面或断网重连后，聊天内容无法无缝衔接的问题。通过引入 `message_snapshot` 事件，服务端在恢复流时首先下发当前消息的全量状态，前端据此对齐数据，随后继续消费 `content_block_delta`、`content_block_update`、`message_update` 等后续事件。

## 2. 协议定义
新增 SSE 事件 `message_snapshot`。

- **Event Name**: `message_snapshot`
- **Payload**: `ChatCompletionMessageSnapshotEvent`
  ```json
  {
    "message": {
      "uuid": "msg_...",
      "role": "assistant",
      "content": [
        // 关键点：此处的数组下标需要与后续事件的 index 保持严格对齐，
        // 遇到被嵌套的 tool_result 可能产生 null 占位符。
      ],
      "model": "...",
      "stop_reason": null,
      "metadata": { ... }
    }
  }
  ```

## 3. 前端实现记录

### 3.1 类型定义 (`src/features/chat/models/chat.ts`)
- [x] 新增 `ChatCompletionMessageSnapshotEvent` 接口。
- [x] 更新相关联合类型 (`ChatCompletionSseEvent`)。

### 3.2 状态管理 (`src/features/chat/state/chat-state.ts`)
- [x] **Action**: 新增 `message-snapshot-received`。
- [x] **Reducer**: 
  - 接收快照数据。
  - 查找现有消息节点，如果存在则进行深层状态合并（保持引用、保留层级）。
  - 如果不存在则追加新节点。
  - 强制设置状态为 `streaming` 以重置 UI 显示。

### 3.3 流解析逻辑 (`src/features/chat/utils/chat-stream.ts`)
- [x] 在 `createSseParser` 中监听 `message_snapshot` 事件。
- [x] 解析快照数据，触发 Store Action。
- [x] **关键上下文重建**：
  - 清空并重建 `activeContentBlocks` 映射，确保后续 `content_block_delta` / `content_block_update` 能通过 index 精确映射到正确的正在处理的 Block。
  - **空洞处理(Array Holes)**：处理由于 `tool_result` 被剥离导致的数组 `null` 占位，防止运行期崩溃。

### 3.4 视图渲染 (`src/features/chat/components/message/message-content.tsx`)
- [x] **React Key 优化**：将原本依赖 `stop_timestamp` 这种易变属性的 React key 更改为由 `type` + `start_timestamp` + `index` 组成的稳定 key。这样可以防止消息流生成结束或中断时，组件因为 key 改变而发生重绘并导致光标跳动。

## 4. 后端实现记录

### 4.1 快照构建器 (`src/features/chat/server/utils/snapshot.ts`)
- [x] 模拟前端 Reducer 逻辑，在服务端通过全量回放历史事件计算出消息的“当前状态快照”。
- [x] **索引对齐处理**：为了让生成的快照内容数组 `content` 依然能和之后下发的原始 `index` 对应，对独立工具返回块 (`tool_result`) 使用 `null` 占位而不是强行压缩数组，避免 Delta 下标错位。

### 4.2 接口更新 (`src/routes/api/chat_conversations/$conversationId/resume.tsx`)
- [x] **消除竞态**：采用了**“先订阅、后快照”**的执行顺序。先向 Event Bus 建立监听并暂存事件，等生成并发送完快照后再开启透传。这保证了在快照计算耗时期间新产生的 `delta/update/stop` 事件不会被遗漏，保证时序严格安全。

### 4.3 会话持久化补全 (`src/routes/api/chat_conversations/$conversationId/index.tsx`)
- [x] **状态回填(Backfill)**：由于当前的 Mock DB 设计并不会在生成中途或结束时向库中持久化内容数据，单纯刷新会导致历史生成消息为空。在查询会话详情时，增加了从 Event Bus 拉取历史数据并合并最新 `content` 和 `stop_reason` 的逻辑，防止因前端状态同步不一致导致的误触发循环 `resume`。
