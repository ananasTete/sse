import type { ChatToolUseContent } from '../../../models/chat';

export interface ToolCallRendererProps {
	block: ChatToolUseContent;
	expanded: boolean;
	isStreaming: boolean;
	onToggle: () => void;
}
