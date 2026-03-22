## 为什么使用 useShallow

为什么要以下面这种方式获取 store 中的方法，而不是直接获取？

```ts
const {
  editAndResend,
  retryFromAssistantMessage,
  retryFromUserMessage,
  selectBranch,
  sendMessage,
  stop,
} = useConversationStore(
  useShallow((state) => ({
    editAndResend: state.editAndResend,
    retryFromAssistantMessage: state.retryFromAssistantMessage,
    retryFromUserMessage: state.retryFromUserMessage,
    selectBranch: state.selectBranch,
    sendMessage: state.sendMessage,
    stop: state.stop,
  })),
);
```

而不是直接在 selector 函数返回对象

```ts
const {
  editAndResend,
  retryFromAssistantMessage,
  retryFromUserMessage,
  selectBranch,
  sendMessage,
  stop,
} = useConversationStore((state) => ({
  editAndResend: state.editAndResend,
  retryFromAssistantMessage: state.retryFromAssistantMessage,
  retryFromUserMessage: state.retryFromUserMessage,
  selectBranch: state.selectBranch,
  sendMessage: state.sendMessage,
  stop: state.stop,
}));
```

或者每一个都单独获取

```ts
const editAndResend = useConversationStore((state) => state.editAndResend);
const retryFromAssistantMessage = useConversationStore((state) => state.retryFromAssistantMessage);
// ...
```

zustand 的判定规则

1. Store 中任意状态发生变化时，Zustand 会重新执行所有订阅了该 store 的 selector 函数
2. 然后用 相等性比较函数 对比 selector 的新返回值和旧返回值
3. 默认比较函数是 Object.is()（即 ===），所以每次直接用 selector 返回 { ... } 新对象时，{} !== {} → 判定为"变了" → 触发重渲染
4. 不使用 selector 返回对象，而每一个状态都单独获取一次可以解决问题，但数量一多代码冗长可读性会下降，适合少量状态的场景
5. useShallow 把比较函数替换为浅比较，逐属性用 Object.is() 对比 → 属性都没变 → 判定为"没变" → 不触发重渲染，适合大量状态的场景
