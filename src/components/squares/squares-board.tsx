"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

const GRID = 10;

export type BoardEntry = {
  position: number; // 0-99 internally; shown as 1-100
  name: string;
  // Admin only: whether this square's payment has been confirmed. Omitted
  // on the public board, where paid state isn't shown.
  status?: "paid" | "unpaid";
};

// One board, used by both the public play page and the org-admin page, so
// the hover name, square numbers, axis digits, and selection styling can't
// drift apart between them. A client component only for the hover state
// (the row/column crosshair and the name popover) — the data it renders is
// passed in already-fetched by the server pages.
export function SquaresBoard({
  colLabel,
  rowLabel,
  colColor,
  rowColor,
  colDigits,
  rowDigits,
  entries,
  showNumbers = true,
  selectedPosition = null,
  winners = [],
  claimHrefBase = null,
  claimHrefSuffix = "",
}: {
  colLabel: string; // team across the top
  rowLabel: string; // team down the side
  colColor?: string;
  rowColor?: string;
  // Present once the numbers have been drawn; undefined renders "?".
  colDigits?: number[];
  rowDigits?: number[];
  entries: BoardEntry[];
  showNumbers?: boolean;
  selectedPosition?: number | null;
  // Squares that won a period, e.g. { position: 47, label: "Half" }. A
  // square can win more than one period.
  winners?: { position: number; label: string }[];
  // Public board: open squares link to `${claimHrefBase}${position}${suffix}`.
  // Null means open squares aren't clickable (admin view, or pool locked).
  // A base string rather than a function because this component's props
  // cross the server -> client boundary and can't carry functions.
  claimHrefBase?: string | null;
  claimHrefSuffix?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const byPosition = new Map(entries.map((e) => [e.position, e]));
  const winsByPosition = new Map<number, string[]>();
  for (const w of winners) {
    winsByPosition.set(w.position, [...(winsByPosition.get(w.position) ?? []), w.label]);
  }
  const hoverRow = hover == null ? null : Math.floor(hover / GRID);
  const hoverCol = hover == null ? null : hover % GRID;

  return (
    <div className="w-full max-w-[36rem]">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `1.5rem 1.5rem repeat(${GRID}, minmax(0, 1fr))`,
          gridTemplateRows: `1.75rem 1.5rem repeat(${GRID}, auto)`,
        }}
        onPointerLeave={() => setHover(null)}
      >
        {/* corner spacer */}
        <div style={{ gridRow: "1 / 3", gridColumn: "1 / 3" }} />

        {/* column team bar (top) */}
        <div
          style={{
            gridRow: 1,
            gridColumn: `3 / span ${GRID}`,
            backgroundColor: colColor || undefined,
          }}
          className={cn(
            "flex items-center justify-center overflow-hidden px-1 text-[10px] font-bold tracking-wide text-white uppercase",
            !colColor && "bg-foreground",
          )}
        >
          {colLabel}
        </div>

        {/* row team bar (side) */}
        <div
          style={{
            gridRow: `3 / span ${GRID}`,
            gridColumn: 1,
            writingMode: "vertical-rl",
            backgroundColor: rowColor || undefined,
          }}
          className={cn(
            "flex rotate-180 items-center justify-center overflow-hidden px-0.5 text-[10px] font-bold tracking-wide text-white uppercase",
            !rowColor && "bg-muted-foreground",
          )}
        >
          {rowLabel}
        </div>

        {/* column digit headers */}
        {Array.from({ length: GRID }, (_, col) => (
          <div
            key={`col-${col}`}
            style={{ gridRow: 2, gridColumn: col + 3 }}
            className={cn(
              "flex items-center justify-center font-mono text-sm text-muted-foreground",
              hoverCol === col && "font-bold text-selection",
            )}
          >
            {colDigits ? colDigits[col] : "?"}
          </div>
        ))}

        {/* row digit headers */}
        {Array.from({ length: GRID }, (_, row) => (
          <div
            key={`row-${row}`}
            style={{ gridRow: row + 3, gridColumn: 2 }}
            className={cn(
              "flex items-center justify-center font-mono text-sm text-muted-foreground",
              hoverRow === row && "font-bold text-selection",
            )}
          >
            {rowDigits ? rowDigits[row] : "?"}
          </div>
        ))}

        {/* squares */}
        {Array.from({ length: GRID * GRID }, (_, position) => {
          const row = Math.floor(position / GRID);
          const col = position % GRID;
          const entry = byPosition.get(position);
          const isHovered = hover === position;
          const inCrosshair = hover != null && !isHovered && (hoverRow === row || hoverCol === col);
          const isSelected = selectedPosition === position;
          const label = position + 1;
          const wins = winsByPosition.get(position);
          const href =
            !entry && claimHrefBase != null
              ? `${claimHrefBase}${position}${claimHrefSuffix}`
              : null;

          const cellClass = cn(
            "group relative flex aspect-square min-w-0 items-center justify-center border border-border/80 text-[11px] font-medium text-foreground outline-none",
            !entry && "bg-background",
            entry && !entry.status && "bg-slate-100 dark:bg-slate-800",
            entry?.status === "paid" && "bg-success/20",
            entry?.status === "unpaid" && "bg-warning/20",
            // Winners: a gold fill, distinct from the deep-blue selection outline.
            wins && "bg-amber-200 dark:bg-amber-500/30",
            inCrosshair && "bg-selection/10",
            // The selection outline: deep blue, drawn inside the cell so
            // neighbouring squares' borders can't cover it.
            (isHovered || isSelected) && "z-10 ring-2 ring-selection ring-inset",
            isSelected && "bg-selection/15",
            href && "cursor-pointer",
          );

          const content = (
            <>
              {showNumbers && (
                <span className="pointer-events-none absolute top-0.5 left-1 text-[8px] leading-none text-muted-foreground">
                  {label}
                </span>
              )}
              {entry && (
                <span className="max-w-full truncate px-0.5 pt-2">
                  {entry.name.split(" ")[0]}
                </span>
              )}
              {wins && (
                <span className="pointer-events-none absolute right-0.5 bottom-0.5 text-[8px] leading-none font-bold text-amber-900 dark:text-amber-200">
                  ★ {wins.join(" · ")}
                </span>
              )}
              {(entry || wins) && (
                // Sits outside any overflow-hidden ancestor on purpose: the
                // earlier boards clipped this popover, so hover never
                // showed the name.
                <span
                  className={cn(
                    "pointer-events-none absolute left-1/2 z-20 hidden -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background shadow-md group-focus:block group-hover:block",
                    row === 0 ? "top-full mt-1" : "bottom-full mb-1",
                  )}
                >
                  #{label}
                  {entry && ` · ${entry.name}`}
                  {entry?.status && ` · ${entry.status === "paid" ? "Paid" : "Unpaid"}`}
                  {wins && ` · Winner: ${wins.join(", ")}`}
                </span>
              )}
            </>
          );

          const common = {
            style: { gridRow: row + 3, gridColumn: col + 3 },
            className: cellClass,
            onPointerEnter: () => setHover(position),
          };

          if (href) {
            return (
              <Link
                key={position}
                href={href}
                aria-label={`Claim square ${label}`}
                onFocus={() => setHover(position)}
                {...common}
              >
                {content}
              </Link>
            );
          }
          return (
            <div
              key={position}
              // Focusable so a tap/tab reveals the name on touch devices,
              // where there is no hover.
              tabIndex={entry ? 0 : undefined}
              aria-label={entry ? `Square ${label}: ${entry.name}` : `Square ${label}: open`}
              onFocus={() => setHover(position)}
              {...common}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
