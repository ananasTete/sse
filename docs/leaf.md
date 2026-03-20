1. 通过 child_uuids 就能拿到子分支，展示分支消息
2. 通过 parent_uuid + current_leaf_message_uuid 就能找到当前分支

使用 mapping 结构能够快速索引父节点和子节点

## UI层调用

**useCurrentBranchMessageUuids 获取当前分支消息的 uuids**

为什么不直接从 conversation 获取完整的 Message 消息列表，而是返回 uuids ?

因为如果要从 conversation 计算就要依赖它，每次他的更新都会重新计算 Message 列表，当流式输出消息时这是巨大的冗余计算。所以单独维护一个 messageUuids 列表，让 Message UI 自己订阅 conversation 中的 message。

**useMessage 订阅单条消息**

配合上一个 useCurrentBranchMessageUuids，每个 message ui 订阅自己的 message 数据，这样只有当 message 更新时才会重新渲染。分支的计算也只依赖分支的变化。

**useSiblingUuids 订阅父节点的 child_uuids**

通过订阅父节点的 child_uuids 来获取当前消息的位置、以及切换分支时的前后消息 uuid 实现分支切换功能
