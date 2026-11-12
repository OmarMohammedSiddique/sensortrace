import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthFormFallback, SignInForm } from "@/components/marketing/auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <Suspense fallback={<AuthFormFallback />}>
      <SignInForm />
    </Suspense>
  );
}
