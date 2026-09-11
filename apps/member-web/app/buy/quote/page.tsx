import QuoteReview from "./quote-review";

export default async function QuotePage({
  searchParams,
}: {
  searchParams: Promise<{ quoteId?: string | string[] }>;
}) {
  const { quoteId } = await searchParams;
  return <QuoteReview quoteId={typeof quoteId === "string" ? quoteId : ""} />;
}
