"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";

export const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);

// Shared by DonateForm and ShopCart: both need this exact
// mount-PaymentElement-then-confirmPayment step once they have a
// clientSecret. Card data never reaches our server here (build spec's
// primary constraint) — Stripe confirms directly from the browser.
export function StripeCheckoutStep({
  returnUrl,
  submitLabel,
}: {
  returnUrl: string;
  submitLabel: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
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
        {submitLabel}
      </Button>
    </form>
  );
}
