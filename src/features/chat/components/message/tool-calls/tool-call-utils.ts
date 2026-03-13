import type { ChatToolUseContent } from '../../../models/chat';

export interface KnowledgeItem {
	is_missing?: boolean;
	metadata?: {
		favicon_url?: string;
		site_domain?: string;
		site_name?: string;
		type?: string;
	};
	title?: string;
	type?: string;
	url?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasDisplayContent(value: unknown) {
	if (value == null) {
		return false;
	}

	if (typeof value === "string") {
		return value.trim().length > 0;
	}

	if (Array.isArray(value)) {
		return value.length > 0;
	}

	if (isRecord(value)) {
		return Object.keys(value).length > 0;
	}

	return true;
}

export function isKnowledgeItem(value: unknown): value is KnowledgeItem {
	return isRecord(value);
}

export function isKnowledgeList(value: unknown): value is KnowledgeItem[] {
	return Array.isArray(value) && value.every((item) => isKnowledgeItem(item));
}

export function formatJson(value: unknown) {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function getFirstInputValue(input: Record<string, unknown> | null) {
	const firstValue = input ? Object.values(input)[0] : null;

	if (firstValue == null) {
		return null;
	}

	if (
		typeof firstValue === "string" ||
		typeof firstValue === "number" ||
		typeof firstValue === "boolean"
	) {
		return String(firstValue);
	}

	try {
		return JSON.stringify(firstValue);
	} catch {
		return null;
	}
}

export function getToolTitle(block: ChatToolUseContent) {
	const fallbackTitle = getFirstInputValue(block.input) ?? block.name;

	if (block.tool_result) {
		return block.tool_result.message ?? fallbackTitle;
	}

	return block.message ?? fallbackTitle;
}

export function getActiveToolIconName(block: ChatToolUseContent) {
	return block.tool_result?.icon_name ?? block.icon_name;
}

export function getActiveDisplayContent(block: ChatToolUseContent) {
	return block.tool_result
		? block.tool_result.display_content
		: block.display_content;
}

export function getToolLabel(name: string) {
	return name.replaceAll("_", " ");
}
