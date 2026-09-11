import ReceiptView from "./receipt-view";

export default async function ReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string | string[] }>;
}) {
  const { orderId } = await searchParams;
  return <ReceiptView orderId={typeof orderId === "string" ? orderId : ""} />;
}
