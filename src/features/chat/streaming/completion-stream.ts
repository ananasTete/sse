import { parse as parsePartialJson, Allow } from "partial-json";
import { createSseParser } from "./sse-parser";
import {
  createAssistantMessage,
  createContentBlock,
  createToolResultBlock,
} from "../store/message-builders";
import type { ChatCitation } from "../models/message";
import type {
  ChatCompletionContentBlockDeltaEvent,
  ChatCompletionContentBlockStartEvent,
  ChatCompletionContentBlockStopEvent,
  ChatCompletionContentBlockUpdateEvent,
  ChatCompletionMessageLimitEvent,
  ChatCompletionMessageSnapshotEvent,
  ChatCompletionMessageStartEvent,
  ChatCompletionMessageUpdateEvent,
  ChatCompletionSseEvent,
  ChatCompletionTitleEvent,
} from "../models/events";
import type { ConversationAction } from "../store/conversation-reducer";

type ActiveContentBlock =
  | {
      openCitations: Map<
        string,
        {
          citation: Omit<ChatCitation, "end_index" | "start_index">;
          startIndex: number;
        }
      >;
      textLength: number;
      type: "text";
    }
  | {
      inputJsonBuffer: string;
      type: "tool_use";
    }
  | {
      displayContentJsonBuffer: string;
      toolUseId: string;
      type: "tool_result";
    };

function tryParseJson<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function tryParsePartialInput(value: string) {
  try {
    return parsePartialJson(value, Allow.ALL) as Record<string, unknown> | null;
  } catch {
    return undefined;
  }
}

export function assertSuccessfulResponse(response: Response) {
  const { ok, body } = response;

  if (!ok) {
    throw new Error(
      `Chat completion request failed with status ${response.status}.`,
    );
  }

  if (!body) {
    throw new Error("Chat completion response did not include a stream body.");
  }

  if (!body) {
    throw new Error("Chat completion response did not include a stream body.");
  }

  return body;
}

