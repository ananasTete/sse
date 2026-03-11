import { ExternalLink, Globe } from "lucide-react";

import { DefaultToolDisplayContent } from "./default-tool-display-content";
import { isKnowledgeList, isRecord } from "./tool-call-utils";

interface WebSearchToolDisplayContentProps {
	value: unknown;
}

export function WebSearchToolDisplayContent({
	value,
}: WebSearchToolDisplayContentProps) {
	if (isKnowledgeList(value)) {
		return (
			<div className="space-y-2">
				{value.map((item) => {
					const href = item.url ?? "#";
					const domain =
						item.metadata?.site_domain ??
						item.metadata?.site_name ??
						"Unknown source";
					const key = item.url ?? `${domain}-${item.title ?? "knowledge"}`;

					return (
						<a
							className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-3 transition hover:bg-[var(--link-bg-hover)]"
							href={href}
							key={key}
							rel="noreferrer"
							target="_blank"
						>
							{item.metadata?.favicon_url ? (
								<img
									alt=""
									className="mt-0.5 size-4 rounded-sm"
									height={16}
									loading="lazy"
									src={item.metadata.favicon_url}
									width={16}
								/>
							) : (
								<span className="mt-0.5 inline-flex size-4 items-center justify-center rounded-sm bg-[rgba(79,184,178,0.12)] text-[var(--lagoon-deep)]">
									<Globe className="size-3" />
								</span>
							)}

							<span className="min-w-0 flex-1">
								<span className="block text-sm font-medium leading-5 text-[var(--sea-ink)]">
									{item.title ?? "Untitled result"}
								</span>
								<span className="mt-1 block text-[0.72rem] uppercase tracking-[0.16em] text-[var(--sea-ink-soft)]">
									{domain}
								</span>
							</span>

							<ExternalLink className="mt-0.5 size-3.5 shrink-0 text-[var(--sea-ink-soft)]" />
						</a>
					);
				})}
			</div>
		);
	}

	if (
		isRecord(value) &&
		typeof value.preview_url === "string" &&
		value.preview_url.length > 0
	) {
		return (
			<a
				className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-xs font-medium text-[var(--sea-ink)] transition hover:bg-white"
				href={value.preview_url}
				rel="noreferrer"
				target="_blank"
			>
				<Globe className="size-3.5" />
				{value.preview_url}
			</a>
		);
	}

	return <DefaultToolDisplayContent value={value} />;
}
