import { SignInForm } from "@/components/auth/sign-in-form";
import { Logo } from "@/components/logo";

export default function SignInPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <Logo size={120} />
      <SignInForm />
    </div>
  );
}
