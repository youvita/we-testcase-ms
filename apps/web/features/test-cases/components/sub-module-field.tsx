"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Select values for the two choices that are not a sub-module's name. */
const NONE = "__none__";
const NEW = "__new__";

/**
 * Pick one of the module's sub-modules from a list, or name a new one —
 * the same pattern as the Module field. With no sub-modules yet, it is
 * just a text field.
 */
export function SubModuleField({
  id,
  names,
  value,
  onChange,
  allowNone = false,
  invalid = false,
}: {
  id: string;
  /** The module's existing sub-modules. */
  names: string[];
  value: string;
  onChange: (value: string) => void;
  /** Offer "No sub-module" in the list (it is optional on a case). */
  allowNone?: boolean;
  invalid?: boolean;
}) {
  const known = names.includes(value.trim());
  // Typing a new one: chosen from the list, or a value the list does not have.
  const [naming, setNaming] = useState(false);
  const typing = names.length === 0 || naming || (value.trim() !== "" && !known);

  if (typing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={value}
          maxLength={120}
          autoComplete="off"
          placeholder="e.g. Create, Delete"
          aria-invalid={invalid}
          autoFocus={naming}
          onChange={(event) => onChange(event.target.value)}
        />
        {names.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setNaming(false);
              onChange("");
            }}
          >
            Pick existing
          </Button>
        )}
      </div>
    );
  }

  return (
    <Select
      value={value.trim() ? value.trim() : allowNone ? NONE : undefined}
      onValueChange={(next) => {
        if (next === NEW) {
          setNaming(true);
          onChange("");
        } else {
          onChange(next === NONE ? "" : next);
        }
      }}
    >
      <SelectTrigger id={id} aria-invalid={invalid}>
        <SelectValue placeholder="Choose a sub-module" />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>No sub-module</SelectItem>}
        {names.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={NEW} className="text-primary">
          + New sub-module…
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
