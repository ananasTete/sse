import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "#/lib/utils";

import { ToolIcon } from "./tool-icon";

interface ToolCallLayoutProps {
	children?: ReactNode;
	expanded: boolean;
	hasDetails: boolean;
	iconName: string | null;
	isError: boolean;
	isStreaming: boolean;
	label: string;
	onToggle: () => void;
	summary: string;
}

export function ToolCallLayout({
	children,
	expanded,
	hasDetails,
	iconName,
	isError,
	isStreaming,
	label,
	onToggle,
	summary,
}: ToolCallLayoutProps) {
	const headerClassName = cn(
		"flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition",
		hasDetails && "hover:bg-[rgba(255,255,255,0.64)]",
		isError && "bg-[rgba(254,242,242,0.88)] text-[rgb(153,27,27)]",
	);

	const content = (
		<>
			<span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--lagoon-deep)]">
				<ToolIcon iconName={iconName} />
			</span>

			<span className="min-w-0 flex-1 truncate text-sm text-[var(--sea-ink)]">
				<span
					className={cn(
						"inline truncate font-medium",
						isStreaming && "tool-shimmer-text",
					)}
				>
					{label}
				</span>
				<span className="mx-2 text-[var(--sea-ink-soft)]">·</span>
				<span className="truncate text-[var(--sea-ink-soft)]">{summary}</span>
			</span>

			{hasDetails ? (
				<ChevronRight
					className={cn(
						"size-4 shrink-0 text-[var(--sea-ink-soft)] transition-transform",
						expanded && "rotate-90",
					)}
				/>
			) : null}
		</>
	);

	return (
		<div className="space-y-2">
			{hasDetails ? (
				<button className={headerClassName} onClick={onToggle} type="button">
					{content}
				</button>
			) : (
				<div className={headerClassName}>{content}</div>
			)}

			{hasDetails && expanded ? (
				<div className="rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,0.44)] p-3">
					{children}
				</div>
			) : null}
		</div>
	);
}
