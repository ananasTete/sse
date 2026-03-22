import type { ChatStatus } from "../models/message";

export interface ActiveRequest {
  assistantMessageUuid: string;
  controller: AbortController;
}

/**
 * 运行时状态：仅描述"程序当前在做什么"，不描述业务实体。
 *
 * 特点：
 * - 不可序列化（AbortController）或刷新后无意义
 * - 不需要持久化到后端
 * - 随进程生命周期消亡
 */
export interface ConversationRuntimeState {
  activeRequest: ActiveRequest | null;
  errorMessage: string | null;
  status: ChatStatus;
}

export function createInitialConversationRuntimeState(): ConversationRuntimeState {
  return {
    activeRequest: null,
    errorMessage: null,
    status: "ready",
  };
}

