import type { ChatCitation } from "#/features/conversation";

function escapeHtmlAttribute(value: string) {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function createCitationTag(uuid: string) {
	return `<cite-pill uuid="${escapeHtmlAttribute(uuid)}"></cite-pill>`;
}

export function injectCitationPillsIntoMarkdown(
	markdown: string,
	citations: ChatCitation[],
) {
	if (citations.length === 0 || markdown.length === 0) {
		return markdown;
	}

	const markdownLength = markdown.length;
	const sortedCitations = citations
		.map((citation, index) => ({ citation, index }))
		.sort((left, right) => {
			if (left.citation.end_index !== right.citation.end_index) {
				return right.citation.end_index - left.citation.end_index;
			}

			return right.index - left.index;
		});

	let nextMarkdown = markdown;

	for (const { citation } of sortedCitations) {
		const endIndex = citation.end_index;

		if (
			!Number.isInteger(endIndex) ||
			endIndex < 0 ||
			endIndex > markdownLength
		) {
			continue;
		}

		nextMarkdown =
			nextMarkdown.slice(0, endIndex) +
			createCitationTag(citation.uuid) +
			nextMarkdown.slice(endIndex);
	}

	return nextMarkdown;
}
