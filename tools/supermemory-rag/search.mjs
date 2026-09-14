import Supermemory from "supermemory";
import { assertContainerTag } from "./container-tag.mjs";

const containerTag = process.env.SUPERMEMORY_CONTAINER_TAG ?? "lottify_v1_docs";
const query = process.argv.slice(2).join(" ").trim();

if (!process.env.SUPERMEMORY_API_KEY) {
  throw new Error("SUPERMEMORY_API_KEY is required");
}
assertContainerTag(containerTag, "SUPERMEMORY_CONTAINER_TAG");
if (!query) {
  throw new Error('usage: npm run search -- "query"');
}

const client = new Supermemory();
const response = await client.search({
  q: query,
  searchMode: "documents",
  containerTag,
  limit: 10,
});

console.log(JSON.stringify(response.results ?? response, null, 2));
