"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { QohCard } from "@/lib/queen-of-hearts-config";

const COLS = 9; // 54 = 6 rows x 9 cols

const SUIT_SYMBOL: Record<NonNullable<QohCard["suit"]>, string> = {
  Hearts: "♥",
  Diamonds: "♦",
  Clubs: "♣",
  Spades: "♠",
};
const RED_SUITS = new Set(["Hearts", "Diamonds"]);

function cardFace(card: QohCard): { text: string; red: boolean } {
  if (card.type === "joker") return { text: "JKR", red: false };
  const rank = card.rank === "10" ? "10" : card.rank[0];
  return { text: `${rank}${SUIT_SYMBOL[card.suit]}`, red: RED_SUITS.has(card.suit) };
}

export type QohBoardEntry = {
  position: number; // 1-54
  name: string;
  status?: "paid" | "unpaid"; // admin only
};

export type QohBoardReveal = {
  position: number; // 1-54
  card: QohCard;
};

// The 54-position board — used by the admin page now and the public page
// once it's built. Not clickable on its own (see QohAdminBoard, which
// wraps this for the assign-a-position flow); a client component only for
// the hover/focus name popover, same reasoning as squares-board.tsx.
export function QohBoard({
  entries,
  reveals,
  showNumbers = true,
  selectedPosition = null,
  onPositionClick,
  claimHrefBase = null,
  claimHrefSuffix = "",
}: {
  entries: QohBoardEntry[];
  reveals: QohBoardReveal[];
  showNumbers?: boolean;
  selectedPosition?: number | null;
  // Admin mode: every square (open or claimed) is clickable via this
  // handler — see QohAdminBoard.
  onPositionClick?: (position: number) => void;
  // Public mode: an open position links to `${claimHrefBase}${position}${suffix}`
  // — a plain server-rendered link, not a client click handler, so
  // picking a number works without JS. Mirrors squares-board.tsx.
  claimHrefBase?: string | null;
  claimHrefSuffix?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const byPosition = new Map(entries.map((e) => [e.position, e]));
  const revealByPosition = new Map(reveals.map((r) => [r.position, r]));

  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
      onPointerLeave={() => setHover(null)}
    >
      {Array.from({ length: 54 }, (_, i) => {
        const position = i + 1;
        const entry = byPosition.get(position);
        const reveal = revealByPosition.get(position);
        const face = reveal ? cardFace(reveal.card) : null;
        // Every reveal is a past cycle's winner — squares' version
        // distinguishes "current" vs "past" winners; QoH's board doesn't
        // need that distinction since a position is only ever revealed once.
        const isSelected = selectedPosition === position;
        const isHovered = hover === position;
        const clickable = !!onPositionClick && !reveal;
        const href =
          !entry && !reveal && claimHrefBase != null ? `${claimHrefBase}${position}${claimHrefSuffix}` : null;

        const cellClass = cn(
          "group relative flex aspect-[3/4] min-w-0 flex-col items-center justify-center rounded-md border border-border/80 text-xs font-semibold outline-none",
          !entry && !reveal && "bg-background",
          entry && !reveal && !entry.status && "bg-slate-100 dark:bg-slate-800",
          entry?.status === "paid" && "bg-success/20",
          entry?.status === "unpaid" && "bg-warning/20",
          reveal && "bg-amber-200 dark:bg-amber-500/30",
          (isHovered || isSelected) && "z-10 ring-2 ring-selection ring-inset",
          isSelected && "bg-selection/15",
          (clickable || href) && "cursor-pointer hover:bg-muted",
        );

        const content = (
          <>
            {showNumbers && (
              <span className="pointer-events-none absolute top-0.5 left-1 text-[8px] leading-none text-muted-foreground">
                {position}
              </span>
            )}
            {face ? (
              <span className={cn("text-sm", face.red ? "text-red-600 dark:text-red-400" : "text-foreground")}>
                {face.text}
              </span>
            ) : entry ? (
              <span className="max-w-full truncate px-0.5 pt-2 text-[10px]">{entry.name.split(" ")[0]}</span>
            ) : null}
            {reveal && (
              <span className="pointer-events-none absolute right-0.5 bottom-0.5 text-[8px] leading-none font-bold text-amber-900 dark:text-amber-200">
                ★
              </span>
            )}
            {(entry || reveal) && (
              <span
                className={cn(
                  "pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background shadow-md group-focus:block group-hover:block",
                )}
              >
                #{position}
                {reveal && ` · ${reveal.card.label}`}
                {entry && ` · ${entry.name}`}
                {entry?.status && ` · ${entry.status === "paid" ? "Paid" : "Unpaid"}`}
              </span>
            )}
          </>
        );

        const common = {
          className: cellClass,
          onPointerEnter: () => setHover(position),
          onFocus: () => setHover(position),
        };

        if (clickable) {
          return (
            <button
              key={position}
              type="button"
              tabIndex={0}
              aria-label={entry ? `Position ${position}: ${entry.name}` : `Position ${position}: open`}
              onClick={() => onPositionClick!(position)}
              {...common}
            >
              {content}
            </button>
          );
        }
        if (href) {
          return (
            <Link key={position} href={href} aria-label={`Position ${position}: open`} {...common}>
              {content}
            </Link>
          );
        }
        return (
          <div
            key={position}
            tabIndex={entry || reveal ? 0 : undefined}
            aria-label={
              reveal
                ? `Position ${position}: ${reveal.card.label}`
                : entry
                  ? `Position ${position}: ${entry.name}`
                  : `Position ${position}: open`
            }
            {...common}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
