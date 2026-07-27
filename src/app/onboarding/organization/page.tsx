import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createOrganizationOnboardingAction } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/logo";

export default async function OnboardingOrganizationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col items-center justify-center gap-6 p-6">
      <Logo size={80} />
      <Card className="w-full">
        <CardHeader>
          <CardTitle>What&apos;s your organization&apos;s name?</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createOrganizationOnboardingAction} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Organization name</Label>
              <Input id="name" name="name" required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stateCode">State (2-letter)</Label>
              <Input id="stateCode" name="stateCode" required maxLength={2} />
            </div>
            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
