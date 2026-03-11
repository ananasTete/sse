import type { ChatContent } from "../types";
import { MarkdownText } from "./markdown-text";
import { ToolCallBlock } from "./tool-calls/tool-call-block";

interface MessageContentProps {
	blocks: ChatContent[];
	expandedToolBlocks: Record<string, boolean>;
	isStreamingMessage: boolean;
	onToggleToolBlock: (toolUseId: string) => void;
}

export function MessageContent({
	blocks,
	expandedToolBlocks,
	isStreamingMessage,
	onToggleToolBlock,
}: MessageContentProps) {
	return (
		<div className="space-y-3">
			{blocks.map((block) => {
				if (block.type === "text") {
					const showCursor =
						isStreamingMessage && block.stop_timestamp === null;

					return (
						<MarkdownText
							citations={block.citations}
							isStreaming={showCursor}
							key={`${block.type}-${block.start_timestamp}-${block.stop_timestamp ?? "streaming"}`}
							text={block.text}
						/>
					);
				}

				const isExpanded =
					expandedToolBlocks[block.id] ?? Boolean(block.tool_result?.is_error);
				const blockIsStreaming =
					isStreamingMessage && block.stop_timestamp === null;

				return (
					<ToolCallBlock
						block={block}
						expanded={isExpanded}
						isStreaming={blockIsStreaming}
						key={block.id}
						onToggle={() => {
							onToggleToolBlock(block.id);
						}}
					/>
				);
			})}
		</div>
	);
}
