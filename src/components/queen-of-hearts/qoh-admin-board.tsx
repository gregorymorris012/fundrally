"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { QohBoard, type QohBoardEntry, type QohBoardReveal } from "@/components/queen-of-hearts/qoh-board";

export type QohAdminEntry = QohBoardEntry & { id: string; entryDisplayName: string };

type FormAction = (formData: FormData) => void | Promise<void>;

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "in_kind", label: "In-kind" },
  { value: "other", label: "Other" },
];

// The organizer's board: same display as QohBoard, but an open position is
// clickable and opens a panel to add an in-person entry there (someone
// paid cash, phoned it in), and a claimed-but-unrevealed position opens
// mark-paid/void controls. A revealed position is history — read-only.
export function QohAdminBoard({
  entries,
  reveals,
  showNumbers,
  ids,
  priceLabel,
  actions,
}: {
  entries: QohAdminEntry[];
  reveals: QohBoardReveal[];
  showNumbers: boolean;
  ids: { orgId: string; fundraiserId: string; moduleId: string; orgSlug: string; fundraiserSlug: string };
  priceLabel: string | null;
  actions: { enter: FormAction; markPaid: FormAction; voidPayment: FormAction };
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [markPaidOnAdd, setMarkPaidOnAdd] = useState(false);
  const byPosition = new Map(entries.map((e) => [e.position, e]));
  const entry = selected == null ? undefined : byPosition.get(selected);
  const revealed = selected == null ? undefined : reveals.find((r) => r.position === selected);

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
      <QohBoard
        entries={entries}
        reveals={reveals}
        showNumbers={showNumbers}
        selectedPosition={selected}
        onPositionClick={(position) => setSelected((cur) => (cur === position ? null : position))}
      />

      <div className="rounded-lg border border-border bg-muted/30 p-4">
        {selected == null ? (
          <p className="text-sm text-muted-foreground">
            Click an open position to add an in-person entry there, or a claimed one to mark it paid or void a payment.
          </p>
        ) : revealed ? (
          <p className="text-sm text-muted-foreground">
            Position #{selected} was already revealed ({revealed.card.label}) — nothing to change.
          </p>
        ) : entry ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Position #{selected} — {entry.entryDisplayName}
              </p>
              <p className="text-xs text-muted-foreground">
                {entry.status === "paid" ? "Paid" : "Unpaid"}
                {priceLabel ? ` · ${priceLabel}` : ""}
              </p>
            </div>
            {entry.status === "paid" ? (
              <form action={actions.voidPayment}>
                {hidden}
                <input type="hidden" name="entryId" value={entry.id} />
                <ConfirmSubmitButton
                  type="submit"
                  variant="outline"
                  size="sm"
                  confirmMessage={`Void the payment for #${selected} (${entry.entryDisplayName})? A correction entry is recorded.`}
                >
                  Void payment
                </ConfirmSubmitButton>
              </form>
            ) : (
              <form action={actions.markPaid} className="flex items-center gap-2">
                {hidden}
                <input type="hidden" name="entryId" value={entry.id} />
                <select
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
                <Button type="submit" size="sm">
                  Mark paid
                </Button>
              </form>
            )}
          </div>
        ) : (
          <form key={selected} action={actions.enter} className="space-y-3">
            {hidden}
            <input type="hidden" name="cardNumber" value={selected} />
            <input type="hidden" name="confirmedAge18Plus" value="on" />
            <p className="text-sm font-semibold text-foreground">Add an entry at position #{selected}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="qoh-add-name">Name</Label>
                <Input id="qoh-add-name" name="displayName" required maxLength={100} autoFocus className="w-56" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qoh-add-qty">Entries</Label>
                <Input id="qoh-add-qty" name="quantity" type="number" min={1} defaultValue={1} className="w-20" />
              </div>
              <Button type="submit">Add</Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="markPaid"
                checked={markPaidOnAdd}
                onChange={(e) => setMarkPaidOnAdd(e.target.checked)}
                className="h-4 w-4 accent-[var(--selection)]"
              />
              Already paid (cash)
            </label>
          </form>
        )}
      </div>
    </div>
  );
}
