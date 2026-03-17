// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { processChatCompletionStream } from '../streaming/completion-stream';
import { MarkdownText } from '../components/message/markdown-text';
import { formatSseEvent } from '../streaming/sse-parser';
import {
	createEmptyConversationDomain,
	reduceConversationDomain,
	type ConversationAction,
} from '../store/conversation-reducer';
import {
	createInitialConversationRuntimeState,
	type ConversationRuntimeState,
} from '../store/conversation-runtime';
import { selectCurrentBranchMessages } from '../store/conversation-selectors';
import type { ChatCitation } from '../models/message';
import type { ChatCompletionSseEvent } from '../models/events';

function createStreamingResponse(events: ChatCompletionSseEvent[]) {
	const encoder = new TextEncoder();
	const payload = events
		.map((event) => formatSseEvent(event.type, event))
		.join("");

	return new Response(
		new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(payload));
				controller.close();
			},
		}),
	);
}

describe("citation streaming", () => {
	it("tracks citation offsets for a text block", async () => {
		const actions: ConversationAction[] = [];

		const citation: Omit<ChatCitation, "end_index" | "start_index"> = {
			metadata: {
				favicon_url:
					"https://www.google.com/s2/favicons?sz=64&domain=apidog.com",
				site_domain: "apidog.com",
				site_name: "Apidog",
				type: "webpage_metadata",
			},
			origin_tool_name: "web_search",
			sources: [
				{
					icon_url:
						"https://www.google.com/s2/favicons?sz=64&domain=apidog.com",
					source: "Apidog",
					title: "How Affordable Is GPT-5 Codex Pricing for Developers in 2026",
					url: "https://apidog.com/blog/codex-pricing/",
					uuid: "citation-source-1",
				},
			],
			title: "How Affordable Is GPT-5 Codex Pricing for Developers in 2026",
			url: "https://apidog.com/blog/codex-pricing/",
			uuid: "citation-1",
		};

		await processChatCompletionStream({
			dispatch(action) {
				actions.push(action);
			},
			response: createStreamingResponse([
				{
					message: {
						content: [],
						id: "chatcompl_1",
						model: "claude-sonnet-4-6",
						parent_uuid: "user-1",
						role: "assistant",
						stop_reason: null,
						stop_sequence: null,
						type: "message",
						uuid: "assistant-1",
					},
					type: "message_start",
				},
				{
					content_block: {
						citations: [],
						flags: null,
						start_timestamp: "2026-03-11T12:00:00.000Z",
						stop_timestamp: null,
						text: "",
						type: "text",
					},
					index: 0,
					type: "content_block_start",
				},
				{
					delta: {
						text: "Prefix ",
						type: "text_delta",
					},
					index: 0,
					type: "content_block_delta",
				},
				{
					delta: {
						citation,
						type: "citation_start_delta",
					},
					index: 0,
					type: "content_block_delta",
				},
				{
					delta: {
						text: "quoted text",
						type: "text_delta",
					},
					index: 0,
					type: "content_block_delta",
				},
				{
					delta: {
						citation_uuid: citation.uuid,
						type: "citation_end_delta",
					},
					index: 0,
					type: "content_block_delta",
				},
				{
					delta: {
						text: " tail",
						type: "text_delta",
					},
					index: 0,
					type: "content_block_delta",
				},
				{
					index: 0,
					stop_timestamp: "2026-03-11T12:00:02.000Z",
					type: "content_block_stop",
				},
				{
					delta: {
						stop_reason: "end_turn",
						stop_sequence: null,
					},
					type: "message_delta",
				},
				{
					type: "message_stop",
				},
			]),
		});

		const initialRuntime = createInitialConversationRuntimeState();
		const reducedState = actions.reduce(
			(state, action) =>
				reduceConversationDomain(state.domain, state.runtime, action),
			{
				domain: createEmptyConversationDomain(
					'conversation-1',
					'2026-03-11T12:00:00.000Z',
				),
				runtime: {
					active_child_uuid_by_parent_uuid:
						initialRuntime.active_child_uuid_by_parent_uuid,
					next_message_index: initialRuntime.next_message_index,
				},
			},
		);
		const finalState = {
			domain: reducedState.domain,
			runtime: {
				...initialRuntime,
				...reducedState.runtime,
			} satisfies ConversationRuntimeState,
		};
		const [message] = selectCurrentBranchMessages(finalState);
		const textBlock = message?.content[0];

		expect(textBlock).toMatchObject({
			text: "Prefix quoted text tail",
			type: "text",
		});

		if (!textBlock || textBlock.type !== "text") {
			throw new Error("Expected a text block.");
		}

		expect(textBlock.citations).toEqual([
			{
				...citation,
				end_index: 18,
				start_index: 7,
			},
		]);
	});
});

describe("citation markdown rendering", () => {
	it("renders a citation pill after emphasized markdown text", () => {
		render(
			<MarkdownText
				citations={[
					{
						end_index: 6,
						metadata: {
							favicon_url:
								"https://www.google.com/s2/favicons?sz=64&domain=apidog.com",
							site_domain: "apidog.com",
							site_name: "Apidog",
							type: "webpage_metadata",
						},
						origin_tool_name: "web_search",
						sources: [
							{
								icon_url:
									"https://www.google.com/s2/favicons?sz=64&domain=apidog.com",
								source: "Apidog",
								title:
									"How Affordable Is GPT-5 Codex Pricing for Developers in 2026",
								url: "https://apidog.com/blog/codex-pricing/",
								uuid: "citation-source-1",
							},
						],
						start_index: 0,
						title:
							"How Affordable Is GPT-5 Codex Pricing for Developers in 2026",
						url: "https://apidog.com/blog/codex-pricing/",
						uuid: "citation-1",
					},
				]}
				text="**额度**"
			/>,
		);

		expect(screen.getByText("额度")).toBeTruthy();

		const citationLink = screen.getByRole("link", {
			name: /Apidog/i,
		});

		expect(citationLink.getAttribute("href")).toBe(
			"https://apidog.com/blog/codex-pricing/",
		);
	});

	it("renders unordered list items after a cited paragraph", () => {
		render(
			<MarkdownText
				citations={[
					{
						end_index: 4,
						metadata: {
							favicon_url:
								"https://www.google.com/s2/favicons?sz=64&domain=apidog.com",
							site_domain: "apidog.com",
							site_name: "Apidog",
							type: "webpage_metadata",
						},
						origin_tool_name: "web_search",
						sources: [
							{
								icon_url:
									"https://www.google.com/s2/favicons?sz=64&domain=apidog.com",
								source: "Apidog",
								title:
									"How Affordable Is GPT-5 Codex Pricing for Developers in 2026",
								url: "https://apidog.com/blog/codex-pricing/",
								uuid: "citation-source-1",
							},
						],
						start_index: 0,
						title:
							"How Affordable Is GPT-5 Codex Pricing for Developers in 2026",
						url: "https://apidog.com/blog/codex-pricing/",
						uuid: "citation-1",
					},
				]}
				text={"引用文本。\n\n- first item\n- second item\n- third item"}
			/>,
		);

		expect(screen.getByText("first item")).toBeTruthy();
		expect(screen.getByText("second item")).toBeTruthy();
		expect(screen.getByText("third item")).toBeTruthy();
	});
});
