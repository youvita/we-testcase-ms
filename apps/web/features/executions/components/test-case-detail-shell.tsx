"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * Desktop layout for the test-case detail page.
 *
 * The header overlays both columns, solid white, so scrolling content passes
 * under it. The two columns scroll independently beneath, a line between them.
 * On smaller screens everything stacks and the page scrolls normally.
 */
export function TestCaseDetailShell({
  header,
  left,
  right,
}: {
  header: ReactNode;
  left: ReactNode;
  right: ReactNode;
}) {
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    const sync = () => setHeaderHeight(el.offsetHeight);
    sync();

    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="space-y-6 lg:relative lg:-my-8 lg:h-[calc(100dvh-3.5rem)] lg:space-y-0 lg:overflow-hidden"
      style={
        {
          // Only consumed on lg (see column padding classes) so mobile does not
          // double-count the in-flow header.
          "--detail-header-h": `${headerHeight}px`,
        } as CSSProperties
      }
    >
      {/*
        Header: in normal flow on mobile; absolute overlay on desktop so
        column content can scroll underneath it.
      */}
      <div
        ref={headerRef}
        className="z-10 space-y-3 border-b bg-background px-0 py-4 lg:absolute lg:inset-x-0 lg:top-0 lg:-mx-6 lg:px-6"
      >
        {header}
      </div>

      {/* A line between the columns on desktop, running from the header down. */}
      <div className="grid gap-6 lg:h-full lg:grid-cols-3 lg:gap-0 lg:overflow-hidden">
        <div className="space-y-6 lg:col-span-2 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pb-8 lg:pr-6 lg:pt-[calc(var(--detail-header-h)+1.5rem)]">
          {left}
        </div>

        <div className="space-y-6 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-l lg:pb-8 lg:pl-6 lg:pr-1 lg:pt-[calc(var(--detail-header-h)+1.5rem)]">
          {right}
        </div>
      </div>
    </div>
  );
}
