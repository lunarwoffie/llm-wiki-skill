import { HtmlRenderer } from "@/components/renderers/HtmlRenderer";
import type { ArtifactManifest } from "@/lib/api";

interface Props {
	manifest: ArtifactManifest;
}

export function ArtifactView({ manifest }: Props) {
	if (manifest.renderer === "iframe") {
		return <HtmlRenderer manifest={manifest} />;
	}

	return (
		<div className="rounded-md border border-input bg-muted/30 p-4 text-sm">
			<div className="font-medium">{manifest.metadata.title}</div>
			<div className="mt-2 space-y-1 text-xs text-muted-foreground">
				<div>类型：{manifest.kind}</div>
				<div>渲染器：{manifest.renderer}</div>
				<div>主文件：{manifest.primaryFile}</div>
			</div>
		</div>
	);
}
