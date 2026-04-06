## 数据模型

### message 模型

### 会话

## 接口设计

## 流程

## SSE 方案

详见 [Streaming.md](./Streaming.md)。

## conversation store 架构

## 分支

### 数据结构

因为要支持分支功能，整个会话消息要是一棵树，使用Map形式的扁平树来表示树，实现 O(1) 级索引。

```json
{
  "current_leaf_message_uuid": "019d13f0-38a6-710d-97eb-7a2205bbdd45",
  "mapping": {
    "00000000-0000-4000-8000-000000000000": {
      "child_uuids": ["019d13f0-38a6-710d-97eb-77675e5b27d2"],
      "message": null,
      "parent_uuid": null,
      "uuid": "00000000-0000-4000-8000-000000000000"
    },
    "019d13f0-38a6-710d-97eb-77675e5b27d2": {
      "child_uuids": ["019d13f0-38a6-710d-97eb-7a2205bbdd45"],
      "message": "",
      "parent_uuid": "00000000-0000-4000-8000-000000000000",
      "uuid": "019d13f0-38a6-710d-97eb-77675e5b27d2"
    },
    "019d13f0-38a6-710d-97eb-7a2205bbdd45": {
      "child_uuids": [],
      "message": "",
      "parent_uuid": "019d13f0-38a6-710d-97eb-77675e5b27d2",
      "uuid": "019d13f0-38a6-710d-97eb-7a2205bbdd45"
    }
  }
}
```

- 通过 `current_leaf_message_uuid`（当前分支的最后一个节点） 和每个节点的 `parent_uuid` 就可以倒着找到当前分支的所有消息
- 通过 `child_uuids` 就可以查找所有子节点，实现切换分支功能

### 切换分支

在 store 中暴露 selectBranch 方法，传入切换目标消息 id。

- 在内部从目标消息 id 向下查找，每次取 child_uuids 的最后一个元素，直到最后一个节点，更新 `current_leaf_message_uuid`，这样前端 UI 就可以渲染出当前分支的消息
- 发送请求同步最新的 `current_leaf_message_uuid` 到后端

### UI 层

暴露 `useSiblingUuids` hook，传入消息 id，返回该消息的父节点的 child_uuids 或 null。在前端渲染切换分支功能。

- 每个消息订阅自己的 `useSiblingUuids`。

## 回放

触发时机、判断条件、旧数据显示

### 判定时机

UI 只订阅 conversation 中的数据，所以网络请求到的会话详情会在 store 中构建新的 conversation。在构建后可以判断最新消息是否未完成。

### 判断条件

通过 `stop_reason === null` 判定是一个未完成的会话。

### 如何回放？

回放需要：直接显示之前生成的数据+继续流式输出后续数据

再确认需要回放后，会调用回放接口，在返回的 SSE 协议中包含 `message_snapshot` 事件替换 `message_start`，该事件包含未完成的消息的快照。之后合并到对应的消息以及重建接收 SSE 响应的运行时状态。

## 性能优化

### 分层订阅数据

- 在 store domain 中维护着当前分支的 Message uuid 数组： `current_branch_message_uuids`，在消息列表订阅这个数组。
- `MessageItem`（memo 组件）使用 `useMessageRole` 只订阅消息的 `role`，用于决定渲染 User 还是 Assistant 组件
- 在每个消息组件内部（`AssistantMessageView` / `UserMessageView`）使用 `useMessage` 订阅完整消息
- 在每个消息中使用 `useSiblingUuids` 订阅当前消息的兄弟节点列表实现分支功能

**为什么 `MessageItem` 只订阅 `role` 而不是整个 message？**

`MessageItem` 是 memo 组件，它只需要 `role` 来决定渲染哪种消息视图。如果订阅整个 message 对象，流式传输期间每次 text delta 都会产生 message 的新引用（因为 Immer 深拷贝），导致 memo 失效、`MessageItem` 重新渲染。而 `role` 是原始值（string），Zustand 默认的 `Object.is` 比较可以保证引用稳定，流式传输期间 `MessageItem` 零重渲染。

**为什么不维护完整的 Message 数组，而只是 uuid?**

如果订阅 Message 数组，store 就会维护 [Message1, Message2, Message3, ...] 这样的数据，当任何消息的 content.text 发生变化，就会导致整个数组发生变化，从而触发所有订阅该数组的组件重新渲染。（见下方的 immer）

现在在 store domain 维护这个 uuid 数组，在以下场景修改数据来触发更新：

