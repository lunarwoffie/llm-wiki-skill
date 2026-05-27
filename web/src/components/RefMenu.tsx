import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import type { PageRef } from "@/lib/api";

interface Props {
	open: boolean;
	query: string;
	items: PageRef[];
	selectedIndex: number;
	onSelect: (item: PageRef) => void;
}

export function RefMenu({ open, query, items, selectedIndex, onSelect }: Props) {
	if (!open) return null;
	return (
		<div className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-xl rounded-md border border-input bg-popover shadow-lg">
			<Command shouldFilter={false}>
				<CommandInput value={query} readOnly placeholder="筛选页面" />
				<CommandList>
					<CommandEmpty>没有匹配页面</CommandEmpty>
					<CommandGroup heading="@ 引用">
						{items.map((item, index) => (
							<CommandItem
								key={item.path}
								value={item.path}
								onMouseDown={(e) => e.preventDefault()}
								onSelect={() => onSelect(item)}
								className={index === selectedIndex ? "bg-accent text-accent-foreground" : undefined}
							>
								<div className="min-w-24 text-xs text-muted-foreground">{item.category}</div>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm">{item.title}</div>
									<div className="truncate font-mono text-xs text-muted-foreground">{item.path}</div>
								</div>
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
			</Command>
		</div>
	);
}
