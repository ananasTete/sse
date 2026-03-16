# Chat Utils

聊天功能相关的工具函数集合。

## 文件说明

### chat-stream.ts

处理聊天完成流（Server-Sent Events）的核心模块。主要功能包括：

- 解析 SSE 流数据并分发相应的 action
- 处理消息开始、内容块、增量更新、停止等各种事件
- 管理活跃的内容块状态（文本、工具使用、工具结果）
- 支持引用（citations）的实时解析和定位
- 处理工具调用的输入 JSON 流式解析

### conversation.ts

会话管理工具。提供：

- 创建空的对话映射结构
- 基于摘要构建对话详情快照
- 获取对话显示标题（处理空标题的回退逻辑）

### message-builder.ts

消息构建器。负责创建标准化的聊天消息对象：

- `createUserMessage` - 创建用户消息
- `createAssistantMessage` - 创建助手消息
- `createContentBlock` - 创建内容块（文本、工具使用）
- `createToolResultBlock` - 创建工具结果块

### sse.ts

Server-Sent Events 解析器封装。提供：

- `createSseParser` - 创建 SSE 事件解析器，处理流式数据
- `normalizeParsedEvent` - 标准化事件格式，对齐 SSE 协议
- `formatSseEvent` - 格式化 SSE 事件输出
- 错误处理和解析器状态管理

### time.ts

时间工具函数。提供：

- `getISOTimestamp` - 获取 ISO 格式的时间戳

### index.ts

模块导出入口，统一导出所有工具函数。
