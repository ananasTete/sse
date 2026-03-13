import { Globe } from "lucide-react";

interface ToolIconProps {
	iconName: string | null;
}

export function ToolIcon({ iconName }: ToolIconProps) {
	const iconClassName = "size-4";

	switch (iconName) {
		case "globe":
			return <Globe className={iconClassName} />;
		default:
			return <Globe className={iconClassName} />;
	}
}
