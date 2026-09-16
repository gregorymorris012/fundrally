"use client";

import { useState } from "react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

// Clipboard access is inherently client-only (no server-action
// equivalent) — same reasoning as ConfirmSubmitButton for window.confirm:
// a small, isolated client island rather than pulling in more client-side
// machinery than this one interaction needs. Takes a relative `path` and
// resolves it against window.location.origin at click time rather than
// building an absolute URL server-side — always correct for whatever
// host actually served the page (localhost, a preview deploy,
// production) without a new env var or reading request headers.
export function CopyLinkButton({
  path,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "children"> & { path: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      {...props}
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}${path}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard API can be unavailable (permissions, non-HTTPS
          // context) — fail quietly rather than throw in the UI.
        }
      }}
    >
      {copied ? "Copied!" : "Copy link"}
    </Button>
  );
}
