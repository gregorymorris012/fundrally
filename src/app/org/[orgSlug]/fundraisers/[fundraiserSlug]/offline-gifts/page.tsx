import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { addOfflineGift, voidOfflineGift } from "@/lib/payments/offline-gift";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MODULE_TYPE_LABELS: Record<string, string> = {
  product: "Product sale",
  squares: "Squares",
  fifty_fifty: "50/50",
  item_raffle: "Item raffle",
  wheel: "Prize wheel",
  auction: "Auction",
  golf: "Golf outing",
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  check: "Check",
  in_kind: "In-kind",
  other: "Other",
};

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// Split out of the fundraiser landing page: the "Add offline gift" form
// used to live there directly, with no way to see or correct a bad entry
// afterward. Now shows every manual (non-Stripe) row with a Void action —
// voidOfflineGift already existed in src/lib/payments/offline-gift.ts but
// had no UI wired to it until now.
export default async function OfflineGiftsPage({
  params,
}: {
  params: Promise<{ orgSlug: string; fundraiserSlug: string }>;
}) {
  const { orgSlug, fundraiserSlug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, slug")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (!org) notFound();

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) notFound();
  const isAdmin = membership.role === "owner" || membership.role === "admin";

  const { data: fundraiser } = await supabase
    .from("fundraisers")
    .select("id, title")
    .eq("org_id", org.id)
    .eq("slug", fundraiserSlug)
    .maybeSingle();
  if (!fundraiser) notFound();

  const { data: fundraiserModules } = await supabase
    .from("modules")
    .select("id, type")
    .eq("fundraiser_id", fundraiser.id)
    .order("created_at", { ascending: true });
  const moduleLabelById = new Map(
    (fundraiserModules ?? []).map((m) => [m.id, MODULE_TYPE_LABELS[m.type] ?? m.type]),
  );

  const { data: manualGifts } = await supabase
    .from("transactions")
    .select(
      "id, kind, method, gross_cents, module_id, entered_at, created_at, reference, participants(display_name)",
    )
    .eq("fundraiser_id", fundraiser.id)
    .eq("status", "succeeded")
    .neq("method", "stripe")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Offline Donations
        </h1>
        <Link
          href={`/org/${orgSlug}/fundraisers/${fundraiserSlug}`}
          className="text-sm text-muted-foreground underline"
        >
          Back to {fundraiser.title}
        </Link>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Add offline gift</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={addOfflineGift} className="space-y-3">
              <input type="hidden" name="orgId" value={org.id} />
              <input type="hidden" name="fundraiserId" value={fundraiser.id} />
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
              <div className="space-y-1.5">
                <Label htmlFor="donorName">Donor name</Label>
                <Input id="donorName" name="donorName" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="amount">Amount (USD)</Label>
                  <Input
                    id="amount"
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="method">Method</Label>
                  <select
                    id="method"
                    name="method"
                    required
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="in_kind">In-kind</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="receivedAt">Date received</Label>
                  <Input id="receivedAt" name="receivedAt" type="date" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="moduleId">Module (optional)</Label>
                  <select
                    id="moduleId"
                    name="moduleId"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="">General (no module)</option>
                    {fundraiserModules?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {MODULE_TYPE_LABELS[m.type] ?? m.type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reference">Note (optional)</Label>
                <Input id="reference" name="reference" placeholder="Check #, event note, etc." />
              </div>
              <Button type="submit">Add gift</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Logged gifts</CardTitle>
        </CardHeader>
        <CardContent>
          {manualGifts?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Donor</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {isAdmin && <TableHead className="text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {manualGifts.map((t) => {
                  const participant = Array.isArray(t.participants)
                    ? t.participants[0]
                    : t.participants;
                  const isAdjustment = t.kind === "adjustment";
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="text-muted-foreground">
                        {new Date(t.entered_at ?? t.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {participant?.display_name ?? "Guest"}
                        {isAdjustment && (
                          <Badge variant="outline" className="ml-2">
                            void
                          </Badge>
                        )}
                        {t.reference && (
                          <p className="text-xs text-muted-foreground">{t.reference}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {METHOD_LABELS[t.method] ?? t.method}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {t.module_id ? moduleLabelById.get(t.module_id) ?? "—" : "General"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {centsToDollars(t.gross_cents)}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          {!isAdjustment && (
                            <form action={voidOfflineGift}>
                              <input type="hidden" name="orgId" value={org.id} />
                              <input type="hidden" name="orgSlug" value={orgSlug} />
                              <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                              <input type="hidden" name="transactionId" value={t.id} />
                              <Button type="submit" variant="outline" size="sm">
                                Void
                              </Button>
                            </form>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No offline gifts logged yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
