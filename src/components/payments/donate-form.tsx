"use client";

import { useState } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { createDonationIntent } from "@/lib/payments/create-donation-intent";
import { stripePromise, StripeCheckoutStep } from "@/components/payments/stripe-checkout-step";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DonateForm({
  orgSlug,
  fundraiserSlug,
}: {
  orgSlug: string;
  fundraiserSlug: string;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [amount, setAmount] = useState("25");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function startDonation(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const amountCents = Math.round(Number(amount) * 100);
      const { clientSecret } = await createDonationIntent({
        orgSlug,
        fundraiserSlug,
        amountCents,
        guestName,
        guestEmail,
      });
      if (!clientSecret) throw new Error("no client secret returned");
      setClientSecret(clientSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to start donation");
    } finally {
      setLoading(false);
    }
  }

  if (clientSecret) {
    return (
      <Elements stripe={stripePromise} options={{ clientSecret }}>
        <StripeCheckoutStep
          returnUrl={`${window.location.origin}${window.location.pathname}/success`}
          submitLabel="Donate"
        />
      </Elements>
    );
  }

  return (
    <form className="space-y-3" onSubmit={startDonation}>
      <div className="space-y-1.5">
        <Label htmlFor="amount">Amount (USD)</Label>
        <Input
          id="amount"
          type="number"
          min="1"
          step="1"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
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
      <Button type="submit" disabled={loading} className="w-full">
        Continue
      </Button>
    </form>
  );
}
