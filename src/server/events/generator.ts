import { formatSseEvent } from "#/features/conversation/streaming";
import { getISOTimestamp } from "#/features/conversation/utils/time";
import { publishEvent, isAborted } from "./event-bus";
import type { ChatCitation } from "#/features/conversation/models/chat";
import type { ChatCompletionRequest } from "#/features/conversation/models/chat";

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
  const citation = toCitation(citationResult!);

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

interface GeneratorContext {
  assistantMessageUuid: string;
  assistantTimestamp: string;
  body: ChatCompletionRequest;
  assistantParentUuid: string;
  toolUseId: string;
  enqueue: (chunk: string) => boolean;
}

function sendCommonMessageStart(ctx: GeneratorContext) {
  return ctx.enqueue(
    formatSseEvent("message_start", {
      message: {
        content: [],
        created_at: ctx.assistantTimestamp,
        id: `chatcompl_${ctx.assistantMessageUuid.replaceAll("-", "")}`,
        model: ctx.body.model,
        parent_uuid: ctx.assistantParentUuid,
        role: "assistant",
        stop_reason: null,
        stop_sequence: null,
        type: "message",
        updated_at: ctx.assistantTimestamp,
        uuid: ctx.assistantMessageUuid,
      },
      type: "message_start",
    }),
  );
}

function sendCommonMessageTitleTitle(ctx: GeneratorContext, overrideTitle?: string) {
  const generatedTitle = overrideTitle ?? `关于「${ctx.body.prompt.trim().slice(0, 20)}」的回复`;
  return ctx.enqueue(
    formatSseEvent("title", {
      title: generatedTitle,
      type: "title",
    }),
  );
}

function sendCommonMessageEnd(ctx: GeneratorContext) {
  if (
    !ctx.enqueue(
      formatSseEvent("message_update", {
        delta: {
          stop_reason: "end_turn",
          stop_sequence: null,
        },
        type: "message_update",
      }),
    )
  ) {
    return false;
  }

  ctx.enqueue(
    formatSseEvent("message_stop", {
      type: "message_stop",
    }),
  );
  return true;
}

// -----------------------------------------------------------------------------
// Generators
// -----------------------------------------------------------------------------

