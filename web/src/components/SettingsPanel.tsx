import { CheckCircle2, KeyRound, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	type AuthStatus,
	getAuthStatus,
	getConfig,
	listCommands,
	setAuthKey,
	setConfig,
	testAuthConnection,
} from "@/lib/api";

const PROVIDERS = [
	{ id: "anthropic", label: "Anthropic" },
	{ id: "openai", label: "OpenAI" },
	{ id: "deepseek", label: "DeepSeek" },
];

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function SettingsPanel({ open, onOpenChange }: Props) {
	const [status, setStatus] = useState<AuthStatus | null>(null);
	const [provider, setProvider] = useState("anthropic");
	const [key, setKey] = useState("");
	const [loading, setLoading] = useState(false);
	const [showUserGlobalSkills, setShowUserGlobalSkills] = useState(false);
	const [skillCounts, setSkillCounts] = useState({ builtin: 0, piDefault: 0, userGlobal: 0 });
	const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

	const refresh = async () => {
		const [auth, config, allCommands] = await Promise.all([
			getAuthStatus(),
			getConfig(),
			listCommands(true),
		]);
		setStatus(auth);
		setShowUserGlobalSkills(config.showUserGlobalSkills === true);
		setSkillCounts({
			builtin: allCommands.filter((item) => item.source === "builtin" && item.skillPath).length,
			piDefault: allCommands.filter((item) => item.source === "pi-default").length,
			userGlobal: allCommands.filter((item) => item.source === "user-global").length,
		});
	};

	useEffect(() => {
		if (!open) return;
		refresh().catch((err) =>
			setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) }),
		);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onOpenChange(false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onOpenChange, open]);

	const saveAndTest = async () => {
		if (!key.trim()) return;
		setLoading(true);
		setMessage(null);
		try {
			await setAuthKey(provider, key);
			setKey("");
			await refresh();
			const result = await testAuthConnection(provider);
			setMessage({
				type: result.ok ? "success" : "error",
				text: result.message ?? result.error ?? "测试完成",
			});
		} catch (err) {
			setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
		} finally {
			setLoading(false);
		}
	};

	const toggleUserGlobalSkills = async (checked: boolean) => {
		setShowUserGlobalSkills(checked);
		try {
			await setConfig({ showUserGlobalSkills: checked });
			window.dispatchEvent(new Event("llm-wiki-agent:commands-changed"));
		} catch (err) {
			setShowUserGlobalSkills(!checked);
			setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl" showCloseButton={false}>
				<DialogHeader className="flex-row items-start justify-between gap-4 space-y-0">
					<div>
						<DialogTitle>设置</DialogTitle>
						<DialogDescription>认证</DialogDescription>
					</div>
					<Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="关闭">
						<XCircle className="size-4" />
					</Button>
				</DialogHeader>

				<div className="space-y-5">
					<section className="space-y-2 rounded-md border border-input p-3">
						<div className="flex items-center gap-2 text-sm font-medium">
							<KeyRound className="size-4" />
							登录方式状态
						</div>
						<div className="text-xs text-muted-foreground">
							auth.json：{status?.authFileExists ? "已存在" : "未创建"}
						</div>
						<div className="flex flex-wrap gap-2">
							{status?.providers.length ? (
								status.providers.map((item) => (
									<span
										key={item.id}
										className="rounded-md border border-input bg-muted px-2 py-1 text-xs"
									>
										{item.id}：已配置
									</span>
								))
							) : (
								<span className="text-xs text-muted-foreground">暂无已保存 provider</span>
							)}
						</div>
					</section>

					<section className="space-y-3 rounded-md border border-input p-3">
						<div className="text-sm font-medium">添加 API key</div>
						<div className="grid gap-2 sm:grid-cols-[160px_1fr]">
							<select
								value={provider}
								onChange={(e) => setProvider(e.target.value)}
								className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								{PROVIDERS.map((item) => (
									<option key={item.id} value={item.id}>
										{item.label}
									</option>
								))}
							</select>
							<Input
								type="password"
								value={key}
								onChange={(e) => setKey(e.target.value)}
								autoComplete="off"
								placeholder="API key"
							/>
						</div>
						<div className="flex items-center justify-between gap-3">
							{message ? (
								<div
									className={`flex items-center gap-2 text-sm ${
										message.type === "success" ? "text-emerald-400" : "text-destructive"
									}`}
								>
									{message.type === "success" ? (
										<CheckCircle2 className="size-4" />
									) : (
										<XCircle className="size-4" />
									)}
									<span className="break-all">{message.text}</span>
								</div>
							) : (
								<span className="text-xs text-muted-foreground">保存后会立即测试</span>
							)}
							<Button onClick={saveAndTest} disabled={loading || !key.trim()}>
								{loading && <Loader2 className="size-4 animate-spin" />}
								保存并测试
							</Button>
						</div>
					</section>

					<section className="space-y-2 rounded-md border border-input p-3">
						<div className="text-sm font-medium">环境变量</div>
						<div className="grid gap-2 sm:grid-cols-2">
							{status?.envKeys.map((item) => (
								<div
									key={item.name}
									className="flex items-center justify-between rounded-md bg-muted px-2 py-1 text-xs"
								>
									<span>{item.name}</span>
									<span className={item.present ? "text-emerald-400" : "text-muted-foreground"}>
										{item.present ? "存在" : "未设置"}
									</span>
								</div>
							))}
						</div>
					</section>

					<section className="space-y-3 rounded-md border border-input p-3">
						<div>
							<div className="text-sm font-medium">Skill 加载</div>
							<div className="mt-1 text-xs text-muted-foreground">
								项目内置 {skillCounts.builtin} 个 / pi 默认 {skillCounts.piDefault} 个 / 用户全局{" "}
								{skillCounts.userGlobal} 个
							</div>
						</div>
						<label className="flex items-center justify-between gap-4 rounded-md bg-muted px-3 py-2 text-sm">
							<span>
								<span className="block">展示用户全局 Skill</span>
								<span className="text-xs text-muted-foreground">~/.claude/skills/</span>
							</span>
							<input
								type="checkbox"
								checked={showUserGlobalSkills}
								onChange={(e) => toggleUserGlobalSkills(e.target.checked)}
								className="size-4 accent-primary"
							/>
						</label>
					</section>
				</div>
			</DialogContent>
		</Dialog>
	);
}
