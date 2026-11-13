"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, Crop, ImageUp, Loader2, Trash2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateUser } from "@/lib/auth-client";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import type { SessionUser } from "@/lib/session";
import { profileSchema, type ProfileInput } from "@/lib/validations";
import { api, errorMessage } from "@/utils/api-client";
import { initials } from "@/utils/format";

import { PhotoCropper } from "./photo-cropper";

/** The small camera button on the photo's lower right. */
const BADGE =
  "absolute -bottom-0.5 -right-0.5 flex size-8 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

type ProfileUser = Pick<SessionUser, "id" | "name" | "email" | "username" | "image">;

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
  // Removing is a change like any other: it happens on Save, and can be undone till then.
  const [removePhoto, setRemovePhoto] = useState(false);
  // The photo as picked, uncropped: what the cropper opens on, so a second
  // adjustment starts from the whole photo rather than the last crop.
  const [original, setOriginal] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user.name, username: user.username ?? "" },
  });

  // Reset local state whenever the dialog opens against a fresh user snapshot.
  useEffect(() => {
    if (!open) return;
    reset({ name: user.name, username: user.username ?? "" });
    setPreview(null);
    setPendingFile(null);
    setOriginal(null);
    setCropSrc(null);
    setRemovePhoto(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [open, user.name, user.username, reset]);

  // Drop object URLs when the preview changes or the dialog unmounts.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);
  useEffect(() => {
    return () => {
      if (original) URL.revokeObjectURL(original);
    };
  }, [original]);

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

    // Choose the part to show before anything changes.
    const url = URL.createObjectURL(file);
    setOriginal(url);
    setCropSrc(url);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function applyCrop(file: File) {
    setPendingFile(file);
    setPreview(URL.createObjectURL(file));
    setCropSrc(null);
    setRemovePhoto(false);
  }

  function markRemoved() {
    setPendingFile(null);
    setPreview(null);
    setOriginal(null);
    // Only a saved photo has anything to remove on Save.
    setRemovePhoto(Boolean(user.image));
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

      if (values.username !== (user.username ?? "")) {
        // Checked by the server too: the format, and that nobody has it.
        // Both: on an update the plugin changes only the fields it is sent,
        // and the shown name (displayUsername) would stay the old one.
        const { error } = await updateUser({
          username: values.username,
          displayUsername: values.username,
        });
        if (error?.code === "USERNAME_IS_ALREADY_TAKEN") {
          setError("username", { message: "That username is taken — try another" });
          return;
        }
        if (error) {
          toast.error(error.message ?? "Could not update your username");
          return;
        }
      }

      if (removePhoto) {
        await api.delete("/api/me/avatar");
        const { error } = await updateUser({ image: null });
        if (error) {
          toast.error(error.message ?? "Photo removed, but the session did not refresh");
        }
      } else if (pendingFile) {
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

  const displayImage = removePhoto ? null : (preview ?? user.image);
  const busy = isSubmitting;
  const cropping = cropSrc !== null;
  const choosePhoto = () => fileInputRef.current?.click();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        // Into the name, not onto the photo: a ring round the avatar on open
        // read as a selection.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById("profile-name")?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
          <DialogDescription>
            Update how you appear to the team. Your email cannot be changed
            here.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          {cropping && (
            <PhotoCropper src={cropSrc} onCancel={() => setCropSrc(null)} onApply={applyCrop} />
          )}
          <div className={cropping ? "hidden" : "flex flex-col items-center gap-2"}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => pickFile(event.target.files?.[0])}
            />
            <div className="relative">
              {displayImage ? (
                // Click to see it larger and choose again what shows.
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCropSrc(original ?? user.image)}
                  className="group relative block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label="View and adjust photo"
                  title="View and adjust photo"
                >
                  <Avatar className="size-24">
                    <AvatarImage src={displayImage} alt="" />
                    <AvatarFallback className="text-xl">{initials(user.name)}</AvatarFallback>
                  </Avatar>
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Crop className="size-5" />
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={choosePhoto}
                  className="block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label="Upload photo"
                  title="Upload photo"
                >
                  <Avatar className="size-24">
                    <AvatarFallback className="text-xl">{initials(user.name)}</AvatarFallback>
                  </Avatar>
                </button>
              )}

              {/* Everything about the photo in one place, on the photo. */}
              {displayImage ? (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button type="button" disabled={busy} aria-label="Photo options" title="Photo options" className={BADGE}>
                      <Camera className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="right" className="w-48">
                    <DropdownMenuItem onSelect={() => setCropSrc(original ?? user.image)}>
                      <Crop className="mr-2 size-4" /> View &amp; adjust
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={choosePhoto}>
                      <ImageUp className="mr-2 size-4" /> Upload new photo
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={markRemoved}
                      className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                    >
                      <Trash2 className="mr-2 size-4" /> Remove photo
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <button type="button" disabled={busy} onClick={choosePhoto} aria-label="Upload photo" title="Upload photo" className={BADGE}>
                  <Camera className="size-4" />
                </button>
              )}
            </div>

            {removePhoto ? (
              <p className="text-xs text-muted-foreground" role="status">
                Your photo will be removed when you save ·{" "}
                <button
                  type="button"
                  onClick={() => setRemovePhoto(false)}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  Undo
                </button>
              </p>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                {displayImage ? "Click the photo to adjust it · " : ""}PNG, JPEG, GIF or WebP · up to{" "}
                {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB
              </p>
            )}
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
            <Label htmlFor="profile-username">Username</Label>
            <Input
              id="profile-username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={Boolean(errors.username)}
              disabled={busy}
              {...register("username")}
            />
            {errors.username ? (
              <p className="text-xs text-destructive">{errors.username.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">You can sign in with this or your email.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={user.email} disabled readOnly />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={busy || cropping}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
