"use client";

import { useState } from "react";
import { FileVideo, ImageIcon } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { isVideoMimeType } from "@/lib/constants";
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

  if (attachments.length === 0) return null;

  return (
    <>
      <ul className="space-y-1">
        {attachments.map((attachment) => {
          const isVideo = isVideoMimeType(attachment.mimeType);
          const Icon = isVideo ? FileVideo : ImageIcon;

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
                <video
                  src={`/api/attachments/${active.id}/file`}
                  controls
                  autoPlay
                  playsInline
                  className="mx-auto max-h-[75vh] w-auto rounded-md"
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/api/attachments/${active.id}/file`}
                  alt={active.fileName}
                  className="mx-auto max-h-[75vh] w-auto rounded-md"
                />
              )}
            </div>
          )}
          {active && (
            <p className="text-xs text-muted-foreground">
              {formatBytes(active.fileSize)} · {active.mimeType}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
