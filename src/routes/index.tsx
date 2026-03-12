import { createFileRoute } from "@tanstack/react-router";
import {
	ArrowUp,
	Check,
	ChevronLeft,
	ChevronRight,
	Pencil,
	RotateCcw,
	Square,
	X,
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { MessageContent } from "#/features/chat/components/message-content";
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "#/features/chat/constants";
import type { ChatContent } from "#/features/chat/types";
import { useChat } from "#/features/chat/use-chat";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/")({ component: App });

function getMessageText(text: string) {
	return text.trim() || " ";
}

function getTextContent(blocks: ChatContent[]) {
	return blocks
		.filter(
			(block): block is Extract<ChatContent, { type: "text" }> =>
				block.type === "text",
		)
		.map((block) => block.text)
		.join("");
}

function App() {
	const {
		editUserMessage,
		getBranchState,
		input,
		messages,
		onInputChange,
		regenerate,
		regenerateUserMessage,
		selectBranch,
		sendMessage,
		status,
		stop,
	} = useChat();
	const [editingMessageUuid, setEditingMessageUuid] = useState<string | null>(
		null,
	);
	const [editingPrompt, setEditingPrompt] = useState("");
	const [expandedToolBlocks, setExpandedToolBlocks] = useState<
		Record<string, boolean>
	>({});
	const [feedback, setFeedback] = useState<string | null>(null);
	const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const isBusy = status === "streaming" || status === "submitted";
	const lastMessageUpdatedAt =
		messages[messages.length - 1]?.updated_at ?? null;
	const statusLabel =
		status === "submitted"
			? "waiting"
			: status === "streaming"
				? "streaming"
				: status === "error"
					? "error"
					: "ready";

	useEffect(() => {
		if (!lastMessageUpdatedAt && status === "ready") {
			return;
		}

		const container = transcriptRef.current;

		if (!container) {
			return;
		}

		container.scrollTo({
			behavior: "smooth",
			top: container.scrollHeight,
		});
	}, [lastMessageUpdatedAt, status]);

	useEffect(() => {
		if (!editingMessageUuid) {
			return;
		}

		const hasEditingMessage = messages.some(
			(message) => message.uuid === editingMessageUuid,
		);

		if (!hasEditingMessage) {
			setEditingMessageUuid(null);
			setEditingPrompt("");
		}
	}, [editingMessageUuid, messages]);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setFeedback(null);

		try {
			await sendMessage({
				model: selectedModel,
				prompt: input,
			});
		} catch (error) {
			setFeedback(
				error instanceof Error ? error.message : "Chat request failed.",
			);
		}
	};

	const handleStop = () => {
		setFeedback(null);
		stop();
	};

	const handleRegenerate = async (assistantMessageUuid: string) => {
		setFeedback(null);

		try {
			await regenerate(assistantMessageUuid);
		} catch (error) {
			setFeedback(
				error instanceof Error ? error.message : "Chat request failed.",
			);
		}
	};

	const handleRegenerateUserMessage = async (userMessageUuid: string) => {
		setFeedback(null);

		try {
			await regenerateUserMessage(userMessageUuid);
		} catch (error) {
			setFeedback(
				error instanceof Error ? error.message : "Chat request failed.",
			);
		}
	};

	const handleBranchSelect = (assistantMessageUuid: string) => {
		setFeedback(null);

		try {
			selectBranch(assistantMessageUuid);
		} catch (error) {
			setFeedback(
				error instanceof Error ? error.message : "Branch selection failed.",
			);
		}
	};

	const handleStartEdit = (messageUuid: string, prompt: string) => {
		setFeedback(null);
		setEditingMessageUuid(messageUuid);
		setEditingPrompt(prompt);
	};

	const handleCancelEdit = () => {
		setEditingMessageUuid(null);
		setEditingPrompt("");
	};

	const handleConfirmEdit = async (message: (typeof messages)[number]) => {
		setFeedback(null);

		try {
			await editUserMessage(message.uuid, {
				model: selectedModel,
				prompt: editingPrompt,
			});
			setEditingMessageUuid(null);
			setEditingPrompt("");
		} catch (error) {
			setFeedback(
				error instanceof Error ? error.message : "Chat request failed.",
			);
		}
	};

	const handleToggleToolBlock = (toolUseId: string) => {
		setExpandedToolBlocks((current) => ({
			...current,
			[toolUseId]: !(current[toolUseId] ?? false),
		}));
	};

	return (
		<main className="h-screen overflow-hidden bg-[var(--bg-base)] text-[var(--sea-ink)]">
			<div className="mx-auto flex h-full max-w-4xl flex-col px-4 py-4">
				<header className="flex items-center justify-between border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-sm">
					<div className="flex items-center gap-3">
						<span className="font-semibold">Chat</span>
						<span className="text-[var(--sea-ink-soft)]">
							{messages.length} messages
						</span>
					</div>
					<span className="font-medium text-[var(--sea-ink-soft)]">
						{statusLabel}
					</span>
				</header>

				<section className="flex min-h-0 flex-1 flex-col overflow-hidden border border-t-0 border-[var(--line)] bg-[var(--surface)]">
					<div
						className="flex-1 space-y-4 overflow-y-auto px-3 py-3"
						ref={transcriptRef}
					>
						{messages.length ? (
							messages.map((message, index) => {
								const rawText = getTextContent(message.content);
								const text = getMessageText(rawText);
								const isUser = message.role === "user";
								const isAssistant = message.role === "assistant";
								const isEditingUserMessage =
									isUser && editingMessageUuid === message.uuid;
								const branchChildUuids =
									isAssistant || isUser
										? getBranchState(message.parent_message_uuid)
										: [];
								const branchIndex = branchChildUuids.indexOf(message.uuid);
								const previousBranchUuid =
									branchIndex > 0 ? branchChildUuids[branchIndex - 1] : null;
								const nextBranchUuid =
									branchIndex >= 0 && branchIndex < branchChildUuids.length - 1
										? branchChildUuids[branchIndex + 1]
										: null;
								const isStreamingMessage =
									isAssistant &&
									isBusy &&
									index === messages.length - 1 &&
									message.stop_reason === null;

								return (
									<article
										className={cn(
											"flex w-full",
											isAssistant ? "justify-start" : "justify-end",
										)}
										key={message.uuid}
									>
										<div
											className={cn(
												"border px-4 py-3",
												isEditingUserMessage
													? "w-full"
													: "max-w-[min(42rem,92%)]",
												isAssistant
													? "border-[var(--line)] bg-[var(--surface-strong)]"
													: "border-[var(--line)] bg-[rgba(47,106,74,0.08)]",
											)}
										>
											{isEditingUserMessage ? (
												<div>
													<textarea
														className="min-h-28 w-full resize-y border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[0.95rem] leading-7 text-[var(--sea-ink)] outline-none"
														onChange={(event) => {
															setEditingPrompt(event.target.value);
														}}
														value={editingPrompt}
													/>
												</div>
											) : isAssistant ? (
												<MessageContent
													blocks={message.content}
													expandedToolBlocks={expandedToolBlocks}
													isStreamingMessage={isStreamingMessage}
													onToggleToolBlock={handleToggleToolBlock}
												/>
											) : (
												<p className="whitespace-pre-wrap text-[0.95rem] leading-7 text-[var(--sea-ink)]">
													{text}
												</p>
											)}

											{isUser ? (
												<div className="mt-3 flex items-center gap-3 border-t border-[var(--line)] pt-3 text-[0.72rem] text-[var(--sea-ink-soft)]">
													{isEditingUserMessage ? (
														<>
															<button
																className="inline-flex items-center gap-1 transition hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-40"
																disabled={isBusy}
																onClick={handleCancelEdit}
																type="button"
															>
																<X className="size-3.5" />
																Cancel
															</button>

															<button
																className="inline-flex items-center gap-1 transition hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-40"
																disabled={isBusy || !editingPrompt.trim()}
																onClick={() => {
																	void handleConfirmEdit(message);
																}}
																type="button"
															>
																<Check className="size-3.5" />
																Confirm
															</button>
														</>
													) : (
														<>
															<button
																className="inline-flex items-center gap-1 transition hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-40"
																disabled={isBusy}
																onClick={() => {
																	handleStartEdit(message.uuid, rawText);
																}}
																type="button"
															>
																<Pencil className="size-3.5" />
																Edit
															</button>

															<button
																className="inline-flex items-center gap-1 transition hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-40"
																disabled={isBusy}
																onClick={() => {
																	void handleRegenerateUserMessage(
																		message.uuid,
																	);
																}}
																type="button"
															>
																<RotateCcw className="size-3.5" />
																Regenerate
															</button>
														</>
													)}

													{branchChildUuids.length > 1 ? (
														<div className="inline-flex items-center gap-1">
															<button
																className="inline-flex size-5 items-center justify-center border border-transparent transition hover:border-[var(--line)] hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-35"
																disabled={
																	!previousBranchUuid ||
																	isBusy ||
																	isEditingUserMessage
																}
																onClick={() => {
																	if (!previousBranchUuid) {
																		return;
																	}

																	handleBranchSelect(previousBranchUuid);
																}}
																type="button"
															>
																<ChevronLeft className="size-3.5" />
															</button>

															<span>
																{branchIndex + 1}/{branchChildUuids.length}
															</span>

															<button
																className="inline-flex size-5 items-center justify-center border border-transparent transition hover:border-[var(--line)] hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-35"
																disabled={
																	!nextBranchUuid ||
																	isBusy ||
																	isEditingUserMessage
																}
																onClick={() => {
																	if (!nextBranchUuid) {
																		return;
																	}

																	handleBranchSelect(nextBranchUuid);
																}}
																type="button"
															>
																<ChevronRight className="size-3.5" />
															</button>
														</div>
													) : null}
												</div>
											) : null}

											{isAssistant ? (
												<div className="mt-3 flex items-center gap-3 border-t border-[var(--line)] pt-3 text-[0.72rem] text-[var(--sea-ink-soft)]">
													<button
														className="inline-flex items-center gap-1 transition hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-40"
														disabled={isBusy}
														onClick={() => {
															void handleRegenerate(message.uuid);
														}}
														type="button"
													>
														<RotateCcw className="size-3.5" />
														Regenerate
													</button>

													{branchChildUuids.length > 1 ? (
														<div className="inline-flex items-center gap-1">
															<button
																className="inline-flex size-5 items-center justify-center border border-transparent transition hover:border-[var(--line)] hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-35"
																disabled={!previousBranchUuid || isBusy}
																onClick={() => {
																	if (!previousBranchUuid) {
																		return;
																	}

																	handleBranchSelect(previousBranchUuid);
																}}
																type="button"
															>
																<ChevronLeft className="size-3.5" />
															</button>

															<span>
																{branchIndex + 1}/{branchChildUuids.length}
															</span>

															<button
																className="inline-flex size-5 items-center justify-center border border-transparent transition hover:border-[var(--line)] hover:text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-35"
																disabled={!nextBranchUuid || isBusy}
																onClick={() => {
																	if (!nextBranchUuid) {
																		return;
																	}

																	handleBranchSelect(nextBranchUuid);
																}}
																type="button"
															>
																<ChevronRight className="size-3.5" />
															</button>
														</div>
													) : null}
												</div>
											) : null}
										</div>
									</article>
								);
							})
						) : (
							<div className="flex min-h-full items-center justify-center py-12 text-sm text-[var(--sea-ink-soft)]">
								No messages yet.
							</div>
						)}
					</div>

					<div className="border-t border-[var(--line)] bg-[var(--surface-strong)] p-3">
						<div className="border border-[var(--line)] bg-white/70 p-2 dark:bg-transparent">
							{/* TODO: Add file upload UI here. After each upload succeeds,
							fetch the uploaded file object immediately for preview, and merge
							that preview state into the pending user message. Submission should
							continue to call `sendMessage` with only `files: string[]` ids. */}
							<form className="space-y-3" onSubmit={handleSubmit}>
								<textarea
									className="min-h-24 w-full resize-none border border-transparent bg-transparent px-3 py-2 text-[0.95rem] leading-7 text-[var(--sea-ink)] outline-none placeholder:text-[var(--sea-ink-soft)]"
									onChange={onInputChange}
									placeholder="Type a message."
									value={input}
								/>

								<div className="flex flex-col gap-3 border-t border-[var(--line)] px-1 pt-3 sm:flex-row sm:items-end sm:justify-between">
									<div className="flex flex-col gap-2">
										<div className="flex flex-col gap-1.5">
											<span className="px-2 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--sea-ink-soft)]">
												Model
											</span>

											<Select
												disabled={isBusy}
												onValueChange={setSelectedModel}
												value={selectedModel}
											>
												<SelectTrigger className="h-10 min-w-64 border-[var(--line)] bg-[var(--surface)] text-[var(--sea-ink)] shadow-none">
													<SelectValue placeholder="Select a model" />
												</SelectTrigger>
												<SelectContent>
													{AVAILABLE_MODELS.map((model) => (
														<SelectItem key={model.value} value={model.value}>
															{model.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>

										{feedback ? (
											<div className="px-2 text-sm text-[rgb(153,27,27)]">
												{feedback}
											</div>
										) : isBusy ? (
											<div className="px-2 text-sm text-[var(--sea-ink-soft)]">
												Streaming response.
											</div>
										) : null}
									</div>

									<div className="flex items-center gap-2 self-end sm:self-auto">
										<button
											className="inline-flex h-10 items-center justify-center border border-[var(--line)] bg-transparent px-4 text-sm font-medium text-[var(--sea-ink)] transition hover:bg-white/50 disabled:cursor-not-allowed disabled:opacity-45"
											disabled={!isBusy}
											onClick={handleStop}
											type="button"
										>
											<Square className="mr-2 size-4 fill-current" />
											Stop
										</button>

										<button
											className="inline-flex h-10 items-center justify-center border border-[var(--sea-ink)] bg-[var(--sea-ink)] px-4 text-sm font-medium text-[var(--foam)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
											disabled={isBusy}
											type="submit"
										>
											<ArrowUp className="mr-2 size-4" />
											Send
										</button>
									</div>
								</div>
							</form>
						</div>
					</div>
				</section>
			</div>
		</main>
	);
}
