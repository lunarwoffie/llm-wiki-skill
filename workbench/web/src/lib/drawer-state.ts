import type { GraphOpenPagePayload } from "@llm-wiki/graph-engine";
import type { ArtifactManifest } from "@/lib/api";

interface PageState {
	content?: string;
	loading?: boolean;
	error?: string | null;
}

export type DrawerState =
	| { mode: "closed" }
	| {
			mode: "wiki";
			path: string | null;
			content: string;
			loading: boolean;
			error: string | null;
		}
	| {
			mode: "artifacts";
			artifacts: ArtifactManifest[];
			activeArtifactId: string | null;
		}
	| {
			mode: "graph-reader";
			payload: GraphOpenPagePayload;
			content: string;
			loading: boolean;
			error: string | null;
		}
	| { mode: "graph-selection" };

export function closedDrawer(): DrawerState {
	return { mode: "closed" };
}

export function wikiDrawer(path: string | null, state: PageState = {}): DrawerState {
	return {
		mode: "wiki",
		path,
		content: state.content ?? "",
		loading: state.loading ?? false,
		error: state.error ?? null,
	};
}

export function artifactDrawer(artifacts: ArtifactManifest[], activeArtifactId: string | null): DrawerState {
	return { mode: "artifacts", artifacts, activeArtifactId };
}

export function graphReaderDrawer(payload: GraphOpenPagePayload, state: PageState = {}): DrawerState {
	return {
		mode: "graph-reader",
		payload,
		content: state.content ?? "",
		loading: state.loading ?? false,
		error: state.error ?? null,
	};
}
