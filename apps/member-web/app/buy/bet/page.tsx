import BetEditor from "./bet-editor";

export default async function BetPage({
  searchParams,
}: {
  searchParams: Promise<{ drawId?: string | string[] }>;
}) {
  const { drawId } = await searchParams;
  return <BetEditor drawId={typeof drawId === "string" ? drawId : ""} />;
}
