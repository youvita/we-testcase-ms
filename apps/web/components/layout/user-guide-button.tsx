"use client";

import { useEffect, useState } from "react";
import { BookOpen, Download, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { withBasePath } from "@/lib/base-path";
import { cn } from "@/lib/utils";

/**
 * Built by scripts/user-guide, and rebuilt by CI on every push to main: the
 * PDF to download, and the same guide as a page to preview — a PDF inside a
 * page depends on the browser's viewer, and some phones show only page one.
 */
const GUIDE_URL = "/user-guide.pdf";
const PREVIEW_URL = "/user-guide.html";
const FILE_NAME = "WeTestCase user guide.pdf";

const OPEN_EVENT = "wtc:user-guide:open";

/**
 * "User guide" at the foot of the sidebar. It only asks for the preview: the
 * preview lives in the app's layout, so closing the phone menu the button sits
 * in (`onClick`) does not close the guide with it.
 */
export function UserGuideButton({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        onClick?.();
        window.dispatchEvent(new Event(OPEN_EVENT));
      }}
      data-tour="user-guide"
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/60 hover:text-white",
        className,
      )}
    >
      <BookOpen className="size-4 shrink-0" aria-hidden />
      User guide
    </button>
  );
}

/**
 * The guide in a preview to read through, with Download (the PDF) beside it,
 * so people see what it is before saving it. Mounted once, in the app layout.
 */
export function UserGuideDialog() {
  const [open, setOpen] = useState(false);
  const url = withBasePath(GUIDE_URL);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[92vh] max-w-5xl flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle>User guide</DialogTitle>
            <DialogDescription>
              How to use WeTestCase, page by page, with screenshots.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 size-4" />
                Open in new tab
              </a>
            </Button>
            <Button size="sm" asChild>
              <a href={url} download={FILE_NAME}>
                <Download className="mr-2 size-4" />
                Download
              </a>
            </Button>
          </div>
        </div>
        {/* Only rendered while open, so the guide loads when someone asks for it. */}
        {open && (
          <iframe
            src={withBasePath(PREVIEW_URL)}
            title="WeTestCase user guide"
            className="min-h-0 w-full flex-1 rounded-md border bg-muted"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
