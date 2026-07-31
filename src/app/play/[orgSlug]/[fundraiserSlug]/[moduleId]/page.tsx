import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { joinModule } from "@/lib/module-entries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MODULE_TYPE_LABELS: Record<string, string> = {
  squares: "Squares",
  fifty_fifty: "50/50",
  item_raffle: "Item raffle",
  wheel: "Prize wheel",
};

// Free, no-money participation page for chance-based mini-games — see
// db/schema/module-entries.ts for why this isn't a real-money checkout
// flow: CLAUDE.md's active deviation blocks that until Phase 4 compliance
// work lands, regardless of demo status. Actual dollars raised at the
// event reach the master fundraiser through offline gift entry
// (org-admin-only, src/lib/payments/offline-gift.ts), tagged to this
// module — a separate, real transactions row.
export default async function PlayModulePage({
  params,
}: {
  params: Promise<{ orgSlug: string; fundraiserSlug: string; moduleId: string }>;
}) {
  const { orgSlug, fundraiserSlug, moduleId } = await params;

  // Anon-capable client — db/migrations/0012_module_entries_policies.sql
  // is what makes this readable for a signed-out guest.
  const supabase = await createClient();
  const { data: fundraiser } = await supabase
    .from("fundraisers")
    .select("id, title, status, organizations!inner(id, name, slug)")
    .eq("slug", fundraiserSlug)
    .eq("organizations.slug", orgSlug)
    .maybeSingle();

  const org = fundraiser
    ? Array.isArray(fundraiser.organizations)
      ? fundraiser.organizations[0]
      : fundraiser.organizations
    : null;

  if (!fundraiser || !org || fundraiser.status !== "active") notFound();

  const { data: module_ } = await supabase
    .from("modules")
    .select("id, type, status")
    .eq("id", moduleId)
    .eq("fundraiser_id", fundraiser.id)
    .eq("status", "active")
    .maybeSingle();
  if (!module_) notFound();

  const { data: entries } = await supabase
    .from("module_entries")
    .select("display_name, note, created_at")
    .eq("module_id", module_.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 p-6">
      <div className="text-center">
        <h1 className="font-heading text-2xl font-bold text-foreground">
          {MODULE_TYPE_LABELS[module_.type] ?? module_.type}
        </h1>
        <p className="text-sm text-muted-foreground">
          {fundraiser.title} &middot; {org.name}
        </p>
      </div>

      <Alert variant="warning">
        <AlertTitle>Demo entry &mdash; no payment</AlertTitle>
        <AlertDescription>
          This joins the list below for demo purposes only. Real-money entry
          isn&apos;t available for this game yet.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Join</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={joinModule} className="space-y-3">
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="moduleId" value={module_.id} />
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Your name</Label>
              <Input id="displayName" name="displayName" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">Note (optional)</Label>
              <Input id="note" name="note" placeholder="e.g. a square number or pick" />
            </div>
            <Button type="submit" className="w-full">
              Join for free (demo)
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who&apos;s joined ({entries?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {entries?.length ? (
            entries.map((e, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span>{e.display_name}</span>
                {e.note && <span className="text-muted-foreground">{e.note}</span>}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No one yet &mdash; be the first!</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
