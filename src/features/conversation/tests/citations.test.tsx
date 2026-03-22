// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { produce } from 'immer';
import { processChatCompletionStream } from '../streaming/completion-stream';
import { formatSseEvent } from '../streaming/sse-parser';
import {
	createEmptyConversationDomain,
	applyConversationAction,
	type ConversationAction,
} from '../store/conversation-reducer';
import {
	createInitialConversationRuntimeState,
} from '../store/conversation-runtime';
import { getMessageByUuid, selectCurrentBranchMessageUuids } from '../store/conversation-selectors';
import type { ChatCitation } from '../models/message';
import type { ChatCompletionSseEvent } from '../models/events';
import { MarkdownText } from "#/features/chat/components";

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
						created_at: "2026-03-11T12:00:00.000Z",
						id: "chatcompl_1",
						model: "claude-sonnet-4-6",
						parent_uuid: "user-1",
						role: "assistant",
						stop_reason: null,
						stop_sequence: null,
						type: "message",
						updated_at: "2026-03-11T12:00:00.000Z",
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
					type: "message_update",
				},
				{
					type: "message_stop",
				},
			]),
		});

		const finalDomain = actions.reduce(
			(domain, action) => produce(domain, (draft) => {
				applyConversationAction(draft, action);
			}),
			createEmptyConversationDomain(
				'conversation-1',
				'2026-03-11T12:00:00.000Z',
			),
		);
		const finalState = {
			domain: finalDomain,
			runtime: createInitialConversationRuntimeState(),
		};
		const [firstUuid] = selectCurrentBranchMessageUuids(finalState);
		const message = getMessageByUuid(finalState, firstUuid);
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

	it("applies tool_use updates and message_update", async () => {
		const actions: ConversationAction[] = [];

		await processChatCompletionStream({
			dispatch(action) {
				actions.push(action);
			},
			response: createStreamingResponse([
				{
					message: {
						content: [],
						created_at: "2026-03-11T12:00:00.000Z",
						id: "chatcompl_2",
						model: "claude-sonnet-4-6",
						parent_uuid: "user-1",
						role: "assistant",
						stop_reason: null,
						stop_sequence: null,
						type: "message",
						updated_at: "2026-03-11T12:00:00.000Z",
						uuid: "assistant-2",
					},
					type: "message_start",
				},
				{
					content_block: {
						display_content: null,
						flags: null,
						icon_name: "globe",
						id: "tool-1",
						input: null,
						message: "Searching the web",
						name: "web_search",
						start_timestamp: "2026-03-11T12:00:01.000Z",
						stop_timestamp: null,
						type: "tool_use",
					},
					index: 0,
					type: "content_block_start",
				},
				{
					delta: {
						partial_json: "{\"query\":\"Open",
						type: "input_json_delta",
					},
					index: 0,
					type: "content_block_delta",
				},
				{
					delta: {
						partial_json: "AI Codex pricing 2026\"}",
						type: "input_json_delta",
					},
					index: 0,
					type: "content_block_delta",
				},
				{
					index: 0,
					type: "content_block_update",
					update: {
						display_content: {
							preview_url: "https://developers.openai.com/codex/pricing/",
						},
						input: {
							query: "OpenAI Codex pricing 2026",
						},
						message:
							"Fetching: https://developers.openai.com/codex/pricing/",
					},
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
					type: "message_update",
				},
				{
					type: "message_stop",
				},
			]),
		});

		const finalDomain = actions.reduce(
			(domain, action) => produce(domain, (draft) => {
				applyConversationAction(draft, action);
			}),
			createEmptyConversationDomain(
				"conversation-2",
				"2026-03-11T12:00:00.000Z",
			),
		);
		const finalState = {
			domain: finalDomain,
			runtime: createInitialConversationRuntimeState(),
		};
		const [firstUuid] = selectCurrentBranchMessageUuids(finalState);
		const message = getMessageByUuid(finalState, firstUuid);
		const toolUseBlock = message?.content[0];

		expect(message?.stop_reason).toBe("end_turn");
		expect(toolUseBlock).toMatchObject({
			display_content: {
				preview_url: "https://developers.openai.com/codex/pricing/",
			},
			input: {
				query: "OpenAI Codex pricing 2026",
			},
			message: "Fetching: https://developers.openai.com/codex/pricing/",
			stop_timestamp: "2026-03-11T12:00:02.000Z",
			type: "tool_use",
		});
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
