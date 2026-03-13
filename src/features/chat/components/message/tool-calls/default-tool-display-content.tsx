import { formatJson, hasDisplayContent } from "./tool-call-utils";

interface DefaultToolDisplayContentProps {
	value: unknown;
}

export function DefaultToolDisplayContent({
	value,
}: DefaultToolDisplayContentProps) {
	if (!hasDisplayContent(value)) {
		return null;
	}

	if (typeof value === "string") {
		return (
			<p className="whitespace-pre-wrap text-sm leading-6 text-[var(--sea-ink)]">
				{value}
			</p>
		);
	}

	return (
		<pre className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.66)] p-3 text-xs leading-6 text-[var(--sea-ink)]">
			{formatJson(value)}
		</pre>
	);
}
