"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Move, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui/button";

/** The square the person crops in, in CSS pixels; the circle fills it. */
const STAGE = 256;
/** The saved photo's size: sharp on a retina avatar, small to upload. */
const OUTPUT = 512;
const MAX_ZOOM = 4;

type Size = { width: number; height: number };
type Offset = { x: number; y: number };

/** Keeps the photo covering the whole square, so the crop has no empty edge. */
function clamp(offset: Offset, shown: Size): Offset {
  return {
    x: Math.min(0, Math.max(STAGE - shown.width, offset.x)),
    y: Math.min(0, Math.max(STAGE - shown.height, offset.y)),
  };
}

/**
 * View a photo and choose the part that shows in the round avatar: drag to
 * move it, zoom with the slider or the wheel. "Apply" hands back that square,
 * drawn at OUTPUT×OUTPUT, as a file ready to upload.
 */
export function PhotoCropper({
  src,
  onCancel,
  onApply,
}: {
  src: string;
  onCancel: () => void;
  onApply: (file: File) => void;
}) {
  const [natural, setNatural] = useState<Size | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; from: Offset; start: Offset } | null>(null);

  // At zoom 1 the photo's short side fits the square exactly.
  const scale = natural ? (STAGE / Math.min(natural.width, natural.height)) * zoom : 1;
  const shown: Size = natural
    ? { width: natural.width * scale, height: natural.height * scale }
    : { width: STAGE, height: STAGE };

  useEffect(() => {
    setNatural(null);
    setFailed(false);
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      const size = { width: image.naturalWidth, height: image.naturalHeight };
      const fit = STAGE / Math.min(size.width, size.height);
      setNatural(size);
      setZoom(1);
      // Centred to start.
      setOffset({ x: (STAGE - size.width * fit) / 2, y: (STAGE - size.height * fit) / 2 });
    };
    image.onerror = () => setFailed(true);
    image.src = src;
  }, [src]);

  /** Zoom about the middle of the circle, so what is centred stays centred. */
  const zoomTo = useCallback(
    (next: number) => {
      if (!natural) return;
      const target = Math.min(MAX_ZOOM, Math.max(1, next));
      const base = STAGE / Math.min(natural.width, natural.height);
      const before = base * zoom;
      const after = base * target;
      const centre = { x: (STAGE / 2 - offset.x) / before, y: (STAGE / 2 - offset.y) / before };
      setZoom(target);
      setOffset(
        clamp(
          { x: STAGE / 2 - centre.x * after, y: STAGE / 2 - centre.y * after },
          { width: natural.width * after, height: natural.height * after },
        ),
      );
    },
    [natural, zoom, offset],
  );

  // The wheel needs a non-passive listener to keep the dialog from scrolling.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomTo(zoom * Math.exp(-event.deltaY * 0.0015));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoom, zoomTo]);

  async function apply() {
    const image = imageRef.current;
    if (!image || !natural) return;
    setSaving(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is not available");
      context.imageSmoothingQuality = "high";
      const side = STAGE / scale;
      context.drawImage(image, -offset.x / scale, -offset.y / scale, side, side, 0, 0, OUTPUT, OUTPUT);
      // WebP where the browser can write it; others hand back PNG.
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
      if (!blob) throw new Error("Could not crop the photo");
      const type = blob.type === "image/webp" ? "image/webp" : "image/png";
      onApply(new File([blob], `avatar.${type === "image/webp" ? "webp" : "png"}`, { type }));
    } finally {
      setSaving(false);
    }
  }

  function nudge(dx: number, dy: number) {
    setOffset((current) => clamp({ x: current.x + dx, y: current.y + dy }, shown));
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={stageRef}
        tabIndex={0}
        role="application"
        aria-label="Photo crop area. Drag or use the arrow keys to move the photo; + and − to zoom."
        className="relative touch-none select-none overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ width: STAGE, height: STAGE, cursor: natural ? "grab" : "default" }}
        onPointerDown={(event) => {
          if (!natural) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointer: event.pointerId, from: offset, start: { x: event.clientX, y: event.clientY } };
          event.currentTarget.style.cursor = "grabbing";
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointer !== event.pointerId) return;
          setOffset(
            clamp(
              {
                x: current.from.x + event.clientX - current.start.x,
                y: current.from.y + event.clientY - current.start.y,
              },
              shown,
            ),
          );
        }}
        onPointerUp={(event) => {
          drag.current = null;
          event.currentTarget.style.cursor = "grab";
        }}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 20 : 5;
          const moves: Record<string, [number, number]> = {
            ArrowLeft: [step, 0],
            ArrowRight: [-step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
          };
          if (moves[event.key]) {
            event.preventDefault();
            nudge(...moves[event.key]!);
          } else if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            zoomTo(zoom + 0.1);
          } else if (event.key === "-") {
            event.preventDefault();
            zoomTo(zoom - 0.1);
          }
        }}
      >
        {natural ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview positioned by hand
          <img
            src={src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={{ left: offset.x, top: offset.y, width: shown.width, height: shown.height }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {failed ? "This photo could not be opened" : <Loader2 className="size-5 animate-spin" />}
          </div>
        )}
        {/* Dims what falls outside the avatar's circle. */}
        <div
          className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/80"
          style={{ boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.5)" }}
        />
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Move className="size-3.5" aria-hidden /> Drag to move · scroll or slide to zoom
      </p>

      <div className="flex w-full max-w-[256px] items-center gap-2">
        <button
          type="button"
          onClick={() => zoomTo(zoom - 0.25)}
          disabled={!natural || zoom <= 1}
          aria-label="Zoom out"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <ZoomOut className="size-4" />
        </button>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          disabled={!natural}
          onChange={(event) => zoomTo(Number(event.target.value))}
          aria-label="Zoom"
          className="h-1.5 flex-1 cursor-pointer accent-primary"
        />
        <button
          type="button"
          onClick={() => zoomTo(zoom + 0.25)}
          disabled={!natural || zoom >= MAX_ZOOM}
          aria-label="Zoom in"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <ZoomIn className="size-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => void apply()} disabled={!natural || saving}>
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}
          Apply
        </Button>
      </div>
    </div>
  );
}
