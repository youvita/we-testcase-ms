"use client";

import { useState } from "react";
import { Download, FileArchive, FileSpreadsheet, FileText, FileVideo, ImageIcon } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ALLOWED_UPLOAD_MIME_TYPES, isVideoMimeType } from "@/lib/constants";
import { withBasePath } from "@/lib/base-path";
import { formatBytes } from "@/utils/format";
import type { Attachment } from "@/types";

/**
 * Attachments as a plain list: an icon, the file name, and how big it is.
 *
 * No thumbnails — a wall of tiny frames says less about which file is which
 * than the name does, and every one of them costs a request against an
 * authenticated endpoint. The bytes are fetched only when a row is opened.
 */
export function AttachmentGallery({
  attachments,
}: {
  attachments: Attachment[];
}) {
  const [active, setActive] = useState<Attachment | null>(null);
  // The id of a video this browser could not play.
  const [unplayable, setUnplayable] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  return (
    <>
      <ul className="space-y-1">
        {attachments.map((attachment) => {
          const isVideo = isVideoMimeType(attachment.mimeType);
          const Icon = isVideo ? FileVideo : ImageIcon;

          // A document opens in a new tab (PDF, text) or downloads; only
          // pictures and video play here.
          if (!(ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(attachment.mimeType)) {
            const DocIcon = documentIcon(attachment.mimeType);
            return (
              <li key={attachment.id}>
                <a
                  href={withBasePath(`/api/attachments/${attachment.id}/file`)}
                  target="_blank"
                  rel="noopener"
                  className="flex w-full items-center gap-2 rounded text-left text-sm transition-colors hover:text-primary"
                >
                  <DocIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 truncate">{attachment.fileName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(attachment.fileSize)}
                  </span>
                </a>
              </li>
            );
          }

          return (
            <li key={attachment.id}>
              <button
                type="button"
                onClick={() => setActive(attachment)}
                className="flex w-full items-center gap-2 rounded text-left text-sm transition-colors hover:text-primary"
              >
                <Icon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 truncate">{attachment.fileName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatBytes(attachment.fileSize)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={Boolean(active)}
        onOpenChange={(open) => !open && setActive(null)}
      >
        <DialogContent className="max-w-4xl">
          <DialogTitle className="truncate pr-8 text-sm font-medium">
            {active?.fileName}
          </DialogTitle>
          {active && (
            <div className="overflow-auto">
              {isVideoMimeType(active.mimeType) ? (
                unplayable === active.id ? (
                  <div className="space-y-2 rounded-md border border-dashed px-4 py-8 text-center text-sm">
                    <p>This browser cannot play this video.</p>
                    <p className="text-muted-foreground">
                      Videos from automated runs are WebM. Update the browser or try another one, or download it.
                    </p>
                  </div>
                ) : (
                  <video
                    key={active.id}
                    src={withBasePath(`/api/attachments/${active.id}/file`)}
                    controls
                    playsInline
                    // A run's WebM does not state its length up front: with only
                    // its start loaded the player shows 0:00 on black and looks
                    // broken. Load it whole (they are small) — and no autoplay,
                    // which browsers block anyway and leave it looking stuck.
                    preload="auto"
                    onError={() => setUnplayable(active.id)}
                    className="mx-auto max-h-[75vh] w-auto rounded-md bg-black"
                  />
                )
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={withBasePath(`/api/attachments/${active.id}/file`)}
                  alt={active.fileName}
                  className="mx-auto max-h-[75vh] w-auto rounded-md"
                />
              )}
            </div>
          )}
          {active && (
            <p className="flex items-center gap-3 text-xs text-muted-foreground">
              {formatBytes(active.fileSize)} · {active.mimeType}
              <a
                href={withBasePath(`/api/attachments/${active.id}/file`)}
                download={active.fileName}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Download className="size-3.5" aria-hidden />
                Download
              </a>
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function documentIcon(mimeType: string) {
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv") {
    return FileSpreadsheet;
  }
  if (mimeType === "application/zip") return FileArchive;
  return FileText;
}
