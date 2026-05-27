import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import type { CommandItem as CommandItemType } from "@/lib/api";

interface Props {
	open: boolean;
	query: string;
	items: CommandItemType[];
	selectedIndex: number;
	onSelect: (item: CommandItemType) => void;
}

function sourceLabel(source: string): string {
	return source === "builtin" ? "内置" : "Skill";
}

export function CommandMenu({ open, query, items, selectedIndex, onSelect }: Props) {
	if (!open) return null;

	const groups = [
		{ label: "内置", items: items.filter((item) => item.source === "builtin") },
		{ label: "Skill", items: items.filter((item) => item.source !== "builtin") },
	].filter((group) => group.items.length > 0);
	let index = -1;

	return (
		<div className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-xl rounded-md border border-input bg-popover shadow-lg">
			<Command shouldFilter={false}>
				<CommandInput value={query} readOnly placeholder="筛选命令" />
				<CommandList>
					<CommandEmpty>没有匹配命令</CommandEmpty>
					{groups.map((group) => (
						<CommandGroup key={group.label} heading={group.label}>
							{group.items.map((item) => {
								index += 1;
								const selected = index === selectedIndex;
								return (
									<CommandItem
										key={`${item.source}:${item.slug}`}
										value={item.slug}
										onMouseDown={(e) => e.preventDefault()}
										onSelect={() => onSelect(item)}
										className={selected ? "bg-accent text-accent-foreground" : undefined}
									>
										<div className="min-w-20 font-mono text-xs text-primary">{item.slug}</div>
										<div className="min-w-0 flex-1">
											<div className="truncate text-sm">{item.name}</div>
											<div className="text-xs text-muted-foreground">{item.description}</div>
										</div>
										<div className="shrink-0 text-[10px] text-muted-foreground">{sourceLabel(item.source)}</div>
									</CommandItem>
								);
							})}
						</CommandGroup>
					))}
				</CommandList>
			</Command>
		</div>
	);
}
