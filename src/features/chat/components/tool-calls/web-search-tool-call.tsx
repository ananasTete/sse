import { ToolCallLayout } from "./tool-call-layout";
import type { ToolCallRendererProps } from "./tool-call-renderer-types";
import {
	getActiveDisplayContent,
	getActiveToolIconName,
	getToolLabel,
	getToolTitle,
	hasDisplayContent,
} from "./tool-call-utils";
import { WebSearchToolDisplayContent } from "./web-search-tool-display-content";

export function WebSearchToolCall({
	block,
	expanded,
	isStreaming,
	onToggle,
}: ToolCallRendererProps) {
	const displayContent = getActiveDisplayContent(block);
	const hasDetails = hasDisplayContent(displayContent);

	return (
		<ToolCallLayout
			expanded={expanded}
			hasDetails={hasDetails}
			iconName={getActiveToolIconName(block)}
			isError={Boolean(block.tool_result?.is_error)}
			isStreaming={isStreaming}
			label={getToolLabel(block.name)}
			onToggle={onToggle}
			summary={getToolTitle(block)}
		>
			<WebSearchToolDisplayContent value={displayContent} />
		</ToolCallLayout>
	);
}
