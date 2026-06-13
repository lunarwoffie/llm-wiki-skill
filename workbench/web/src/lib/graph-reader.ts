import type { GraphOpenPagePayload } from "@llm-wiki/graph-engine";

export type GraphReaderActionId = "quote_page" | "find_related_pages";

export interface GraphReaderAction {
	id: GraphReaderActionId;
	label: string;
}

export function graphReaderMetaItems(payload: GraphOpenPagePayload): string[] {
	const items = [payload.node.typeLabel];
	if (payload.node.date) items.push(payload.node.date);
	if (payload.node.source) items.push(payload.node.source);
	if (payload.node.type === "source" && payload.node.sourcePath) items.push(payload.node.sourcePath);
	return items;
}

export function graphReaderActions(): GraphReaderAction[] {
	return [
		{ id: "quote_page", label: "在对话中引用" },
		{ id: "find_related_pages", label: "它和谁有关" },
	];
}

export function graphReaderActionLabels(payload: GraphOpenPagePayload): string[] {
	void payload;
	return graphReaderActions().map((action) => action.label);
}
