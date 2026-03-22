import { useMemo } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";

import { cn } from "#/lib/utils";
import { CitationPill } from "./citations/citation-pill";
import { createCitationRemarkPlugin } from "./citations/citation-remark-plugin";
import type { ChatCitation } from "#/features/conversation";
import type { ReactNode, ComponentPropsWithoutRef } from "react";

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

	const remarkPlugins = useMemo(
		() => [createCitationRemarkPlugin(citations)],
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
			code: ({
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
			pre: ({ children, ...props }: ComponentPropsWithoutRef<"pre">) => (
				<pre
					{...props}
					className="overflow-x-auto rounded-2xl border border-line bg-[rgba(255,255,255,0.66)] p-3 text-sm leading-6 text-sea-ink"
				>
					{children}
				</pre>
			),
			span: ({
				children,
				...props
			}: ComponentPropsWithoutRef<"span">) => {
				const citationUuid = (props as Record<string, unknown>)[
					"data-citation-pill"
				];

				if (typeof citationUuid === "string") {
					const citation = citationByUuid.get(citationUuid);

					if (!citation) {
						return null;
					}

					return <CitationPill citation={citation} />;
				}

				return <span {...props}>{children}</span>;
			},
			strong: ({ children }: { children?: ReactNode }) => (
				<strong className="font-semibold text-sea-ink">
					{children}
				</strong>
			),
			ul: ({ children }: { children?: ReactNode }) => (
				<ul className="my-0 list-disc pl-6 text-[0.95rem] leading-7 text-sea-ink">
					{children}
				</ul>
			),
		}),
		[citationByUuid],
	);

	const renderedText = text.trim() ? text : " ";

	return (
		<div className="space-y-3">
			<Streamdown
				allowedTags={{ span: ["data-citation-pill"] }}
				components={components}
				isAnimating={isStreaming}
				mode={isStreaming ? "streaming" : "static"}
				remarkPlugins={remarkPlugins}
			>
				{renderedText}
			</Streamdown>

			{isStreaming ? (
				<span className="inline-block h-4 w-px translate-y-1 bg-sea-ink-soft align-baseline animate-pulse" />
			) : null}
		</div>
	);
}
