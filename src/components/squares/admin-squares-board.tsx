"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SquaresBoard } from "@/components/squares/squares-board";

export type AdminEntry = {
  id: string;
  position: number; // 0-99
  name: string;
  paid: boolean;
};

type FormAction = (formData: FormData) => void | Promise<void>;

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "in_kind", label: "In-kind" },
  { value: "other", label: "Other" },
];

function MethodSelect({ id }: { id: string }) {
  return (
    <select
      id={id}
      name="method"
      defaultValue="cash"
      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
    >
      {PAYMENT_METHODS.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

// The organizer's board: same shared board, but every square is clickable
// and opens a panel underneath — assign an open square to a name, or mark
// paid / void the payment / release a claimed one. The actions are the
// existing server actions (passed in as props), so nothing here writes to
// the database directly.
export function AdminSquaresBoard({
  colLabel,
  rowLabel,
  colColor,
  rowColor,
  colDigits,
  rowDigits,
  winners,
  showNumbers,
  entries,
  ids,
  priceLabel,
  actions,
}: {
  colLabel: string;
  rowLabel: string;
  colColor?: string;
  rowColor?: string;
  colDigits?: number[];
  rowDigits?: number[];
  winners: { position: number; label: string }[];
  showNumbers: boolean;
  entries: AdminEntry[];
  ids: { orgId: string; fundraiserId: string; moduleId: string; orgSlug: string; fundraiserSlug: string };
  priceLabel: string | null;
  actions: { assign: FormAction; markPaid: FormAction; voidPayment: FormAction; release: FormAction };
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [markPaidOnAssign, setMarkPaidOnAssign] = useState(false);
  const byPosition = new Map(entries.map((e) => [e.position, e]));
  const entry = selected == null ? undefined : byPosition.get(selected);

  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ids.orgId} />
      <input type="hidden" name="fundraiserId" value={ids.fundraiserId} />
      <input type="hidden" name="moduleId" value={ids.moduleId} />
      <input type="hidden" name="orgSlug" value={ids.orgSlug} />
      <input type="hidden" name="fundraiserSlug" value={ids.fundraiserSlug} />
    </>
  );

  return (
    <div className="space-y-4">
      <SquaresBoard
        colLabel={colLabel}
        rowLabel={rowLabel}
        colColor={colColor}
        rowColor={rowColor}
        colDigits={colDigits}
        rowDigits={rowDigits}
        winners={winners}
        showNumbers={showNumbers}
        entries={entries.map((e) => ({
          position: e.position,
          name: e.name,
          status: e.paid ? "paid" : "unpaid",
        }))}
        selectedPosition={selected}
        onSquareClick={(position) => setSelected((cur) => (cur === position ? null : position))}
      />

      <div className="rounded-lg border border-border bg-muted/30 p-4">
        {selected == null ? (
          <p className="text-sm text-muted-foreground">
            Click any square to assign it to someone, or to mark it paid, void a
            payment, or release it.
          </p>
        ) : entry ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Square #{selected + 1} — {entry.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {entry.paid ? "Paid" : "Unpaid"}
                {priceLabel ? ` · ${priceLabel}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              {entry.paid ? (
                <form action={actions.voidPayment}>
                  {hidden}
                  <input type="hidden" name="entryId" value={entry.id} />
                  <ConfirmSubmitButton
                    type="submit"
                    variant="outline"
                    size="sm"
                    confirmMessage={`Void the payment for square #${selected + 1}? A correction entry is recorded; the square stays claimed.`}
                  >
                    Void payment
                  </ConfirmSubmitButton>
                </form>
              ) : (
                <form action={actions.markPaid} className="flex items-center gap-2">
                  {hidden}
                  <input type="hidden" name="entryId" value={entry.id} />
                  <MethodSelect id={`method-${entry.id}`} />
                  <Button type="submit" size="sm">
                    Mark paid
                  </Button>
                </form>
              )}
              <form action={actions.release}>
                {hidden}
                <input type="hidden" name="entryId" value={entry.id} />
                <ConfirmSubmitButton
                  type="submit"
                  variant="outline"
                  size="sm"
                  confirmMessage={`Release square #${selected + 1} from ${entry.name}? It becomes open again.`}
                >
                  Release square
                </ConfirmSubmitButton>
              </form>
            </div>
          </div>
        ) : (
          <form key={selected} action={actions.assign} className="space-y-3">
            {hidden}
            <input type="hidden" name="position" value={selected} />
            <p className="text-sm font-semibold text-foreground">Assign square #{selected + 1}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="assign-name">Name</Label>
                <Input
                  id="assign-name"
                  name="displayName"
                  required
                  maxLength={100}
                  autoFocus
                  placeholder="Who is this square for?"
                  className="w-64"
                />
              </div>
              <Button type="submit">Assign</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="markPaid"
                  checked={markPaidOnAssign}
                  onChange={(e) => setMarkPaidOnAssign(e.target.checked)}
                  className="h-4 w-4 accent-[var(--selection)]"
                />
                Already paid
              </label>
              {markPaidOnAssign && <MethodSelect id="assign-method" />}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
