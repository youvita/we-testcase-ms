"use client";

import { useEffect, useState } from "react";
import { Loader2, Radio } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { withBasePath } from "@/lib/base-path";
import { api } from "@/utils/api-client";

const POLL_MS = 700;

type LiveItem = { itemId: string; at: number };

/**
 * What the browser shows right now, for each test of a run that is running
 * with "Watch live". The runner streams frames; this shows the newest.
 */
export function LiveView({
  runId,
  labels = {},
  quietWhenEmpty = false,
}: {
  runId: string;
  /** Item id → what to call it, e.g. "TC-LOGIN-0001 Login succeeds". */
  labels?: Record<string, string>;
  /** Render nothing until the first frame, instead of a waiting message. */
  quietWhenEmpty?: boolean;
}) {
  const [items, setItems] = useState<LiveItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await api.get<LiveItem[]>(`/api/test-runs/${runId}/live`);
        if (!cancelled) setItems(next);
      } catch {
        // Retried on the next tick.
      }
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId]);

  if (items.length === 0) {
    if (quietWhenEmpty) return null;
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Waiting for the browser to start…
      </p>
    );
  }

  return (
    <div className={items.length > 1 ? "grid gap-3 md:grid-cols-2" : "grid gap-3"}>
      {items.map((item) => (
        <figure key={item.itemId} className="overflow-hidden rounded-lg border bg-black">
          <figcaption className="flex items-center gap-2 bg-background px-3 py-1.5 text-xs">
            <Radio className="size-3.5 animate-pulse text-status-failed" />
            <span className="font-medium">Live</span>
            <span className="truncate text-muted-foreground">{labels[item.itemId] ?? ""}</span>
          </figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element -- a live frame, replaced several times a second */}
          <img
            src={withBasePath(`/api/run-items/${item.itemId}/live?t=${item.at}`)}
            alt="What the test's browser shows right now"
            className="w-full"
          />
        </figure>
      ))}
    </div>
  );
}

export type LiveChoice = { liveView: boolean; speed: "normal" | "slow" | "slower" };

/** "Watch live" and how fast to go — the same choice wherever a run starts. */
export function WatchLiveFields({
  value,
  onChange,
}: {
  value: LiveChoice;
  onChange: (value: LiveChoice) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          className="mt-0.5"
          checked={value.liveView}
          onCheckedChange={(checked) => onChange({ ...value, liveView: checked === true })}
        />
        <span>
          Watch live
          <span className="block text-xs text-muted-foreground">
            See the browser click through Web tests on the run page, as it happens. API tests have
            no browser to show. Off, everything runs in the background.
          </span>
        </span>
      </label>
      {value.liveView && (
        <div className="flex items-center gap-2 pl-6">
          <Label htmlFor="run-speed" className="text-xs font-normal text-muted-foreground">
            Speed
          </Label>
          <Select
            value={value.speed}
            onValueChange={(speed) => onChange({ ...value, speed: speed as LiveChoice["speed"] })}
          >
            <SelectTrigger id="run-speed" className="h-8 w-56 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Full speed</SelectItem>
              <SelectItem value="slow">Slow — 0.5 s between actions</SelectItem>
              <SelectItem value="slower">Slower — 1.2 s between actions</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
