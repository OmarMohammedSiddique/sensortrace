import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthFormFallback, RegisterForm } from "@/components/marketing/auth-forms";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <Suspense fallback={<AuthFormFallback />}>
      <RegisterForm />
    </Suspense>
  );
}
