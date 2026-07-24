"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { createDonationIntent } from "@/lib/payments/create-donation-intent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

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
        <PaymentStep />
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

function PaymentStep() {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    // Card data never reaches our server (build spec's primary
    // constraint) — Stripe Elements handles it and confirms directly with
    // Stripe from the browser.
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}${window.location.pathname}/success`,
      },
    });

    if (error) {
      setError(error.message ?? "payment failed");
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={handleConfirm}>
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={!stripe || submitting} className="w-full">
        Donate
      </Button>
    </form>
  );
}
