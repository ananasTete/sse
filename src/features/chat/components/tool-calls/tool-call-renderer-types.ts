import type { ChatToolUseContent } from "../../types";

export interface ToolCallRendererProps {
	block: ChatToolUseContent;
	expanded: boolean;
	isStreaming: boolean;
	onToggle: () => void;
}
