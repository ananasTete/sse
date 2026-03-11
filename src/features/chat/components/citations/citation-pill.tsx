import * as HoverCard from "@radix-ui/react-hover-card";
import { ExternalLink, Globe } from "lucide-react";

import type { ChatCitation } from "../../types";
import { CitationSourceRow } from "./citation-source-row";
import {
	getCitationHref,
	getCitationSourceIcon,
	getCitationSourceLabel,
} from "./citation-utils";

interface CitationPillProps {
	citation: ChatCitation;
}

export function CitationPill({ citation }: CitationPillProps) {
	const href = getCitationHref(citation);
	const title = citation.title ?? citation.sources[0]?.title ?? href;
	const source = citation.sources[0] ?? null;
	const sourceIcon = getCitationSourceIcon(citation);
	const sourceLabel = getCitationSourceLabel(citation);

	return (
		<HoverCard.Root closeDelay={180} openDelay={120}>
			<HoverCard.Trigger asChild>
				<a
					className="ml-1 inline-flex translate-y-[-0.02rem] items-center gap-1 whitespace-nowrap rounded-full border border-[rgba(79,184,178,0.26)] bg-[rgba(255,255,255,0.8)] px-2 py-0.5 align-baseline text-[0.62rem] font-semibold tracking-[0.03em] text-[var(--sea-ink)] shadow-[0_8px_18px_rgba(18,52,41,0.08)] transition hover:border-[rgba(79,184,178,0.46)] hover:bg-white focus-visible:border-[rgba(79,184,178,0.46)] focus-visible:bg-white"
					href={href}
					rel="noreferrer"
					target="_blank"
				>
					{sourceIcon ? (
						<img
							alt=""
							className="size-3 rounded-sm"
							height={12}
							loading="lazy"
							src={sourceIcon}
							width={12}
						/>
					) : (
						<Globe className="size-3 text-[var(--lagoon-deep)]" />
					)}
					<span>{sourceLabel}</span>
				</a>
			</HoverCard.Trigger>

			<HoverCard.Portal>
				<HoverCard.Content
					align="start"
					className="z-30 w-72 rounded-[1.1rem] border border-[var(--line)] bg-[var(--surface-strong)] p-3 text-left shadow-[0_24px_70px_rgba(18,52,41,0.2)] backdrop-blur-xl data-[side=top]:animate-in data-[side=top]:fade-in-0 data-[side=top]:slide-in-from-bottom-1"
					side="top"
					sideOffset={12}
				>
					<a
						className="block rounded-xl p-1 transition hover:bg-[rgba(255,255,255,0.52)] focus-visible:bg-[rgba(255,255,255,0.52)]"
						href={href}
						rel="noreferrer"
						target="_blank"
					>
						<span className="flex items-start justify-between gap-3">
							<span className="block text-sm font-semibold leading-5 text-[var(--sea-ink)]">
								{title}
							</span>
							<ExternalLink className="mt-0.5 size-3.5 shrink-0 text-[var(--sea-ink-soft)]" />
						</span>
						<span className="mt-2 block">
							<CitationSourceRow citation={citation} source={source} />
						</span>
					</a>
					<HoverCard.Arrow
						className="fill-[var(--surface-strong)]"
						height={10}
						width={18}
					/>
				</HoverCard.Content>
			</HoverCard.Portal>
		</HoverCard.Root>
	);
}