export async function processChatCompletionStream({
  response,
  dispatch,
  onAssistantMessageStarted,
}: {
  response: Response;
  dispatch: (action: ConversationAction) => void;
  onAssistantMessageStarted?: () => void;
}) {
  const responseBody = assertSuccessfulResponse(response);

  const reader = responseBody.getReader();
  const decoder = new TextDecoder();

  let didReceiveMessageStop = false;
  let assistantMessageUuid: string | null = null;
  const activeContentBlocks = new Map<number, ActiveContentBlock>();

  const getAssistantMessageUuidOrThrow = (eventType: string) => {
    if (!assistantMessageUuid) {
      throw new Error(`Received ${eventType} before message_start.`);
    }

    return assistantMessageUuid;
  };

  const parser = createSseParser(({ data }) => {
    const parsed = JSON.parse(data) as ChatCompletionSseEvent;

    switch (parsed.type) {
      case "message_start": {
        const payload = parsed as ChatCompletionMessageStartEvent;

        // 记录 assistantMessageUuid，供后续事件使用
        assistantMessageUuid = payload.message.uuid;

        // 更新 status
        onAssistantMessageStarted?.();

        // 添加 assistant message
        dispatch({
          message: createAssistantMessage(payload),
          type: "message-appended",
        });
        break;
      }
      case "message_snapshot": {
        // 在 resume 时该事件会返回被中断的响应消息
        const payload = parsed as ChatCompletionMessageSnapshotEvent;

        // 记录 assistantMessageUuid，供后续事件使用
        assistantMessageUuid = payload.message.uuid;

        onAssistantMessageStarted?.();

        dispatch({
          message: payload.message,
          type: "message-snapshot-received",
        });

        // Reconstruct active content blocks from snapshot to support subsequent deltas
        activeContentBlocks.clear();
        payload.message.content.forEach((block, index) => {
          if (!block) return; // Handle null blocks (array holes from tool_result)

          if (block.type === "text") {
            activeContentBlocks.set(index, {
              openCitations: new Map(),
              textLength: block.text.length,
              type: "text",
            });
          } else if (block.type === "tool_use") {
            activeContentBlocks.set(index, {
              inputJsonBuffer: block.input ? JSON.stringify(block.input) : "",
              type: "tool_use",
            });
          }
        });
        break;
      }

      case "content_block_start": {
        const payload = parsed as ChatCompletionContentBlockStartEvent;

        const messageUuid = getAssistantMessageUuidOrThrow(parsed.type);

        switch (payload.content_block.type) {
          case "text":
            activeContentBlocks.set(payload.index, {
              openCitations: new Map(),
              textLength: payload.content_block.text.length,
              type: "text",
            });
            dispatch({
              index: payload.index,
              messageUuid,
              type: "content-block-started",
              value: createContentBlock(payload),
            });
            break;

          case "tool_use":
            activeContentBlocks.set(payload.index, {
              inputJsonBuffer: "",
              type: "tool_use",
            });
            dispatch({
              index: payload.index,
              messageUuid,
              type: "content-block-started",
              value: createContentBlock(payload),
            });
            break;

          case "tool_result":
            activeContentBlocks.set(payload.index, {
              displayContentJsonBuffer: "",
              toolUseId: payload.content_block.tool_use_id,
              type: "tool_result",
            });
            dispatch({
              messageUuid,
              type: "tool-result-started",
              value: createToolResultBlock(payload),
            });
            break;
        }
        break;
      }

      case "content_block_delta": {
        const payload = parsed as ChatCompletionContentBlockDeltaEvent;
        const messageUuid = getAssistantMessageUuidOrThrow(parsed.type);
        const activeBlock = activeContentBlocks.get(payload.index);

        if (!activeBlock) {
          break;
        }

        switch (activeBlock.type) {
          case "text":
            if (payload.delta.type === "text_delta") {
              activeBlock.textLength += payload.delta.text.length;
              dispatch({
                index: payload.index,
                messageUuid,
                text: payload.delta.text,
                type: "text-block-delta-received",
              });
              break;
            }

            if (payload.delta.type === "citation_start_delta") {
              activeBlock.openCitations.set(payload.delta.citation.uuid, {
                citation: payload.delta.citation,
                startIndex: activeBlock.textLength,
              });
              break;
            }

            if (payload.delta.type === "citation_end_delta") {
              const openCitation = activeBlock.openCitations.get(
                payload.delta.citation_uuid,
              );

              if (!openCitation) {
                break;
              }

              activeBlock.openCitations.delete(payload.delta.citation_uuid);
              dispatch({
                citation: {
                  ...openCitation.citation,
                  end_index: activeBlock.textLength,
                  start_index: openCitation.startIndex,
                },
                index: payload.index,
                messageUuid,
                type: "text-block-citation-added",
              });
            }
            break;

          case "tool_use":
            if (payload.delta.type === "input_json_delta") {
              activeBlock.inputJsonBuffer += payload.delta.partial_json;
              const parsedInput = tryParsePartialInput(
                activeBlock.inputJsonBuffer,
              );

              if (parsedInput !== undefined) {
                dispatch({
                  index: payload.index,
                  messageUuid,
                  type: "tool-use-updated",
                  update: {
                    input: parsedInput,
                  },
                });
              }
            }
            break;

          case "tool_result":
            if (payload.delta.type === "input_json_delta") {
              activeBlock.displayContentJsonBuffer +=
                payload.delta.partial_json;
              const parsedDisplayContent = tryParseJson<unknown>(
                activeBlock.displayContentJsonBuffer,
              );

              if (parsedDisplayContent !== undefined) {
                dispatch({
                  messageUuid,
                  toolUseId: activeBlock.toolUseId,
                  type: "tool-result-updated",
                  update: {
                    display_content: parsedDisplayContent,
                  },
                });
              }
            }

            break;
        }
        break;
      }

      case "content_block_update": {
        const payload = parsed as ChatCompletionContentBlockUpdateEvent;
        const messageUuid = getAssistantMessageUuidOrThrow(parsed.type);
        const activeBlock = activeContentBlocks.get(payload.index);

        if (!activeBlock) {
          break;
        }

        switch (activeBlock.type) {
          case "text":
            break;

          case "tool_use":
            dispatch({
              index: payload.index,
              messageUuid,
              type: "tool-use-updated",
              update: payload.update,
            });
            break;

          case "tool_result":
            dispatch({
              messageUuid,
              toolUseId: activeBlock.toolUseId,
              type: "tool-result-updated",
              update: payload.update,
            });
            break;
        }
        break;
      }

      case "content_block_stop": {
        const payload = parsed as ChatCompletionContentBlockStopEvent;
        const messageUuid = getAssistantMessageUuidOrThrow(parsed.type);
        const activeBlock = activeContentBlocks.get(payload.index);

        if (activeBlock?.type === "tool_result") {
          dispatch({
            messageUuid,
            stop_timestamp: payload.stop_timestamp,
            toolUseId: activeBlock.toolUseId,
            type: "tool-result-stopped",
          });
          activeContentBlocks.delete(payload.index);
          break;
        }

        dispatch({
          index: payload.index,
          messageUuid,
          stop_timestamp: payload.stop_timestamp,
          type: "content-block-stopped",
        });
        activeContentBlocks.delete(payload.index);
        break;
      }

      case "message_limit": {
        const payload = parsed as ChatCompletionMessageLimitEvent;

        dispatch({
          messageUuid: getAssistantMessageUuidOrThrow(parsed.type),
          metadata: {
            message_limit: payload.message_limit,
          },
          type: "message-metadata-updated",
        });
        break;
      }

      case "message_update": {
        const payload = parsed as ChatCompletionMessageUpdateEvent;

        dispatch({
          delta: payload.delta,
          messageUuid: getAssistantMessageUuidOrThrow(parsed.type),
          type: "message-updated",
        });
        break;
      }

      case "message_stop": {
        didReceiveMessageStop = true;
        break;
      }

      case "title": {
        const payload = parsed as ChatCompletionTitleEvent;
        dispatch({
          title: payload.title,
          type: "title-updated",
        });
        break;
      }

      default:
        break;
    }
  });

  /**
   * 1. read() 从网络流拿到字节块（字节数组）
   * 2. decode() 把字节块解码成文本字符串
   * 3. { stream: true } 因为一个 UTF-8 字符可能刚好被拆在两个 chunk 之间，它会帮你正确拼接，不会把多字节字符解坏。
   * 4. sseParser.feed() 把解码后的文本喂给 SSE 解析器
   * 5. 解析器会将 SSE 消息片段拼装成完整消息后触发回调，这样就能拿到完整消息而不是碎片
   */
  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    parser.feed(decoder.decode(value, { stream: true }));
  }

  parser.reset();

  if (!didReceiveMessageStop) {
    throw new Error("Chat completion stream ended before message_stop.");
  }
}
