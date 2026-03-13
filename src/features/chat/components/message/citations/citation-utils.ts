import type { ChatCitation } from '../../../models/chat';

export function getCitationSourceLabel(citation: ChatCitation) {
	return (
		citation.metadata?.site_name ??
		citation.sources[0]?.source ??
		citation.metadata?.site_domain ??
		"Unknown source"
	);
}

export function getCitationSourceIcon(citation: ChatCitation) {
	return (
		citation.sources[0]?.icon_url ?? citation.metadata?.favicon_url ?? null
	);
}

export function getCitationHref(citation: ChatCitation) {
	return citation.url ?? citation.sources[0]?.url ?? "#";
}
