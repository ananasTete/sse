import { formatSseEvent } from "../../streaming";
import { getISOTimestamp } from "../../utils/time";
import { publishEvent, isAborted } from "./event-bus";
import type { ChatCitation } from "../../models/chat";
import type { ChatCompletionRequest } from "../../models/chat";

// Helper functions
function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function chunkText(text: string) {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const chunkSize = Math.floor(Math.random() * 3) + 1;
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize;
  }
  return chunks;
}

function chunkJson(text: string) {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const chunkSize = Math.floor(Math.random() * 20) + 10;
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize;
  }
  return chunks;
}

// Mock data generators
function buildSearchQuery(body: ChatCompletionRequest) {
  return body.prompt.trim().slice(0, 50);
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function buildSearchResults(_query: string): SearchResult[] {
  return [
    {
      title: "DeepSeek API Pricing",
      url: "https://apidog.com/blog/codex-pricing/",
      snippet: "每五小时 30–150 个本地任务",
    },
    {
      title: "OpenAI Pricing",
      url: "https://openai.com/pricing",
      snippet: "GPT-4 API pricing information",
    },
    {
      title: "Anthropic Claude",
      url: "https://anthropic.com",
      snippet: "Claude AI assistant pricing",
    },
  ];
}

function toCitation(result: SearchResult): ChatCitation {
  return {
    end_index: 0,
    metadata: {
      favicon_url: `https://www.google.com/s2/favicons?sz=64&domain=${new URL(result.url).hostname}`,
      site_domain: new URL(result.url).hostname,
      site_name: new URL(result.url).hostname,
      type: "webpage",
    },
    origin_tool_name: "web_search",
    sources: [
      {
        icon_url: null,
        source: result.snippet,
        title: result.title,
        url: result.url,
        uuid: `citation-${Date.now()}`,
      },
    ],
    start_index: 0,
    title: result.title,
    url: result.url,
    uuid: `citation-${Date.now()}`,
  };
}

interface MockReplySegment {
  text?: string;
  type: "text" | "citation_start" | "citation_end";
  citation?: ChatCitation;
  citationUuid?: string;
}

function buildMockReplySegments(
  body: ChatCompletionRequest,
  query: string,
  searchResults: SearchResult[],
): MockReplySegment[] {
  const prompt = body.prompt.trim();
  const citationResult = searchResults[2] ?? searchResults[0];
  const citation = toCitation(citationResult);

  return [
    {
      text:
        body.trigger === "regenerate"
          ? prompt
            ? `Regenerated response to: **${prompt}**\n\n`
            : `Regenerated response for user message \`${body.parent_uuid}\`\n\n`
          : `Mock response to: **${query}**\n\n`,
      type: "text",
    },
    {
      citation,
      type: "citation_start",
    },
    {
      text: "每五小时 30–150 个本地任务（含周限额），支持 CLI 和 IDE 集成",
      type: "text",
    },
    {
      citationUuid: citation.uuid,
      type: "citation_end",
    },
    {
      text: [
        "。",
        "",
        `- \`web_search\` returned ${searchResults.length} knowledge items`,
        "- Citation pills should appear inline after the cited span",
        "- Markdown formatting should remain intact while the text streams in",
      ].join("\n"),
      type: "text",
    },
  ];
}

// Main background generator function
export async function runBackgroundGeneration({
  assistantMessageUuid,
  assistantTimestamp,
  body,
  assistantParentUuid,
  toolUseId,
}: {
  assistantMessageUuid: string;
  assistantTimestamp: string;
  body: ChatCompletionRequest;
  assistantParentUuid: string;
  toolUseId: string;
}) {
  // Prevent duplicate runs
  if (isAborted(assistantMessageUuid)) {
    return;
  }

  let textLength = 0;
  const openCitations = new Map<
    string,
    {
      citation: Omit<ChatCitation, "end_index" | "start_index">;
      startIndex: number;
    }
  >();

  const enqueue = (chunk: string) => {
    if (isAborted(assistantMessageUuid)) return false;
    const match = chunk.match(/"type"\s*:\s*"([a-z_]+)"/);
    publishEvent(assistantMessageUuid, chunk, match ? match[1] : undefined);
    return true;
  };

  try {
    // Build mock data
    const query = buildSearchQuery(body);
    const searchResults = buildSearchResults(query);
    const replySegments = buildMockReplySegments(body, query, searchResults);

    // Send message_start
    if (
      !enqueue(
        formatSseEvent("message_start", {
          message: {
            content: [],
            created_at: assistantTimestamp,
            id: `chatcompl_${assistantMessageUuid.replaceAll("-", "")}`,
            model: body.model,
            parent_uuid: assistantParentUuid,
            role: "assistant",
            stop_reason: null,
            stop_sequence: null,
            type: "message",
            updated_at: assistantTimestamp,
            uuid: assistantMessageUuid,
          },
          type: "message_start",
        }),
      )
    ) {
      return;
    }

    await sleep(280);

    // Tool use block
    const toolUseStartTimestamp = getISOTimestamp();
    if (
      !enqueue(
        formatSseEvent("content_block_start", {
          content_block: {
            display_content: null,
            flags: null,
            icon_name: "globe",
            id: toolUseId,
            input: null,
            message: "Searching the web",
            name: "web_search",
            start_timestamp: toolUseStartTimestamp,
            stop_timestamp: null,
            type: "tool_use",
          },
          index: 0,
          type: "content_block_start",
        }),
      )
    ) {
      return;
    }

    for (const chunk of chunkJson(JSON.stringify({ query }))) {
      await sleep(180);
      if (
        !enqueue(
          formatSseEvent("content_block_delta", {
            delta: {
              partial_json: chunk,
              type: "input_json_delta",
            },
            index: 0,
            type: "content_block_delta",
          }),
        )
      ) {
        return;
      }
    }

    await sleep(100);

    // Keep emitting a full input snapshot in update for future consumers,
    // even though the current UI relies on partial-json parsing from delta.
    if (
      !enqueue(
        formatSseEvent("content_block_update", {
          index: 0,
          type: "content_block_update",
          update: {
            display_content: {
              preview_url: "https://developers.openai.com/codex/pricing/",
            },
            input: { query },
            message:
              "Fetching: https://developers.openai.com/codex/pricing/",
          },
        }),
      )
    ) {
      return;
    }

    await sleep(200);

    // Stop tool_use block (index 0)
    const toolUseStopTimestamp = getISOTimestamp();
    if (
      !enqueue(
        formatSseEvent("content_block_stop", {
          index: 0,
          stop_timestamp: toolUseStopTimestamp,
          type: "content_block_stop",
        }),
      )
    ) {
      return;
    }

    await sleep(500);

    // Tool result block
    const toolResultStartTimestamp = getISOTimestamp();
    const toolResultMessage = `Found ${searchResults.length} sources`;
    if (
      !enqueue(
        formatSseEvent("content_block_start", {
          content_block: {
            display_content: null,
            flags: null,
            icon_name: "globe",
            is_error: false,
            message: toolResultMessage,
            name: "web_search",
            start_timestamp: toolResultStartTimestamp,
            stop_timestamp: null,
            tool_use_id: toolUseId,
            type: "tool_result",
          },
          index: 1,
          type: "content_block_start",
        }),
      )
    ) {
      return;
    }

    // Tool result JSON
    for (const chunk of chunkJson(JSON.stringify(searchResults))) {
      await sleep(160);
      if (
        !enqueue(
          formatSseEvent("content_block_delta", {
            delta: {
              partial_json: chunk,
              type: "input_json_delta",
            },
            index: 1,
            type: "content_block_delta",
          }),
        )
      ) {
        return;
      }
    }

    await sleep(200);

    // Stop tool_result block (index 1)
    const toolResultStopTimestamp = getISOTimestamp();
    if (
      !enqueue(
        formatSseEvent("content_block_stop", {
          index: 1,
          stop_timestamp: toolResultStopTimestamp,
          type: "content_block_stop",
        }),
      )
    ) {
      return;
    }

    await sleep(800);

    // Text block
    const textBlockStartTimestamp = getISOTimestamp();
    if (
      !enqueue(
        formatSseEvent("content_block_start", {
          content_block: {
            citations: [],
            flags: null,
            start_timestamp: textBlockStartTimestamp,
            stop_timestamp: null,
            text: "",
            type: "text",
          },
          index: 2,
          type: "content_block_start",
        }),
      )
    ) {
      return;
    }

    // Process reply segments
    for (const segment of replySegments) {
      if (segment.type === "citation_start") {
        await sleep(70);
        if (
          !enqueue(
            formatSseEvent("content_block_delta", {
              delta: {
                citation: segment.citation!,
                type: "citation_start_delta",
              },
              index: 2,
              type: "content_block_delta",
            }),
          )
        ) {
          return;
        }
        openCitations.set(segment.citation!.uuid, {
          citation: segment.citation!,
          startIndex: textLength,
        });
        continue;
      }

      if (segment.type === "citation_end") {
        await sleep(70);
        if (
          !enqueue(
            formatSseEvent("content_block_delta", {
              delta: {
                citation_uuid: segment.citationUuid!,
                type: "citation_end_delta",
              },
              index: 2,
              type: "content_block_delta",
            }),
          )
        ) {
          return;
        }
        openCitations.delete(segment.citationUuid!);
        continue;
      }

      // Text chunks
      for (const chunk of chunkText(segment.text || "")) {
        await sleep(70);
        if (
          !enqueue(
            formatSseEvent("content_block_delta", {
              delta: {
                text: chunk,
                type: "text_delta",
              },
              index: 2,
              type: "content_block_delta",
            }),
          )
        ) {
          return;
        }
        textLength += chunk.length;
      }
    }

    await sleep(180);

    // Stop text block
    const textBlockStopTimestamp = getISOTimestamp();
    if (
      !enqueue(
        formatSseEvent("content_block_stop", {
          index: 2,
          stop_timestamp: textBlockStopTimestamp,
          type: "content_block_stop",
        }),
      )
    ) {
      return;
    }

    await sleep(120);

    if (
      !enqueue(
        formatSseEvent("message_update", {
          delta: {
            stop_reason: "end_turn",
            stop_sequence: null,
          },
          type: "message_update",
        }),
      )
    ) {
      return;
    }

    await sleep(40);

    enqueue(
      formatSseEvent("message_stop", {
        type: "message_stop",
      }),
    );
  } catch (error) {
    console.error("Background generation error:", error);
  }
}
