"use client";

import { Suspense } from "react";

import { EmptyComposer } from "../components/chatbox/empty-composer";

export default function HomePage(): JSX.Element {
  // EmptyComposer reads `useSearchParams()` to honour `?device=` / `?project=`
  // query strings forwarded by NewChatButton. Next 14 requires that hook to
  // be inside a Suspense boundary so the page can statically prerender.
  return (
    <Suspense fallback={null}>
      <EmptyComposer />
    </Suspense>
  );
}
