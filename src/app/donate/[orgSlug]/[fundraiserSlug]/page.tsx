import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DonateForm } from "@/components/payments/donate-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DonatePage({
  params,
}: {
  params: Promise<{ orgSlug: string; fundraiserSlug: string }>;
}) {
  const { orgSlug, fundraiserSlug } = await params;

  // Anon-capable client — db/migrations/0005_public_donate_policies.sql is
  // what makes this readable for a signed-out guest.
  const supabase = await createClient();
  // !inner turns the embed into a real join condition — without it, a
  // left-join embed only filters the nested object, not which fundraiser
  // rows come back, and fundraiser slugs are only unique per org
  // (db/schema/fundraisers.ts), not globally.
  const { data: fundraiser } = await supabase
    .from("fundraisers")
    .select("title, status, organizations!inner(name, slug, charges_enabled)")
    .eq("slug", fundraiserSlug)
    .eq("organizations.slug", orgSlug)
    .maybeSingle();

  const org = fundraiser
    ? Array.isArray(fundraiser.organizations)
      ? fundraiser.organizations[0]
      : fundraiser.organizations
    : null;

  if (!fundraiser || !org || fundraiser.status !== "active") notFound();

  return (
    <div className="mx-auto max-w-sm p-6">
      <Card>
        <CardHeader>
          <CardTitle>{fundraiser.title}</CardTitle>
          <p className="text-sm text-muted-foreground">{org.name}</p>
        </CardHeader>
        <CardContent>
          {org.charges_enabled ? (
            <DonateForm orgSlug={orgSlug} fundraiserSlug={fundraiserSlug} />
          ) : (
            <p className="text-sm text-destructive">
              This organization isn&apos;t able to accept payments yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
