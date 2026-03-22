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

export class StreamProtocolError extends Error {
  constructor(
    message: string,
    public readonly rawData: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StreamProtocolError";
  }
}

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

function tryParsePartialJson(value: string): unknown | undefined {
  try {
    return parsePartialJson(value, Allow.ALL);
  } catch {
    return undefined;
  }
}

function tryParsePartialInput(
  value: string,
): Record<string, unknown> | null | undefined {
  const result = tryParsePartialJson(value);
  if (result === undefined) return undefined;
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return null;
}

export async function assertSuccessfulResponse(response: Response) {
  const { ok, body } = response;

  if (!ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Chat completion request failed with status ${response.status}: ${errorBody}`,
    );
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
  const responseBody = await assertSuccessfulResponse(response);

  const reader = responseBody.getReader();
  const decoder = new TextDecoder();

  let didReceiveMessageStop = false;
  let assistantMessageUuid: string | null = null;
  const activeContentBlocks = new Map<number, ActiveContentBlock>();

  // ---- Text delta batching (RAF) ----
  // Buffer text deltas and flush once per animation frame to reduce
  // Immer produce + React re-render frequency during fast streaming.
  const pendingTextDeltas = new Map<
    string,
    { messageUuid: string; index: number; text: string }
  >();
  let flushRafId: number | null = null;

  const flushPendingTextDeltas = () => {
    for (const delta of pendingTextDeltas.values()) {
      dispatch({
        index: delta.index,
        messageUuid: delta.messageUuid,
        text: delta.text,
        type: "text-block-delta-received",
      });
    }
    pendingTextDeltas.clear();
    flushRafId = null;
  };

  const scheduleTextDeltaFlush = () => {
    if (flushRafId === null) {
      flushRafId = requestAnimationFrame(flushPendingTextDeltas);
    }
  };

  /** Flush pending text deltas synchronously before dispatching a non-text-delta action. */
  const flushAndDispatch = (action: ConversationAction) => {
    if (pendingTextDeltas.size > 0) {
      if (flushRafId !== null) {
        cancelAnimationFrame(flushRafId);
        flushRafId = null;
      }
      flushPendingTextDeltas();
    }
    dispatch(action);
  };

  const getAssistantMessageUuidOrThrow = (eventType: string) => {
    if (!assistantMessageUuid) {
      throw new Error(`Received ${eventType} before message_start.`);
    }

    return assistantMessageUuid;
  };

  const parser = createSseParser(({ data }) => {
    let parsed: ChatCompletionSseEvent;
    try {
      parsed = JSON.parse(data) as ChatCompletionSseEvent;
    } catch (error) {
      throw new StreamProtocolError(
        "Failed to parse SSE event data as JSON.",
        data,
        error,
      );
    }

    switch (parsed.type) {
      case "message_start": {
        const payload = parsed as ChatCompletionMessageStartEvent;

        // 记录 assistantMessageUuid，供后续事件使用
        assistantMessageUuid = payload.message.uuid;

        // 更新 status
        onAssistantMessageStarted?.();

        // 添加 assistant message
        flushAndDispatch({
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

        // 更新 status
        onAssistantMessageStarted?.();

        flushAndDispatch({
          message: payload.message,
          type: "message-snapshot-received",
        });

        // 重新构建 activeContentBlocks
        activeContentBlocks.clear();
        payload.message.content.forEach((block, index) => {
          if (!block) return;

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
            flushAndDispatch({
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
            flushAndDispatch({
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
            flushAndDispatch({
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

              // Buffer text deltas instead of dispatching immediately
              const key = `${messageUuid}:${payload.index}`;
              const existing = pendingTextDeltas.get(key);
              if (existing) {
                existing.text += payload.delta.text;
              } else {
                pendingTextDeltas.set(key, {
                  index: payload.index,
                  messageUuid,
                  text: payload.delta.text,
                });
              }
              scheduleTextDeltaFlush();
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
              flushAndDispatch({
                citation: {
                  ...openCitation.citation,
                  end_index: activeBlock.textLength,
                  start_index: openCitation.startIndex,
                },
                index: payload.index,
                messageUuid,
                type: "text-block-citation-added",
              });
              break;
            }
            break;

          case "tool_use":
            if (payload.delta.type === "input_json_delta") {
              activeBlock.inputJsonBuffer += payload.delta.partial_json;
              const parsedInput = tryParsePartialInput(
                activeBlock.inputJsonBuffer,
              );

              if (parsedInput !== undefined) {
                flushAndDispatch({
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
            // The protocol reuses "input_json_delta" for tool_result's display_content
            // streaming — the delta type name refers to the wire format, not the target field.
            if (payload.delta.type === "input_json_delta") {
              activeBlock.displayContentJsonBuffer +=
                payload.delta.partial_json;
              const parsedDisplayContent = tryParsePartialJson(
                activeBlock.displayContentJsonBuffer,
              );

              if (parsedDisplayContent !== undefined) {
                flushAndDispatch({
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
            flushAndDispatch({
              index: payload.index,
              messageUuid,
              type: "tool-use-updated",
              update: payload.update,
            });
            break;

          case "tool_result":
            flushAndDispatch({
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
          flushAndDispatch({
            messageUuid,
            stop_timestamp: payload.stop_timestamp,
            toolUseId: activeBlock.toolUseId,
            type: "tool-result-stopped",
          });
          activeContentBlocks.delete(payload.index);
          break;
        }

        flushAndDispatch({
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

        flushAndDispatch({
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

        flushAndDispatch({
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
        flushAndDispatch({
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

  // Flush any remaining buffered text deltas synchronously
  if (pendingTextDeltas.size > 0) {
    if (flushRafId !== null) {
      cancelAnimationFrame(flushRafId);
      flushRafId = null;
    }
    flushPendingTextDeltas();
  }

  if (activeContentBlocks.size > 0) {
    console.warn(
      `Stream ended with ${activeContentBlocks.size} unclosed content block(s).`,
    );
  }

  if (!didReceiveMessageStop) {
    throw new Error("Chat completion stream ended before message_stop.");
  }
}
