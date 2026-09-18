import { notFound } from "next/navigation";

/**
 * Any unmatched URL under the Admin app resolves here and is answered with the
 * branded `app/not-found.tsx` UI. The route exists so the 404 has a segment
 * layout that can own its document title — `not-found.js` cannot export
 * metadata.
 */
export default function UnmatchedRoute() {
  notFound();
  return null;
}
