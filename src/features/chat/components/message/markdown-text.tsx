import { useMemo } from "react";
import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { ChatCitation } from "#/features/conversation";
import { cn } from "#/lib/utils";
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
			a: ({ children, ...props }: ComponentPropsWithoutRef<"a">) => (
				<a
					{...props}
					className="font-medium text-lagoon-deep underline decoration-[rgba(50,143,151,0.35)] underline-offset-4 transition hover:text-palm"
					rel="noreferrer"
					target="_blank"
				>
					{children}
				</a>
			),
			inlineCode: ({
				children,
				className,
				...props
			}: ComponentPropsWithoutRef<"code">) => (
				<code
					{...props}
					className={cn(
						"rounded-md bg-[rgba(255,255,255,0.72)] px-1.5 py-0.5 font-mono text-[0.84em] text-sea-ink",
						className,
					)}
				>
					{children}
				</code>
			),
			li: ({ children }: { children?: ReactNode }) => (
				<li className="mt-1 text-[0.95rem] leading-7 text-sea-ink">
					{children}
				</li>
			),
			ol: ({ children }: { children?: ReactNode }) => (
				<ol className="my-0 list-decimal pl-6 text-[0.95rem] leading-7 text-sea-ink">
					{children}
				</ol>
			),
			p: ({ children }: { children?: ReactNode }) => (
				<p className="my-0 whitespace-pre-wrap text-[0.95rem] leading-7 text-sea-ink">
					{children}
				</p>
			),
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
			strong: ({ children }: { children?: ReactNode }) => (
				<strong className="font-semibold text-sea-ink">{children}</strong>
			),
			table: ({ children, ...props }: ComponentPropsWithoutRef<"table">) => (
				<div className="my-4 overflow-x-auto">
					<table
						{...props}
						className="w-full text-left border-collapse text-[0.95rem]"
					>
						{children}
					</table>
				</div>
			),
			tbody: ({ children, ...props }: ComponentPropsWithoutRef<"tbody">) => (
				<tbody {...props} className="text-sea-ink">
					{children}
				</tbody>
			),
			td: ({ children, ...props }: ComponentPropsWithoutRef<"td">) => (
				<td {...props} className="px-2 py-2.5 text-sea-ink">
					{children}
				</td>
			),
			th: ({ children, ...props }: ComponentPropsWithoutRef<"th">) => (
				<th {...props} className="px-2 py-2.5 font-semibold text-sea-ink">
					{children}
				</th>
			),
			thead: ({ children, ...props }: ComponentPropsWithoutRef<"thead">) => (
				<thead
					{...props}
					className="border-b border-line text-sea-ink font-semibold"
				>
					{children}
				</thead>
			),
			tr: ({ children, ...props }: ComponentPropsWithoutRef<"tr">) => (
				<tr
					{...props}
					className="border-b border-line/50 last:border-0 hover:bg-black/2 dark:hover:bg-white/2 transition-colors"
				>
					{children}
				</tr>
			),
			ul: ({ children }: { children?: ReactNode }) => (
				<ul className="my-0 list-disc pl-6 text-[0.95rem] leading-7 text-sea-ink">
					{children}
				</ul>
			),
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
				plugins={{ code }}
			>
				{renderedText}
			</Streamdown>

			{isStreaming ? (
				<span className="inline-block h-4 w-px translate-y-1 bg-sea-ink-soft align-baseline animate-pulse" />
			) : null}
		</div>
	);
}
