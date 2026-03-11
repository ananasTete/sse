import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

import { cn } from "#/lib/utils";

import type { ChatCitation } from "../types";
import { CitationPill } from "./citations/citation-pill";
import { createCitationRemarkPlugin } from "./citations/citation-remark-plugin";

interface MarkdownTextProps {
	citations: ChatCitation[];
	isStreaming?: boolean;
	text: string;
}

function MarkdownParagraph({ children }: { children?: ReactNode }) {
	return (
		<p className="my-0 whitespace-pre-wrap text-[0.95rem] leading-7 text-[var(--sea-ink)]">
			{children}
		</p>
	);
}

function MarkdownList({
	children,
	ordered = false,
}: {
	children?: ReactNode;
	ordered?: boolean;
}) {
	const Tag = ordered ? "ol" : "ul";

	return (
		<Tag
			className={cn(
				"my-0 pl-6 text-[0.95rem] leading-7 text-[var(--sea-ink)]",
				ordered ? "list-decimal" : "list-disc",
			)}
		>
			{children}
		</Tag>
	);
}

export function MarkdownText({
	citations,
	isStreaming = false,
	text,
}: MarkdownTextProps) {
	const citationByUuid = new Map(
		citations.map((citation) => [citation.uuid, citation]),
	);
	const renderedText = text.trim() ? text : " ";

	return (
		<div className="space-y-3">
			<div className="space-y-3">
				<ReactMarkdown
					rehypePlugins={[rehypeRaw]}
					remarkPlugins={[remarkGfm, createCitationRemarkPlugin(citations)]}
					components={{
						a: ({ children, ...props }) => (
							<a
								{...props}
								className="font-medium text-[var(--lagoon-deep)] underline decoration-[rgba(50,143,151,0.35)] underline-offset-4 transition hover:text-[var(--palm)]"
								rel="noreferrer"
								target="_blank"
							>
								{children}
							</a>
						),
						code: ({ children, className, ...props }) => (
							<code
								{...props}
								className={cn(
									"rounded-md bg-[rgba(255,255,255,0.72)] px-1.5 py-0.5 font-mono text-[0.84em] text-[var(--sea-ink)]",
									className,
								)}
							>
								{children}
							</code>
						),
						li: ({ children }) => (
							<li className="mt-1 text-[0.95rem] leading-7 text-[var(--sea-ink)]">
								{children}
							</li>
						),
						ol: ({ children }) => (
							<MarkdownList ordered>{children}</MarkdownList>
						),
						p: ({ children }) => (
							<MarkdownParagraph>{children}</MarkdownParagraph>
						),
						pre: ({ children, ...props }: ComponentPropsWithoutRef<"pre">) => (
							<pre
								{...props}
								className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,0.66)] p-3 text-sm leading-6 text-[var(--sea-ink)]"
							>
								{children}
							</pre>
						),
						span: ({ children, ...props }) => {
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
						strong: ({ children }) => (
							<strong className="font-semibold text-[var(--sea-ink)]">
								{children}
							</strong>
						),
						ul: ({ children }) => <MarkdownList>{children}</MarkdownList>,
					}}
				>
					{renderedText}
				</ReactMarkdown>
			</div>

			{isStreaming ? (
				<span className="inline-block h-4 w-px translate-y-1 bg-[var(--sea-ink-soft)] align-baseline animate-pulse" />
			) : null}
		</div>
	);
}
