import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { emitWikiLinkSeen, extractWikiPageRefs, normalizeWikiLinks } from "@/lib/wiki-links";

interface Props {
	content: string;
	onOpenPage?: (path: string) => void;
	onWikiLinkSeen?: (path: string) => void;
}

export function MarkdownView({ content, onOpenPage, onWikiLinkSeen }: Props) {
	useEffect(() => {
		if (!onWikiLinkSeen) return;
		for (const path of extractWikiPageRefs(content)) {
			onWikiLinkSeen(path);
			emitWikiLinkSeen(path);
		}
	}, [content, onWikiLinkSeen]);

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
										onWikiLinkSeen?.(href);
										emitWikiLinkSeen(href);
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