- message-appended
- branch-selected
- message-snapshot-received 但仅当是“新节点插入”时
- hydrateConversation
- refreshConversation

### 流式 delta 高频触发 Immer produce + React 重渲染

- 每个 text_delta 事件（~30-50 次/秒）都会触发 Immer produce + React 重渲染
- 将多个 Delta 暂存，用 requestAnimationFrame 一次性 dispatch

### 流式 Markdown 渲染优化

**问题**：流式传输期间，text delta 会使 message 对象产生新引用（Immer 深拷贝），导致 `AssistantMessageView` 及其子组件以 ~60fps 的频率重渲染。而 ReactMarkdown 每次渲染都会重新跑完整的 remark/rehype 管线，产生大量 CPU 开销。

**当前方案 — 使用 Streamdown（Vercel 官方）替换 ReactMarkdown**

- Streamdown 是专为 AI 流式场景设计的 Markdown 渲染器，内部做了 memoized rendering 和 LRU 缓存
- 通过 `mode="streaming"` + `isAnimating` 区分流式和静态模式
- 内置 `remend` 处理未闭合的 markdown 语法（如流式中的 `` `code ``、`**bold`）
- Citation 使用 Streamdown 的 Custom HTML Tag 机制：通过 `allowedTags` 注册自定义 `<cite-pill>` 标签，在 `components` 中映射为 `CitationPill` 组件

```tsx
<Streamdown
  allowedTags={{ "cite-pill": ["uuid"] }}
  components={components}
  isAnimating={isStreaming}
  mode={isStreaming ? "streaming" : "static"}
>
  {renderedText}
</Streamdown>
```

**备选方案 — 节流 Markdown 渲染（不引入新依赖时可参考）**

将流式文本拆成两部分渲染 — 已解析的 markdown + 未解析的纯文本尾巴。用 `useThrottledValue(text, 300)`，每 300ms 才更新传给 ReactMarkdown 的文本，而 `tailText = text.slice(throttledText.length)` 作为纯文本实时追加渲染。这样 markdown 解析频率从 ~60fps 降到 ~3fps，降低 ~95% 的 CPU 开销。

```
┌──────────────────────────────────────────────┐
│  ReactMarkdown(throttledText)                │  ← 每 300ms 更新一次
│  <span>{tailText}</span>                     │  ← 实时追加，无解析开销
│  <span className="cursor" />                 │
└──────────────────────────────────────────────┘
```

## 为什么要使用 immer

不使用 immer：zustand 的数据要求保持不可变性且更新机制是浅对比，任何数据的变化都需要手动展开数据的所有层级进行深拷贝。否则不会触发订阅更新。

```js
set((state) => ({
  conversations: {
    ...state.conversations,
    [id]: {
      ...state.conversations[id],
      domain: {
        ...state.conversations[id].domain,
        mapping: {
          ...state.conversations[id].domain.mapping,
          [parentUuid]: {
            ...state.conversations[id].domain.mapping[parentUuid],
            child_uuids: [
              ...state.conversations[id].domain.mapping[parentUuid].child_uuids,
              newChildUuid,
            ],
          },
        },
      },
    },
  },
}));
```

使用 immer：开发者可以使用数据可变性的写法，达到数据不可变性的效果。他内部实现和上面写法一样，都是深拷贝，只是帮开发者省略了深拷贝的写法。

```js
set((draft) => {
  draft.conversations[id].domain.mapping[parentUuid].child_uuids.push(
    newChildUuid,
  );
});
```

注意！即使只更新了 A 中某个深层的数据，实际上还是对整个 A 进行了深拷贝，他的引用是会变化的。

## zustand

- store 中任何数据的变化，都会触发所有订阅的 selector 函数的重新执行，并对结果使用 `Object.is()` 进行浅对比（对比引用），如果结果发生变化，就会触发组件重新渲染。

- 当你想以对象/数组的方式一次导入多个状态时，为了避免每次 {} 创建新对象，导致浅对比失败，需要使用 `useShallow`。他会对对象中的每个元素进行浅对比，如果每个元素的结果都和上一次相同，则不会触发组件重新渲染。

```ts
export const useConversationActions = () => {
  return useConversationStore(
    useShallow((state) => ({
      // ← 每次 {} 创建新对象，必须用 useShallow
      editAndResend: state.editAndResend,
      selectBranch: state.selectBranch,
      // ...
    })),
  );
};
```
