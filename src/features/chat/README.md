**store**

1. 维护 conversation 映射，每个 conversation 包含 domian 和 runtime
2. 更新 runtime 数据的方法
3. 操作会话的方法，如发送消息、停止消息、重新生成等等

**conversaton-domian-reducer**

更新 domian 数据的 reducer

**streaming**

1. 把后端返回的字节流解析成完整的 SSE 事件
2. 把 SSE 协议事件映射成 domain action。
3. 维护"仅流处理中需要"的临时状态。
