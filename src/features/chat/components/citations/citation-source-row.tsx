import { Globe } from "lucide-react";

import type { ChatCitation, ChatCitationSource } from "../../types";
import {
	getCitationSourceIcon,
	getCitationSourceLabel,
} from "./citation-utils";

interface CitationSourceRowProps {
	citation: ChatCitation;
	source: ChatCitationSource | null;
}

export function CitationSourceRow({
	citation,
	source,
}: CitationSourceRowProps) {
	const label = source?.source ?? getCitationSourceLabel(citation);
	const iconUrl = source?.icon_url ?? getCitationSourceIcon(citation);

	return (
		<span className="flex items-center gap-2 text-xs text-[var(--sea-ink-soft)]">
			{iconUrl ? (
				<img
					alt=""
					className="size-4 rounded-sm"
					height={16}
					loading="lazy"
					src={iconUrl}
					width={16}
				/>
			) : (
				<span className="inline-flex size-4 items-center justify-center rounded-sm bg-[rgba(79,184,178,0.12)] text-[var(--lagoon-deep)]">
					<Globe className="size-3" />
				</span>
			)}
			<span className="truncate">{label}</span>
		</span>
	);
}
