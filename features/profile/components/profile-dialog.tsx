"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateUser } from "@/lib/auth-client";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import type { SessionUser } from "@/lib/session";
import { profileSchema, type ProfileInput } from "@/lib/validations";
import { api, errorMessage } from "@/utils/api-client";
import { initials } from "@/utils/format";

type ProfileUser = Pick<SessionUser, "id" | "name" | "email" | "image">;

export function ProfileDialog({
  user,
  open,
  onOpenChange,
}: {
  user: ProfileUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [removing, setRemoving] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user.name },
  });

  // Reset local state whenever the dialog opens against a fresh user snapshot.
  useEffect(() => {
    if (!open) return;
    reset({ name: user.name });
    setPreview(null);
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [open, user.name, reset]);

  // Drop object URLs when the preview changes or the dialog unmounts.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function pickFile(file: File | undefined) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Choose a PNG, JPEG, GIF or WebP image");
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(
        `Profile pictures must be ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB or smaller`,
      );
      return;
    }

    if (preview) URL.revokeObjectURL(preview);
    setPendingFile(file);
    setPreview(URL.createObjectURL(file));
  }

  async function onSubmit(values: ProfileInput) {
    try {
      if (values.name !== user.name) {
        const { error } = await updateUser({ name: values.name });
        if (error) {
          toast.error(error.message ?? "Could not update your name");
          return;
        }
      }

      if (pendingFile) {
        const form = new FormData();
        form.append("file", pendingFile);
        const updated = await api.post<{ image: string | null }>(
          "/api/me/avatar",
          form,
        );
        // Keep the session cookie's user payload in step with the database.
        const { error } = await updateUser({ image: updated.image });
        if (error) {
          toast.error(error.message ?? "Photo saved, but the session did not refresh");
        }
      }

      toast.success("Profile updated");
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function handleRemovePhoto() {
    setRemoving(true);
    try {
      await api.delete("/api/me/avatar");
      await updateUser({ image: null });
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.success("Profile picture removed");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRemoving(false);
    }
  }

  const displayImage = preview ?? user.image;
  const busy = isSubmitting || removing;
  const hasPhoto = Boolean(displayImage);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
          <DialogDescription>
            Update how you appear to the team. Your email cannot be changed
            here.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <div className="flex flex-col items-center gap-3">
            <Avatar className="size-20">
              {displayImage && <AvatarImage src={displayImage} alt="" />}
              <AvatarFallback className="text-lg">
                {initials(user.name)}
              </AvatarFallback>
            </Avatar>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="sr-only"
                onChange={(event) => pickFile(event.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera className="mr-2 size-4" />
                {hasPhoto ? "Change photo" : "Upload photo"}
              </Button>
              {hasPhoto && !pendingFile && user.image && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleRemovePhoto()}
                >
                  {removing ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 size-4" />
                  )}
                  Remove
                </Button>
              )}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              PNG, JPEG, GIF or WebP · up to{" "}
              {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-name">Full name</Label>
            <Input
              id="profile-name"
              autoComplete="name"
              aria-invalid={Boolean(errors.name)}
              disabled={busy}
              {...register("name")}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={user.email} disabled readOnly />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