async function generateToolResponse(ctx: GeneratorContext) {
  let textLength = 0;
  const openCitations = new Map<
    string,
    {
      citation: Omit<ChatCitation, "end_index" | "start_index">;
      startIndex: number;
    }
  >();

  const query = buildSearchQuery(ctx.body);
  const searchResults = buildSearchResults(query);
  const replySegments = buildMockReplySegments(ctx.body, query, searchResults);

  if (!sendCommonMessageStart(ctx)) return;

  await sleep(280);

  // Tool use block
  const toolUseStartTimestamp = getISOTimestamp();
  if (
    !ctx.enqueue(
      formatSseEvent("content_block_start", {
        content_block: {
          display_content: null,
          flags: null,
          icon_name: "globe",
          id: ctx.toolUseId,
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
  ) return;

  for (const chunk of chunkJson(JSON.stringify({ query }))) {
    await sleep(180);
    if (
      !ctx.enqueue(
        formatSseEvent("content_block_delta", {
          delta: {
            partial_json: chunk,
            type: "input_json_delta",
          },
          index: 0,
          type: "content_block_delta",
        }),
      )
    ) return;
  }

  await sleep(100);

  if (
    !ctx.enqueue(
      formatSseEvent("content_block_update", {
        index: 0,
        type: "content_block_update",
        update: {
          display_content: {
            preview_url: "https://developers.openai.com/codex/pricing/",
          },
          input: { query },
          message: "Fetching: https://developers.openai.com/codex/pricing/",
        },
      }),
    )
  ) return;

  await sleep(200);

  const toolUseStopTimestamp = getISOTimestamp();
  if (
    !ctx.enqueue(
      formatSseEvent("content_block_stop", {
        index: 0,
        stop_timestamp: toolUseStopTimestamp,
        type: "content_block_stop",
      }),
    )
  ) return;

  await sleep(500);

  // Tool result block
  const toolResultStartTimestamp = getISOTimestamp();
  const toolResultMessage = `Found ${searchResults.length} sources`;
  if (
    !ctx.enqueue(
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
          tool_use_id: ctx.toolUseId,
          type: "tool_result",
        },
        index: 1,
        type: "content_block_start",
      }),
    )
  ) return;

  for (const chunk of chunkJson(JSON.stringify(searchResults))) {
    await sleep(160);
    if (
      !ctx.enqueue(
        formatSseEvent("content_block_delta", {
          delta: {
            partial_json: chunk,
            type: "input_json_delta",
          },
          index: 1,
          type: "content_block_delta",
        }),
      )
    ) return;
  }

  await sleep(200);

  const toolResultStopTimestamp = getISOTimestamp();
  if (
    !ctx.enqueue(
      formatSseEvent("content_block_stop", {
        index: 1,
        stop_timestamp: toolResultStopTimestamp,
        type: "content_block_stop",
      }),
    )
  ) return;

  await sleep(800);

  // Text block
  const textBlockStartTimestamp = getISOTimestamp();
  if (
    !ctx.enqueue(
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
  ) return;

  for (const segment of replySegments) {
    if (segment.type === "citation_start") {
      await sleep(70);
      if (
        !ctx.enqueue(
          formatSseEvent("content_block_delta", {
            delta: {
              citation: segment.citation!,
              type: "citation_start_delta",
            },
            index: 2,
            type: "content_block_delta",
          }),
        )
      ) return;
      openCitations.set(segment.citation!.uuid, {
        citation: segment.citation!,
        startIndex: textLength,
      });
      continue;
    }

    if (segment.type === "citation_end") {
      await sleep(70);
      if (
        !ctx.enqueue(
          formatSseEvent("content_block_delta", {
            delta: {
              citation_uuid: segment.citationUuid!,
              type: "citation_end_delta",
            },
            index: 2,
            type: "content_block_delta",
          }),
        )
      ) return;
      openCitations.delete(segment.citationUuid!);
      continue;
    }

    for (const chunk of chunkText(segment.text || "")) {
      await sleep(70);
      if (
        !ctx.enqueue(
          formatSseEvent("content_block_delta", {
            delta: {
              text: chunk,
              type: "text_delta",
            },
            index: 2,
            type: "content_block_delta",
          }),
        )
      ) return;
      textLength += chunk.length;
    }
  }

  await sleep(180);

  const textBlockStopTimestamp = getISOTimestamp();
  if (
    !ctx.enqueue(
      formatSseEvent("content_block_stop", {
        index: 2,
        stop_timestamp: textBlockStopTimestamp,
        type: "content_block_stop",
      }),
    )
  ) return;

  await sleep(120);

  if (!sendCommonMessageTitleTitle(ctx)) return;

  await sleep(80);

  sendCommonMessageEnd(ctx);
}

async function generateMdResponse(ctx: GeneratorContext) {
  if (!sendCommonMessageStart(ctx)) return;

  await sleep(200);

  const textBlockStartTimestamp = getISOTimestamp();
  if (
    !ctx.enqueue(
      formatSseEvent("content_block_start", {
        content_block: {
          citations: [],
          flags: null,
          start_timestamp: textBlockStartTimestamp,
          stop_timestamp: null,
          text: "",
          type: "text",
        },
        index: 0,
        type: "content_block_start",
      }),
    )
  ) return;

  const markdownContent = `
# Markdown 语法演示 / Markdown Syntax Demo

这是一个包含各种 Markdown 语法的演示文档。

## 1. 文本格式 (Text Formatting)

**加粗文本 (Bold)**
*斜体文本 (Italic)*
~~删除线 (Strikethrough)~~
\`内联代码 (Inline code)\`

## 2. 列表 (Lists)

### 无序列表 (Unordered List)
- 苹果 (Apple)
- 香蕉 (Banana)
  - 芭蕉 (Plantain)
- 橘子 (Orange)

### 有序列表 (Ordered List)
1. 第一步 (Step 1)
2. 第二步 (Step 2)
3. 第三步 (Step 3)

## 3. 代码块 (Code Blocks)

\`\`\`typescript
// TypeScript Example
interface User {
  id: number;
  name: string;
}

function greet(user: User) {
  console.log(\`Hello, \${user.name}!\`);
}
\`\`\`

## 4. 表格 (Tables)

| 姓名 (Name) | 年龄 (Age) | 职业 (Profession) |
| :--- | :---: | ---: |
| Alice | 24 | Engineer |
| Bob | 30 | Designer |
| Charlie | 28 | Manager |

## 5. 引用 (Blockquotes)

> 这是一个引用块。
> It is a blockquote.
>
> 甚至可以包含多个段落。
> > 以及嵌套引用。

## 6. 链接与图片 (Links and Images)

[OpenAI 官网](https://openai.com)

![Placeholder Image](https://via.placeholder.com/150)

## 7. 分割线 (Horizontal Rules)

---

希望这个演示对你有帮助！
`;

  // Stream text
  for (const chunk of chunkText(markdownContent)) {
    await sleep(20);
    if (
      !ctx.enqueue(
        formatSseEvent("content_block_delta", {
          delta: {
            text: chunk,
            type: "text_delta",
          },
          index: 0,
          type: "content_block_delta",
        }),
      )
    ) return;
  }

  await sleep(100);

  const textBlockStopTimestamp = getISOTimestamp();
  if (
    !ctx.enqueue(
      formatSseEvent("content_block_stop", {
        index: 0,
        stop_timestamp: textBlockStopTimestamp,
        type: "content_block_stop",
      }),
    )
  ) return;

  await sleep(100);

  if (!sendCommonMessageTitleTitle(ctx, "Markdown 演示")) return;

  await sleep(80);

  sendCommonMessageEnd(ctx);
}

async function generateDefaultResponse(ctx: GeneratorContext) {
  if (!sendCommonMessageStart(ctx)) return;

  await sleep(200);

  const textBlockStartTimestamp = getISOTimestamp();
  if (
    !ctx.enqueue(
      formatSseEvent("content_block_start", {
        content_block: {
          citations: [],
          flags: null,
          start_timestamp: textBlockStartTimestamp,
          stop_timestamp: null,
          text: "",
          type: "text",
        },
        index: 0,
        type: "content_block_start",
      }),
    )
  ) return;

  const textContent = "Hey! What's up?";

  for (const chunk of chunkText(textContent)) {
    await sleep(40);
    if (
      !ctx.enqueue(
        formatSseEvent("content_block_delta", {
          delta: {
            text: chunk,
            type: "text_delta",
          },
          index: 0,
          type: "content_block_delta",
        }),
      )
    ) return;
  }

  await sleep(100);

  const textBlockStopTimestamp = getISOTimestamp();
  if (
    !ctx.enqueue(
      formatSseEvent("content_block_stop", {
        index: 0,
        stop_timestamp: textBlockStopTimestamp,
        type: "content_block_stop",
      }),
    )
  ) return;

  await sleep(50);

  if (!sendCommonMessageTitleTitle(ctx, "Hey 招呼")) return;

  await sleep(50);

  sendCommonMessageEnd(ctx);
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

  const enqueue = (chunk: string) => {
    if (isAborted(assistantMessageUuid)) return false;
    const match = chunk.match(/"type"\s*:\s*"([a-z_]+)"/);
    publishEvent(assistantMessageUuid, chunk, match ? match[1] : undefined);
    return true;
  };

  const context: GeneratorContext = {
    assistantMessageUuid,
    assistantTimestamp,
    body,
    assistantParentUuid,
    toolUseId,
    enqueue,
  };

  try {
    const prompt = (body.prompt || "").trim().toLowerCase();
    if (prompt === "md") {
      await generateMdResponse(context);
    } else if (prompt === "tool") {
      await generateToolResponse(context);
    } else {
      await generateDefaultResponse(context);
    }
  } catch (error) {
    console.error("Background generation error:", error);
  }
}
