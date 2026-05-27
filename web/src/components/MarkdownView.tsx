import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
	content: string;
	onOpenPage?: (path: string) => void;
}

function normalizeWikiLinks(content: string): string {
	return content.replace(/\[\[(wiki\/[^\]\n]+)\]\]/g, (_match, target: string) => `[${target}](${target})`);
}

export function MarkdownView({ content, onOpenPage }: Props) {
	return (
		<div className="prose prose-invert max-w-none prose-pre:bg-background prose-pre:text-foreground prose-code:text-foreground">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					a: ({ href, children }) => {
						if (href?.startsWith("wiki/")) {
							return (
								<a
									href={href}
									onClick={(e) => {
										e.preventDefault();
										onOpenPage?.(href);
									}}
									className="cursor-pointer underline decoration-primary underline-offset-4"
								>
									{children}
								</a>
							);
						}
						return (
							<a href={href} target="_blank" rel="noopener noreferrer">
								{children}
							</a>
						);
					},
				}}
			>
				{normalizeWikiLinks(content)}
			</ReactMarkdown>
		</div>
	);
}
