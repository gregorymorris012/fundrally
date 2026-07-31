import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createProduct } from "@/lib/products";
import { updateModuleStatus } from "@/lib/modules";
import { drawSquares } from "@/lib/draws";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MODULE_TYPE_LABELS: Record<string, string> = {
  product: "Product sale",
  squares: "Squares",
  fifty_fifty: "50/50",
  item_raffle: "Item raffle",
  wheel: "Prize wheel",
  auction: "Auction",
  golf: "Golf outing",
};

const CHANCE_MODULE_TYPES = ["wheel", "squares", "fifty_fifty", "item_raffle"];

const moduleStatusVariant = {
  draft: "secondary",
  active: "success",
  paused: "warning",
  closed: "outline",
} as const;

// Mirrors MODULE_STATUS_TRANSITIONS in src/lib/modules.ts — kept in sync
// there (server-authoritative check) and here (which buttons to show).
const NEXT_ACTIONS: Record<string, { status: string; label: string }[]> = {
  draft: [{ status: "active", label: "Launch" }],
  active: [
    { status: "paused", label: "Pause" },
    { status: "closed", label: "Close" },
  ],
  paused: [
    { status: "active", label: "Resume" },
    { status: "closed", label: "Close" },
  ],
  closed: [],
};

export default async function ModuleAdminPage({
  params,
}: {
  params: Promise<{ orgSlug: string; fundraiserSlug: string; moduleId: string }>;
}) {
  const { orgSlug, fundraiserSlug, moduleId } = await params;
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
    .select("id, title, slug")
    .eq("org_id", org.id)
    .eq("slug", fundraiserSlug)
    .maybeSingle();
  if (!fundraiser) notFound();

  const { data: module_ } = await supabase
    .from("modules")
    .select("id, type, status")
    .eq("id", moduleId)
    .eq("fundraiser_id", fundraiser.id)
    .maybeSingle();
  if (!module_) notFound();

  const isChanceModule = CHANCE_MODULE_TYPES.includes(module_.type);

  const { count: entryCount } = isChanceModule
    ? await supabase
        .from("module_entries")
        .select("id", { count: "exact", head: true })
        .eq("module_id", module_.id)
    : { count: 0 };

  const isSquares = module_.type === "squares";
  const { data: draw } = isSquares
    ? await supabase
        .from("draws")
        .select("result, created_at")
        .eq("module_id", module_.id)
        .maybeSingle()
    : { data: null };
  const drawResult = draw?.result as
    | { rowDigits: number[]; colDigits: number[] }
    | undefined;

  const { data: products } = module_.type === "product"
    ? await supabase
        .from("products")
        .select("id, name, price_cents, status")
        .eq("module_id", module_.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  const { data: orders } = module_.type === "product"
    ? await supabase
        .from("orders")
        .select(
          "id, status, created_at, participants(display_name, email), order_items(quantity, unit_price_cents, products(name))",
        )
        .eq("module_id", module_.id)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {MODULE_TYPE_LABELS[module_.type] ?? module_.type}
          </h1>
          <Badge
            variant={
              moduleStatusVariant[
                module_.status as keyof typeof moduleStatusVariant
              ]
            }
          >
            {module_.status}
          </Badge>
        </div>
        <Link
          href={`/org/${orgSlug}/fundraisers/${fundraiserSlug}`}
          className="text-sm text-muted-foreground underline"
        >
          Back to {fundraiser.title}
        </Link>
      </div>

      {isChanceModule && (
        <Alert variant="warning">
          <AlertTitle>Demo mode only</AlertTitle>
          <AlertDescription>
            No real-money checkout exists for this module type yet — that
            requires Phase 4&apos;s compliance work, regardless of Stripe or
            demo status. Use offline gift entry on the fundraiser dashboard
            to record any real-world activity for this module.
          </AlertDescription>
        </Alert>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            {NEXT_ACTIONS[module_.status]?.length ? (
              NEXT_ACTIONS[module_.status].map((action) => (
                <form key={action.status} action={updateModuleStatus}>
                  <input type="hidden" name="moduleId" value={module_.id} />
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                  <input type="hidden" name="nextStatus" value={action.status} />
                  <Button
                    type="submit"
                    variant={action.status === "closed" ? "outline" : "default"}
                  >
                    {action.label}
                  </Button>
                </form>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                This module is closed.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {module_.type === "product" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Shop</CardTitle>
            </CardHeader>
            <CardContent>
              <a
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={`/shop/${orgSlug}/${fundraiserSlug}`}
              >
                View public shop page
              </a>
            </CardContent>
          </Card>

          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>Add product</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={createProduct} className="space-y-3">
                  <input type="hidden" name="orgId" value={org.id} />
                  <input type="hidden" name="moduleId" value={module_.id} />
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" name="name" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="description">Description</Label>
                    <Input id="description" name="description" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="price">Price (USD)</Label>
                    <Input id="price" name="price" type="number" min="0.01" step="0.01" required />
                  </div>
                  <Button type="submit">Add product</Button>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Products</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {products?.length ? (
                products.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span>{p.name}</span>
                    <span className="text-muted-foreground">
                      ${(p.price_cents / 100).toFixed(2)} ({p.status})
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No products yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Orders</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {orders?.length ? (
                orders.map((order) => {
                  const items = Array.isArray(order.order_items) ? order.order_items : [];
                  const totalCents = items.reduce(
                    (sum, item) => sum + item.quantity * item.unit_price_cents,
                    0,
                  );
                  const participant = Array.isArray(order.participants)
                    ? order.participants[0]
                    : order.participants;
                  return (
                    <div key={order.id} className="text-sm">
                      <div className="flex items-center justify-between">
                        <span>{participant?.display_name ?? "Guest"}</span>
                        <span className="text-muted-foreground">
                          ${(totalCents / 100).toFixed(2)} ({order.status})
                        </span>
                      </div>
                      <p className="text-muted-foreground">
                        {items
                          .map((item) => {
                            const product = Array.isArray(item.products)
                              ? item.products[0]
                              : item.products;
                            return `${item.quantity}x ${product?.name ?? "item"}`;
                          })
                          .join(", ")}
                      </p>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">No orders yet.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {isChanceModule && (
        <Card>
          <CardHeader>
            <CardTitle>Public entry page</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Share this link so people can join {MODULE_TYPE_LABELS[module_.type]} —
              free demo entry, no payment. {entryCount ?? 0}{" "}
              {isSquares ? "square(s) claimed" : "joined"} so far. Log any
              real-world money collected via offline gift entry on the
              fundraiser dashboard, tagged to this module.
            </p>
            {module_.status === "active" ? (
              <a
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={`/play/${orgSlug}/${fundraiserSlug}/${module_.id}`}
              >
                View public entry page
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">
                Launch this module to make the entry page public.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {isSquares && (
        <Card>
          <CardHeader>
            <CardTitle>Draw numbers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {drawResult ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Drawn {new Date(draw!.created_at).toLocaleString()} —
                  server-side, recorded permanently in the audit trail
                  (build spec rules 1 &amp; 2).
                </p>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-medium text-foreground">Row digits</p>
                    <p className="font-mono">{drawResult.rowDigits.join(", ")}</p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Column digits</p>
                    <p className="font-mono">{drawResult.colDigits.join(", ")}</p>
                  </div>
                </div>
              </>
            ) : isAdmin ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Assigns row/column digits 0-9 once, server-side
                  (crypto.randomInt) — can&apos;t be undone or redrawn.
                  Usually done once the board fills up.
                </p>
                <form action={drawSquares}>
                  <input type="hidden" name="orgId" value={org.id} />
                  <input type="hidden" name="moduleId" value={module_.id} />
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                  <Button type="submit" variant="outline">
                    Draw numbers now
                  </Button>
                </form>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Numbers haven&apos;t been drawn yet.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
