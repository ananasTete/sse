import { useMemo } from "react";
import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";

import type { ChatCitation } from "#/features/conversation";
import { CitationPill } from "./citations/citation-pill";
import { injectCitationPillsIntoMarkdown } from "./citations/citation-remark-plugin";

interface MarkdownTextProps {
  citations: ChatCitation[];
  isStreaming?: boolean;
  text: string;
}

export function MarkdownText({
  citations,
  isStreaming = false,
  text,
}: MarkdownTextProps) {
  const citationByUuid = useMemo(
    () => new Map(citations.map((citation) => [citation.uuid, citation])),
    [citations],
  );

  const components = useMemo(
    () => ({
      "cite-pill": (props: Record<string, unknown>) => {
        const citationUuid = props.uuid;

        if (typeof citationUuid === "string") {
          const citation = citationByUuid.get(citationUuid);

          if (!citation) {
            return null;
          }

          return <CitationPill citation={citation} />;
        }

        return null;
      },
    }),
    [citationByUuid],
  );

  const renderedText = useMemo(() => {
    const safeText = text.trim() ? text : " ";
    return injectCitationPillsIntoMarkdown(safeText, citations);
  }, [citations, text]);

  return (
    <div className="space-y-3">
      <Streamdown
        allowedTags={{ "cite-pill": ["uuid"] }}
        components={components}
        isAnimating={isStreaming}
        mode={isStreaming ? "streaming" : "static"}
        caret="block"
        plugins={{ code }}
      >
        {renderedText}
      </Streamdown>
    </div>
  );
}
