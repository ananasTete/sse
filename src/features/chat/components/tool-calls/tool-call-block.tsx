import type { ComponentType } from "react";

import { DefaultToolCall } from "./default-tool-call";
import type { ToolCallRendererProps } from "./tool-call-renderer-types";
import { WebSearchToolCall } from "./web-search-tool-call";

const TOOL_CALL_COMPONENTS = {
	web_search: WebSearchToolCall,
} satisfies Record<string, ComponentType<ToolCallRendererProps>>;

export function ToolCallBlock(props: ToolCallRendererProps) {
	const Renderer = TOOL_CALL_COMPONENTS[props.block.name] ?? DefaultToolCall;

	return <Renderer {...props} />;
}
