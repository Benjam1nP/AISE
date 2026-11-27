import { z } from 'zod';
import { TicketId } from './schemas/tickets';
import { PhaseId } from './state';
import type { ProjectStore } from './store';

/** Who speaks in an agent handoff: the test agent, the code agent, or the checks between them. */
export const AgentRole = z.enum(['test', 'code', 'checks']);
export type AgentRole = z.infer<typeof AgentRole>;

export const ChatEntry = z.object({
	role: z.enum(['user', 'assistant']),
	text: z.string(),
	at: z.string(),
	runId: z.string().optional(),
	auto: z.boolean().optional(),
	/** Fix loop handoffs only: who wrote the entry and who it is for. Absent in older chats. */
	from: AgentRole.optional(),
	to: AgentRole.optional(),
	/** Fix loop handoffs only: the position in the run, from 1, as in the agent_message event. */
	seq: z.number().int().positive().optional()
});
export type ChatEntry = z.infer<typeof ChatEntry>;

/** A phase chat (P1 to P7) or a ticket chat (TCK-001). */
export const ChatKey = z.union([PhaseId, TicketId]);
export type ChatKey = z.infer<typeof ChatKey>;

const chatFile = (key: ChatKey) => `.aise/chat/${ChatKey.parse(key)}.jsonl`;

export async function appendChat(store: ProjectStore, key: ChatKey, e: ChatEntry): Promise<void> {
	await store.appendFile(chatFile(key), JSON.stringify(ChatEntry.parse(e)) + '\n');
}

/** Deletes a chat; a chat that does not exist is fine. */
export async function deleteChat(store: ProjectStore, key: ChatKey): Promise<void> {
	const file = chatFile(key);
	if (await store.exists(file)) await store.deleteFile(file);
}

export async function readChat(store: ProjectStore, key: ChatKey): Promise<ChatEntry[]> {
	const text = await store.readText(chatFile(key));
	if (text === null) return [];
	return text
		.split('\n')
		.filter((line) => line.trim() !== '')
		.map((line) => ChatEntry.parse(JSON.parse(line)));
}
