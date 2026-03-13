import type { ChatCitation } from '../../../models/chat';

interface MarkdownNode {
	children?: MarkdownNode[];
	position?: {
		end?: {
			offset?: number;
		};
		start?: {
			offset?: number;
		};
	};
	type: string;
	value?: string;
}

function getNodeOffsets(node: MarkdownNode) {
	const start = node.position?.start?.offset;
	const end = node.position?.end?.offset;

	if (typeof start !== "number" || typeof end !== "number") {
		return null;
	}

	return {
		end,
		start,
	};
}

function createCitationHtmlNode(uuid: string): MarkdownNode {
	return {
		type: "html",
		value: `<span data-citation-pill="${uuid}"></span>`,
	};
}

function cloneTextNode(node: MarkdownNode, value: string): MarkdownNode {
	return {
		...node,
		value,
	};
}

function injectCitationPills(
	node: MarkdownNode,
	citations: ChatCitation[],
	startIndex = 0,
): number {
	if (!Array.isArray(node.children) || node.children.length === 0) {
		return startIndex;
	}

	const nextChildren: MarkdownNode[] = [];
	let citationIndex = startIndex;

	for (const child of node.children) {
		citationIndex = injectCitationPills(child, citations, citationIndex);

		const bounds = getNodeOffsets(child);

		if (child.type === "text" && typeof child.value === "string" && bounds) {
			let consumedOffset = bounds.start;
			let consumedValueLength = 0;

			while (citationIndex < citations.length) {
				const citation = citations[citationIndex];

				if (
					citation.end_index <= consumedOffset ||
					citation.end_index >= bounds.end
				) {
					break;
				}

				const sliceEnd = citation.end_index - bounds.start;
				const segmentValue = child.value.slice(consumedValueLength, sliceEnd);

				if (segmentValue) {
					nextChildren.push(cloneTextNode(child, segmentValue));
				}

				nextChildren.push(createCitationHtmlNode(citation.uuid));
				consumedOffset = citation.end_index;
				consumedValueLength = sliceEnd;
				citationIndex += 1;
			}

			const trailingValue = child.value.slice(consumedValueLength);

			if (trailingValue) {
				nextChildren.push(cloneTextNode(child, trailingValue));
			}
		} else {
			nextChildren.push(child);
		}

		while (citationIndex < citations.length && bounds) {
			const citation = citations[citationIndex];

			if (citation.end_index !== bounds.end) {
				break;
			}

			nextChildren.push(createCitationHtmlNode(citation.uuid));
			citationIndex += 1;
		}
	}

	node.children = nextChildren;
	return citationIndex;
}

export function createCitationRemarkPlugin(citations: ChatCitation[]) {
	const sortedCitations = [...citations].sort(
		(left, right) => left.end_index - right.end_index,
	);

	return () => {
		return (tree: MarkdownNode) => {
			injectCitationPills(tree, sortedCitations);
		};
	};
}
