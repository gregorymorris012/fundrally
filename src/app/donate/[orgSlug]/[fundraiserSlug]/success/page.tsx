export default function DonateSuccessPage() {
  return (
    <div className="mx-auto max-w-sm p-6 text-center">
      <h1 className="text-xl font-semibold">Thank you!</h1>
      <p className="text-sm text-muted-foreground">
        Your donation is confirmed once our webhook processes the payment —
        usually within a few seconds.
      </p>
    </div>
  );
}
