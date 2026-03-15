import { createFileRoute } from "@tanstack/react-router";
import {
	getHistory,
	isCompleted,
	subscribeToMessage,
} from "#/features/chat/server/events/event-bus";
import { reconstructMessageSnapshot } from "#/features/chat/server/utils/snapshot";

export const Route = createFileRoute(
	"/api/chat_conversations/$conversationId/resume",
)({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);
				const messageId = url.searchParams.get("message_id");

				if (!messageId) {
					return Response.json(
						{ error: "message_id is required" },
						{ status: 400 },
					);
				}

				const encoder = new TextEncoder();

				return new Response(
					new ReadableStream({
						start(controller) {
							let closed = false;
							let isSnapshotSent = false;

							const close = () => {
								if (closed) return;
								closed = true;
								try {
									controller.close();
								} catch (_e) {}
							};

							const enqueue = (chunk: string) => {
								if (closed || request.signal.aborted) return false;
								controller.enqueue(encoder.encode(chunk));
								return true;
							};

							// 1. Subscribe FIRST to catch any events that occur while we are generating the snapshot.
							// This prevents a "race condition" where an event happens between getHistory() and subscribe().
							const unsubscribe = subscribeToMessage(messageId, (eventStr) => {
								// Only forward new events if the snapshot has already been sent.
								// Events received before this flag is true are guaranteed to be in the history
								// (because publishEvent is synchronous: push to history -> notify subscribers),
								// so they are already included in the snapshot we generate below.
								if (isSnapshotSent) {
									if (!enqueue(eventStr)) return;

									if (eventStr.includes("event: message_stop")) {
										enqueue(
											`event: close\ndata: ${JSON.stringify({
												click_behavior: "none",
												auto_resume: false,
												click_action: "none"
											})}\n\n`,
										);
										close();
										unsubscribe();
									}
								}
							});

							// Handle disconnect
							request.signal.addEventListener("abort", () => {
								unsubscribe();
								close();
							});

							// 2. Send ready event
							enqueue(
								`event: ready\ndata: ${JSON.stringify({
									request_message_id: messageId,
									response_message_id: messageId,
								})}\n\n`,
							);

							// 3. Send Snapshot
							const history = getHistory(messageId);
							const snapshot = reconstructMessageSnapshot(history);
							
							if (snapshot) {
								enqueue(
									`event: message_snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`
								);
							}

							// 4. Enable pass-through for the subscriber
							isSnapshotSent = true;

							// 5. If already finished, ensure we send stop and close.
							// Note: If the stream finished *after* we subscribed but *before* this check,
							// the subscriber callback above would have already handled the stop event (if isSnapshotSent was true).
							// If it finished *before* we subscribed, isCompleted is true, and we need to manually send the stop.
							if (isCompleted(messageId)) {
								// Check if we already closed (via subscriber)
								if (!closed) {
									enqueue(
										`event: message_stop\ndata: ${JSON.stringify({
											type: "message_stop",
										})}\n\n`
									);
									
									enqueue(
										`event: close\ndata: ${JSON.stringify({
											click_behavior: "none",
											auto_resume: false,
										})}\n\n`,
									);
									close();
									unsubscribe();
								}
								return;
							}
						},
					}),
					{
						headers: {
							"Cache-Control": "no-cache, no-transform",
							"Content-Type": "text/event-stream",
						},
					},
				);
			},
		},
	},
});
