import type { GraphOpenPagePayload } from "@llm-wiki/graph-engine";

export function graphReaderMetaItems(payload: GraphOpenPagePayload): string[] {
	const items = [payload.node.typeLabel];
	if (payload.node.date) items.push(payload.node.date);
	if (payload.node.source) items.push(payload.node.source);
	if (payload.node.type === "source" && payload.node.sourcePath) items.push(payload.node.sourcePath);
	return items;
}

export function graphReaderActionLabels(_payload: GraphOpenPagePayload): string[] {
	return ["在对话中引用", "它和谁有关"];
}
