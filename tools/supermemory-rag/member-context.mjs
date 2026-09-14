import Supermemory from "supermemory";
import { assertContainerTag } from "./container-tag.mjs";

export function memberContainerTag(memberId) {
  const id = String(memberId ?? "").trim();
  if (!id) {
    throw new Error("memberId is required");
  }

  const containerTag = `member:${id}`;
  try {
    return assertContainerTag(containerTag, "memberId");
  } catch {
    throw new Error(
      "memberId cannot be represented as a valid Supermemory containerTag",
    );
  }
}

export function createMemberMemoryClient() {
  requireApiKey();
  return new Supermemory();
}

export async function searchMemberMemory(
  client,
  memberId,
  query,
  { limit = 10 } = {},
) {
  const q = String(query ?? "").trim();
  if (!q) {
    throw new Error("query is required");
  }

  return client.search({
    q,
    containerTag: memberContainerTag(memberId),
    searchMode: "memories",
    limit,
  });
}

export async function addMemberExchange(
  client,
  memberId,
  { user, assistant, customId } = {},
) {
  const userText = String(user ?? "").trim();
  const assistantText = String(assistant ?? "").trim();
  if (!userText || !assistantText) {
    throw new Error("user and assistant exchange text are required");
  }

  return client.add({
    content: JSON.stringify({
      type: "conversation_exchange",
      user: userText,
      assistant: assistantText,
    }),
    containerTag: memberContainerTag(memberId),
    taskType: "memory",
    ...(customId ? { customId: String(customId) } : {}),
    metadata: {
      source: "lottify-member-ai",
    },
  });
}

export async function getMemberMemoryProfile(client, memberId) {
  return client.profile({
    containerTag: memberContainerTag(memberId),
  });
}

function requireApiKey() {
  if (!process.env.SUPERMEMORY_API_KEY) {
    throw new Error("SUPERMEMORY_API_KEY is required");
  }
}
