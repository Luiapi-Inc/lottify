import Supermemory from "supermemory";

const containerTag = process.env.SUPERMEMORY_CONTAINER_TAG ?? "lottify_v1_docs";
const query = process.argv.slice(2).join(" ").trim();

if (!process.env.SUPERMEMORY_API_KEY) {
  throw new Error("SUPERMEMORY_API_KEY is required");
}
if (!/^[a-zA-Z0-9_:-]+$/.test(containerTag)) {
  throw new Error("SUPERMEMORY_CONTAINER_TAG must match ^[a-zA-Z0-9_:-]+$");
}
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
