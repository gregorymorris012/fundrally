"use client";

import { useState } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { createOrderIntent } from "@/lib/payments/create-order-intent";
import { stripePromise, StripeCheckoutStep } from "@/components/payments/stripe-checkout-step";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Product = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
};

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ShopCart({
  orgSlug,
  fundraiserSlug,
  products,
}: {
  orgSlug: string;
  fundraiserSlug: string;
  products: Product[];
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const cartItems = products
    .map((p) => ({ product: p, quantity: quantities[p.id] ?? 0 }))
    .filter((item) => item.quantity > 0);
  const totalCents = cartItems.reduce(
    (sum, item) => sum + item.product.price_cents * item.quantity,
    0,
  );

  function setQuantity(productId: string, quantity: number) {
    setQuantities((prev) => ({ ...prev, [productId]: Math.max(0, quantity) }));
  }

  async function checkout(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { clientSecret } = await createOrderIntent({
        orgSlug,
        fundraiserSlug,
        items: cartItems.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
        })),
        guestName,
        guestEmail,
      });
      if (!clientSecret) throw new Error("no client secret returned");
      setClientSecret(clientSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to start checkout");
    } finally {
      setLoading(false);
    }
  }

  if (clientSecret) {
    return (
      <Elements stripe={stripePromise} options={{ clientSecret }}>
        <StripeCheckoutStep
          returnUrl={`${window.location.origin}${window.location.pathname}/success`}
          submitLabel="Pay"
        />
      </Elements>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {products.map((product) => (
          <Card key={product.id} size="sm">
            <CardHeader>
              <CardTitle>{product.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
              <div>
                {product.description && (
                  <p className="text-sm text-muted-foreground">{product.description}</p>
                )}
                <p className="text-sm">{formatCents(product.price_cents)}</p>
              </div>
              <Input
                type="number"
                min="0"
                step="1"
                className="w-20"
                value={quantities[product.id] ?? 0}
                onChange={(e) => setQuantity(product.id, Number(e.target.value))}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <form className="space-y-3" onSubmit={checkout}>
        <p className="text-sm font-medium">Total: {formatCents(totalCents)}</p>
        <div className="space-y-1.5">
          <Label htmlFor="guestName">Name</Label>
          <Input
            id="guestName"
            required
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guestEmail">Email</Label>
          <Input
            id="guestEmail"
            type="email"
            required
            value={guestEmail}
            onChange={(e) => setGuestEmail(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={loading || cartItems.length === 0} className="w-full">
          Checkout
        </Button>
      </form>
    </div>
  );
}
