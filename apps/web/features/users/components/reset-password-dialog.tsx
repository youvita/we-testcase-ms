"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  userPasswordResetSchema,
  type UserPasswordResetInput,
} from "@/lib/validations";
import type { PublicUser } from "@/types";
import { ApiError, api, errorMessage } from "@/utils/api-client";

/**
 * Admin dialog that sets a new password for someone who has forgotten theirs.
 * The server also signs them out everywhere, so the admin hands over the new
 * password and the user signs in with it.
 */
export function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: PublicUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UserPasswordResetInput>({
    resolver: zodResolver(userPasswordResetSchema),
    defaultValues: { password: "" },
  });

  async function onSubmit(values: UserPasswordResetInput) {
    try {
      await api.post<{ reset: boolean }>(`/api/users/${user.id}/password`, values);
      toast.success(`${user.name}'s password was reset`);
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof ApiError ? error.fieldErrors?.password?.[0] : undefined;
      if (message) setError("password", { type: "server", message });
      else toast.error(errorMessage(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for {user.name} ({user.email}). They are signed
            out on every device and sign in again with this password.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="reset-password">New password</Label>
            <PasswordInput
              id="reset-password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              {...register("password")}
            />
            {errors.password?.message ? (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                At least 8 characters. Share it with the user, who can change it
                from their account menu.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
