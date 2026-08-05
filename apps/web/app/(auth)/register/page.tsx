import type { Metadata } from "next";

import { RegisterForm } from "@/features/auth/components/register-form";
import { redirectIfSignedIn } from "@/lib/session";

export const metadata: Metadata = { title: "Create an account" };

export default async function RegisterPage() {
  await redirectIfSignedIn();

  return <RegisterForm />;
}
