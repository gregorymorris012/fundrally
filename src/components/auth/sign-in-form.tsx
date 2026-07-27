"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Method = "email" | "phone";
type Stage = "request" | "verify";

// Dev-only one-click sign-in against a Supabase test_otp number (see
// supabase/config.toml) — a real auth session through the real phone-OTP
// flow, not a bypass, so RLS still applies exactly as it would for any
// other user. process.env.NODE_ENV is inlined at build time, so this
// entire branch (and the button below) is dead-code-eliminated from the
// production bundle — it cannot render or run once deployed.
const TEST_LOGIN_PHONE = "+15005550011";
const TEST_LOGIN_OTP = "123456";
const TEST_LOGIN_ENABLED = process.env.NODE_ENV !== "production";

export function SignInForm() {
  const router = useRouter();
  const supabase = createClient();

  const [method, setMethod] = useState<Method>("email");
  const [stage, setStage] = useState<Stage>("request");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestEmailLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStage("verify");
  }

  async function requestPhoneOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({ phone });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStage("verify");
  }

  async function verifyPhoneOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.verifyOtp({
      phone,
      token: code,
      type: "sms",
    });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function handleTestLogin() {
    setLoading(true);
    setError(null);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone: TEST_LOGIN_PHONE,
    });
    if (otpError) {
      setLoading(false);
      setError(otpError.message);
      return;
    }

    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: TEST_LOGIN_PHONE,
      token: TEST_LOGIN_OTP,
      type: "sms",
    });

    setLoading(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          {method === "email"
            ? "We'll email you a sign-in link."
            : "We'll text you a code."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={method === "email" ? "default" : "outline"}
            onClick={() => {
              setMethod("email");
              setStage("request");
              setError(null);
            }}
          >
            Email
          </Button>
          <Button
            type="button"
            variant={method === "phone" ? "default" : "outline"}
            onClick={() => {
              setMethod("phone");
              setStage("request");
              setError(null);
            }}
          >
            Phone
          </Button>
        </div>

        {method === "email" && stage === "request" && (
          <form className="space-y-3" onSubmit={requestEmailLink}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              Send magic link
            </Button>
          </form>
        )}

        {method === "email" && stage === "verify" && (
          <p className="text-sm text-muted-foreground">
            Check {email} for a sign-in link.
          </p>
        )}

        {method === "phone" && stage === "request" && (
          <form className="space-y-3" onSubmit={requestPhoneOtp}>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+15005550001"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              Send code
            </Button>
          </form>
        )}

        {method === "phone" && stage === "verify" && (
          <form className="space-y-3" onSubmit={verifyPhoneOtp}>
            <div className="space-y-1.5">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                inputMode="numeric"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              Verify
            </Button>
          </form>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {TEST_LOGIN_ENABLED && (
          <>
            <Separator />
            <div className="space-y-1.5">
              <Button
                type="button"
                variant="secondary"
                disabled={loading}
                onClick={handleTestLogin}
                className="w-full"
              >
                Test login <Badge variant="warning">DEV</Badge>
              </Button>
              <p className="text-xs text-muted-foreground">
                Local/dev only — signs in with a Supabase test_otp number,
                not a real phone or email.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
