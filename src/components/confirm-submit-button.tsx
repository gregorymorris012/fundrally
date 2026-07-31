"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

// Deleting a fundraiser or organization is irreversible and cascades a
// lot (see 0016_delete_policies.sql) — worth a real "are you sure" rather
// than a bare button, even though nothing else in this codebase needed
// client-side interactivity before this. Kept to exactly what's needed
// (a native confirm()) rather than pulling in a full dialog system for
// one button.
export function ConfirmSubmitButton({
  confirmMessage,
  onClick,
  ...props
}: ComponentProps<typeof Button> & { confirmMessage: string }) {
  return (
    <Button
      {...props}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    />
  );
}
