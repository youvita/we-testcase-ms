"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { signIn } from "@/lib/auth-client";
import { isEmailLogin, loginSchema, type LoginInput } from "@/lib/validations";

const ERROR_MESSAGES: Record<string, string> = {
  "account-disabled":
    "That account has been disabled. Contact an administrator.",
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);

  const initialError = searchParams.get("error");
  const redirectTo = searchParams.get("redirect");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { login: "", password: "" },
  });

  async function onSubmit(values: LoginInput) {
    setFormError(null);

    // One box for both: an @ means an email, anything else a username.
    const { error } = isEmailLogin(values.login)
      ? await signIn.email({ email: values.login, password: values.password })
      : await signIn.username({ username: values.login, password: values.password });

    if (error) {
      // One message for an unknown account and a wrong password — don't
      // reveal which one it was, or that the username exists.
      setFormError(
        error.status === 401 || error.status === 422 || error.status === 400
          ? "Wrong email, username or password"
          : (error.message ?? "Could not sign in"),
      );
      return;
    }

    toast.success("Signed in");

    // Only honour internal redirects; an absolute URL here would be an open
    // redirect.
    const target =
      redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
        ? redirectTo
        : "/dashboard";

    router.push(target);
    router.refresh();
  }

  const banner = formError ?? (initialError ? ERROR_MESSAGES[initialError] : null);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Enter your credentials to reach your test projects.
        </p>
      </div>

      {banner && (
        <Alert variant="destructive">
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="login">Email or username</Label>
          <Input
            id="login"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="you@company.com or username"
            aria-invalid={Boolean(errors.login)}
            {...register("login")}
          />
          {errors.login && (
            <p className="text-xs text-destructive">{errors.login.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password)}
            {...register("password")}
          />
          {errors.password && (
            <p className="text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          Sign in
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        No account yet?{" "}
        <Link
          href="/register"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
