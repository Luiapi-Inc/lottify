import assert from "node:assert/strict";
import test from "node:test";
import {
  addMemberExchange,
  getMemberMemoryProfile,
  memberContainerTag,
  searchMemberMemory,
} from "./member-context.mjs";

test("memberContainerTag derives an isolated non-PII namespace", () => {
  assert.equal(
    memberContainerTag("550e8400-e29b-41d4-a716-446655440000"),
    "member:550e8400-e29b-41d4-a716-446655440000",
  );
  assert.throws(() => memberContainerTag("member with spaces"));
});

test("member memory operations never cross the derived member tag", async () => {
  const calls = [];
  const client = {
    search: async (request) => {
      calls.push(["search", request]);
      return { results: [] };
    },
    add: async (request) => {
      calls.push(["add", request]);
      return { id: "doc-1" };
    },
    profile: async (request) => {
      calls.push(["profile", request]);
      return { static: [], dynamic: [] };
    },
  };

  await searchMemberMemory(client, "member-123", "preferred language");
  await addMemberExchange(client, "member-123", {
    user: "Use short replies",
    assistant: "Understood",
    customId: "exchange-1",
  });
  await getMemberMemoryProfile(client, "member-123");

  assert.deepEqual(calls[0], [
    "search",
    {
      q: "preferred language",
      containerTag: "member:member-123",
      searchMode: "memories",
      limit: 10,
    },
  ]);
  assert.equal(calls[1][1].containerTag, "member:member-123");
  assert.equal(calls[1][1].taskType, "memory");
  assert.equal(calls[1][1].customId, "exchange-1");
  assert.deepEqual(calls[2], [
    "profile",
    { containerTag: "member:member-123" },
  ]);
});
