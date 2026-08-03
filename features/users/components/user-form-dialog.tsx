"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Controller,
  useForm,
  type FieldValues,
  type Path,
  type UseFormSetError,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_VALUES,
  ROLES,
  type Role,
} from "@/lib/constants";
import {
  userCreateSchema,
  userUpdateSchema,
  type UserCreateInput,
  type UserUpdateInput,
} from "@/lib/validations";
import type { PublicUser } from "@/types";
import { ApiError, api, errorMessage } from "@/utils/api-client";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------


/**
 * Put a failed mutation in front of the user.
 *
 * Server-side `fieldErrors` land on the matching form fields; anything else
 * (409 conflicts, business-rule 400s, network failures) becomes a toast so no
 * error is ever swallowed.
 */
function reportMutationError<T extends FieldValues>(
  error: unknown,
  fields: readonly Path<T>[],
  setError: UseFormSetError<T>,
): void {
  if (error instanceof ApiError && error.fieldErrors) {
    let applied = false;
    for (const field of fields) {
      const message = error.fieldErrors[field as string]?.[0];
      if (message) {
        setError(field, { type: "server", message });
        applied = true;
      }
    }
    if (applied) return;
  }
  toast.error(errorMessage(error));
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

/** Role picker with the role's responsibilities shown as helper text. */
function RoleField({
  value,
  onChange,
  disabled,
  error,
}: {
  value: Role | undefined;
  onChange: (role: Role) => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="role">Role</Label>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as Role)}
        disabled={disabled}
      >
        <SelectTrigger id="role" aria-invalid={Boolean(error)}>
          <SelectValue placeholder="Select a role" />
        </SelectTrigger>
        <SelectContent>
          {ROLE_VALUES.map((role) => (
            <SelectItem key={role} value={role}>
              {ROLE_LABELS[role]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && !error && (
        <p className="text-xs text-muted-foreground">
          {ROLE_DESCRIPTIONS[value]}
        </p>
      )}
      <FieldError message={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const CREATE_FIELDS = ["name", "email", "password", "role"] as const;

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UserCreateInput>({
    resolver: zodResolver(userCreateSchema),
    defaultValues: { name: "", email: "", password: "", role: ROLES.QA },
  });

  async function onSubmit(values: UserCreateInput) {
    try {
      await api.post<PublicUser>("/api/users", values);
      toast.success(`${values.name} was added`);
      onDone();
      router.refresh();
    } catch (error) {
      reportMutationError<UserCreateInput>(error, CREATE_FIELDS, setError);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="name">Full name</Label>
        <Input
          id="name"
          autoComplete="off"
          placeholder="Quinn Tester"
          aria-invalid={Boolean(errors.name)}
          {...register("name")}
        />
        <FieldError message={errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="off"
          placeholder="quinn@company.com"
          aria-invalid={Boolean(errors.email)}
          {...register("email")}
        />
        <FieldError message={errors.email?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Temporary password</Label>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.password)}
          {...register("password")}
        />
        <FieldError message={errors.password?.message} />
        {!errors.password && (
          <p className="text-xs text-muted-foreground">
            At least 8 characters. Share it with the user so they can sign in.
          </p>
        )}
      </div>

      <Controller
        control={control}
        name="role"
        render={({ field }) => (
          <RoleField
            value={field.value}
            onChange={field.onChange}
            disabled={isSubmitting}
            {...(errors.role?.message ? { error: errors.role.message } : {})}
          />
        )}
      />

      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          Create user
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

const UPDATE_FIELDS = ["name", "role", "isActive"] as const;

function EditUserForm({
  user,
  isSelf,
  onDone,
}: {
  user: PublicUser;
  isSelf: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UserUpdateInput>({
    resolver: zodResolver(userUpdateSchema),
    defaultValues: {
      name: user.name,
      role: user.role,
      isActive: user.isActive,
    },
  });

  async function onSubmit(values: UserUpdateInput) {
    try {
      await api.patch<PublicUser>(`/api/users/${user.id}`, values);
      toast.success("User updated");
      onDone();
      router.refresh();
    } catch (error) {
      reportMutationError<UserUpdateInput>(error, UPDATE_FIELDS, setError);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="name">Full name</Label>
        <Input
          id="name"
          autoComplete="off"
          aria-invalid={Boolean(errors.name)}
          {...register("name")}
        />
        <FieldError message={errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label>Email</Label>
        <Input value={user.email} disabled readOnly />
        <p className="text-xs text-muted-foreground">
          Email addresses cannot be changed here.
        </p>
      </div>

      <Controller
        control={control}
        name="role"
        render={({ field }) => (
          <RoleField
            value={field.value}
            onChange={field.onChange}
            disabled={isSubmitting}
            {...(errors.role?.message ? { error: errors.role.message } : {})}
          />
        )}
      />

      <Controller
        control={control}
        name="isActive"
        render={({ field }) => (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="isActive"
                checked={field.value ?? true}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                disabled={isSubmitting || isSelf}
              />
              <Label htmlFor="isActive">Account is active</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {isSelf
                ? "You cannot disable your own account."
                : "Disabled users keep their history but cannot sign in."}
            </p>
            <FieldError message={errors.isActive?.message} />
          </div>
        )}
      />

      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          Save changes
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Dialog shell
// ---------------------------------------------------------------------------

type UserFormDialogBaseProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Id of the signed-in admin. When it matches the edited user, the controls
   * the API would reject (self-disable) are disabled instead of offered.
   */
  currentUserId?: string;
};

export type UserFormDialogProps = UserFormDialogBaseProps &
  ({ mode: "create"; user?: undefined } | { mode: "edit"; user: PublicUser });

/**
 * Controlled create/edit dialog for a user.
 *
 * Create posts to `/api/users`; edit patches `/api/users/{id}` and never offers
 * a password field — there is no endpoint for changing another user's password.
 */
export function UserFormDialog(props: UserFormDialogProps) {
  const { open, onOpenChange } = props;
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {props.mode === "create" ? "Add user" : "Edit user"}
          </DialogTitle>
          <DialogDescription>
            {props.mode === "create"
              ? "Create an account and choose what the person can do."
              : `Update the name, role and status for ${props.user.name}.`}
          </DialogDescription>
        </DialogHeader>

        {props.mode === "create" ? (
          <CreateUserForm onDone={close} />
        ) : (
          <EditUserForm
            key={props.user.id}
            user={props.user}
            isSelf={props.user.id === props.currentUserId}
            onDone={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Self-contained "Add user" button that owns its own dialog state — convenient
 * for a server-rendered page header.
 */
export function CreateUserButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button className={className} onClick={() => setOpen(true)}>
        <UserPlus className="mr-2 size-4" aria-hidden />
        Add user
      </Button>
      <UserFormDialog mode="create" open={open} onOpenChange={setOpen} />
    </>
  );
}
