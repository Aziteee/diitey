import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

interface ArticleScrollNavProps {
  readonly title: string;
}

interface HeadingItem {
  readonly id: string;
  readonly label: string;
}

interface SectionGeometry {
  readonly top: number;
  readonly height: number;
}

interface SegmentLayout {
  readonly idx: number;
  readonly offset: number;
  readonly size: number;
  readonly end: number;
}

const emptyGeometry: readonly SectionGeometry[] = [];
const CLICK_DURATION_MS = 600;
const READING_OFFSET_RATIO = 0.22;
const SEGMENT_GAP_PX = 3;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export default function ArticleScrollNav({ title }: ArticleScrollNavProps) {
  const [headings, setHeadings] = useState<readonly HeadingItem[]>([]);
  const [geometry, setGeometry] = useState<readonly SectionGeometry[]>(
    emptyGeometry,
  );
  const [progress, setProgress] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [railHeight, setRailHeight] = useState(0);

  const geometryRef = useRef(emptyGeometry);
  const draggingRef = useRef(false);
  const scrollFrameRef = useRef(0);
  const hideTimerRef = useRef(0);
  const hoverTimerRef = useRef(0);
  const animFrameRef = useRef(0);
  const animCleanupRef = useRef<(() => void) | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);

  useEffect(() => {
    geometryRef.current = geometry;
  }, [geometry]);

  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);

  useEffect(() => {
    const article = document.querySelector<HTMLElement>(".post-page article");
    const titleHeading = document.querySelector<HTMLElement>(
      "[data-scroll-heading]",
    );
    const content = document.querySelector<HTMLElement>(".post-content");
    if (!article || !titleHeading || !content) return;

    const collectHeadings = () => {
      const usedIds = new Set<string>();
      const next: HeadingItem[] = [];
      const titleLabel = (titleHeading.textContent || "").trim() || title;
      const titleId = uniqueHeadingId(
        titleHeading.id || "post-title",
        usedIds,
      );
      titleHeading.id = titleId;
      next.push({ id: titleId, label: titleLabel });

      for (const heading of content.querySelectorAll<HTMLElement>(":scope > h2")) {
        const label = (heading.textContent || "").trim() || title;
        const id = uniqueHeadingId(heading.id || slugify(label), usedIds);
        heading.id = id;
        next.push({ id, label });
      }

      setHeadings((prev) =>
        prev.length === next.length
          && prev.every((item, index) =>
            item.id === next[index]?.id && item.label === next[index]?.label
          )
          ? prev
          : next
      );
    };

    collectHeadings();
    window.addEventListener("resize", collectHeadings);
    return () => window.removeEventListener("resize", collectHeadings);
  }, [title]);

  const measureGeometry = useCallback(() => {
    if (headings.length === 0) {
      setGeometry(emptyGeometry);
      return;
    }

    const nodes = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((node): node is HTMLElement => node !== null);
    if (nodes.length !== headings.length) return;

    const article = document.querySelector<HTMLElement>(".post-page article");
    const contentBottom = article
      ? article.getBoundingClientRect().bottom + window.scrollY
      : document.documentElement.scrollHeight;
    const tops = nodes.map(
      (node) => node.getBoundingClientRect().top + window.scrollY,
    );
    const next = tops.map((top, index) => ({
      top,
      height: Math.max(
        1,
        (index + 1 < tops.length ? tops[index + 1]! : contentBottom) - top,
      ),
    }));
    setGeometry(next);
    setReady(true);
  }, [headings]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(measureGeometry);
    const article = document.querySelector<HTMLElement>(".post-page article");
    const observer = new ResizeObserver(measureGeometry);
    if (article) observer.observe(article);
    window.addEventListener("resize", measureGeometry);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measureGeometry);
    };
  }, [measureGeometry]);

  useEffect(() => {
    if (geometry.length === 0) return;

    const updateFromScroll = () => {
      scrollFrameRef.current = 0;
      const readingOffset = window.innerHeight * READING_OFFSET_RATIO;
      const next = computeProgress(geometryRef.current, {
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
        pageScrollHeight: document.documentElement.scrollHeight,
        readingOffset,
      });
      setProgress(next.progress);
      setActiveIndex(next.activeIndex);
    };

    const handleScroll = () => {
      if (scrollFrameRef.current !== 0) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      scrollFrameRef.current = window.requestAnimationFrame(updateFromScroll);
      setScrolling(true);
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => setScrolling(false), 900);
    };

    updateFromScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollFrameRef.current !== 0) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      window.clearTimeout(hideTimerRef.current);
    };
  }, [geometry]);

  useEffect(() => {
    return () => {
      animCleanupRef.current?.();
      if (animFrameRef.current !== 0) {
        window.cancelAnimationFrame(animFrameRef.current);
      }
      window.clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const segments = useMemo<readonly SegmentLayout[]>(() => {
    const total = geometry.reduce((sum, section) => sum + section.height, 0)
      || 1;
    let cursor = 0;
    return geometry.map((section, idx) => {
      const offset = cursor / total;
      const size = section.height / total;
      cursor += section.height;
      return { idx, offset, size, end: offset + size };
    });
  }, [geometry]);

  const labelTops = useMemo(() => {
    if (segments.length === 0 || railHeight === 0) return [] as number[];
    const positions = segments.map((segment) => segment.offset * railHeight);
    for (let index = 1; index < positions.length; index += 1) {
      if (positions[index]! < positions[index - 1]! + 18) {
        positions[index] = positions[index - 1]! + 18;
      }
    }
    const maxTop = railHeight - 9;
    for (let index = positions.length - 1; index >= 0; index -= 1) {
      const limit = index === positions.length - 1
        ? maxTop
        : positions[index + 1]! - 18;
      if (positions[index]! > limit) positions[index] = limit;
    }
    positions[0] = Math.max(positions[0]!, 9);
    return positions;
  }, [segments, railHeight]);

  useEffect(() => {
    const node = railRef.current;
    if (!node) return;
    const update = () => setRailHeight(node.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ready, headings.length]);

  const cancelAnimation = useCallback(() => {
    if (animFrameRef.current !== 0) {
      window.cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    animCleanupRef.current?.();
    animCleanupRef.current = null;
    setAnimating(false);
  }, []);

  const animateScrollTo = useCallback((getTarget: () => number) => {
    cancelAnimation();
    setAnimating(true);

    let cancelled = false;
    const cancelSignals = ["wheel", "touchstart", "keydown"] as const;
    const onUserIntent = () => {
      cancelled = true;
    };
    for (const signal of cancelSignals) {
      window.addEventListener(signal, onUserIntent, { passive: true });
    }

    const cleanup = () => {
      if (animFrameRef.current !== 0) {
        window.cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
      for (const signal of cancelSignals) {
        window.removeEventListener(signal, onUserIntent);
      }
      animCleanupRef.current = null;
      setAnimating(false);
    };
    animCleanupRef.current = cleanup;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    const duration = reduceMotion ? 0 : CLICK_DURATION_MS;
    const startY = window.scrollY;
    let startedAt: number | null = null;

    const tick = (now: number) => {
      if (cancelled) {
        cleanup();
        return;
      }
      if (startedAt === null) startedAt = now;
      const t = duration <= 0 ? 1 : Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - t) ** 3;
      const target = getTarget();
      window.scrollTo(0, startY + (target - startY) * eased);
      if (t < 1) {
        animFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }

      // Hold the final position briefly while layout settles, like x.ai.
      let pinFrame = 0;
      let pinScrollY = window.scrollY;
      let pinning = false;
      const pin = () => {
        pinning = true;
        window.scrollTo(0, getTarget());
        pinScrollY = window.scrollY;
        pinFrame = window.requestAnimationFrame(() => {
          pinning = false;
        });
      };
      const onScroll = () => {
        if (!pinning && Math.abs(window.scrollY - pinScrollY) > 2) {
          window.removeEventListener("scroll", onScroll);
          observer.disconnect();
          window.clearTimeout(holdTimer);
          cleanup();
        }
      };
      const observer = new ResizeObserver(pin);
      const article = document.querySelector<HTMLElement>(".post-page article");
      observer.observe(article ?? document.body);
      window.addEventListener("scroll", onScroll, { passive: true });
      pin();
      const holdTimer = window.setTimeout(() => {
        window.removeEventListener("scroll", onScroll);
        observer.disconnect();
        if (pinFrame !== 0) window.cancelAnimationFrame(pinFrame);
        cleanup();
      }, 1200);

      const previousCleanup = cleanup;
      animCleanupRef.current = () => {
        window.removeEventListener("scroll", onScroll);
        observer.disconnect();
        window.clearTimeout(holdTimer);
        if (pinFrame !== 0) window.cancelAnimationFrame(pinFrame);
        previousCleanup();
      };
    };

    animFrameRef.current = window.requestAnimationFrame(tick);
  }, [cancelAnimation]);

  const scrollToHeading = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    animateScrollTo(() =>
      Math.max(
        0,
        target.getBoundingClientRect().top + window.scrollY
          - window.innerHeight * READING_OFFSET_RATIO,
      )
    );
  };

  const scrollToRatio = (ratio: number) => {
    const next = clamp(ratio);
    const readingOffset = window.innerHeight * READING_OFFSET_RATIO;
    window.scrollTo({
      top: scrollYForRatio(geometryRef.current, {
        ratio: next,
        readingOffset,
      }),
      behavior: "auto",
    });
  };

  const updateFromPointer = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    scrollToRatio((event.clientY - rect.top) / rect.height);
  };

  const handlePointerDown = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0 || geometryRef.current.length === 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    dragStartYRef.current = event.clientY;
    dragMovedRef.current = false;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientY - rect.top) / rect.height);
    animateScrollTo(() =>
      scrollYForRatio(geometryRef.current, {
        ratio,
        readingOffset: window.innerHeight * READING_OFFSET_RATIO,
      })
    );
  };

  const handlePointerMove = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>,
  ) => {
    if (!draggingRef.current) return;
    if (!dragMovedRef.current) {
      const startY = dragStartYRef.current ?? event.clientY;
      if (Math.abs(event.clientY - startY) < 4) return;
      dragMovedRef.current = true;
      cancelAnimation();
    }
    updateFromPointer(event);
  };

  const finishDragging = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>,
  ) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    dragStartYRef.current = null;
    dragMovedRef.current = false;
  };

  const handleRailKeyDown = (
    event: JSX.TargetedKeyboardEvent<HTMLDivElement>,
  ) => {
    const steps: Readonly<Record<string, number>> = {
      ArrowUp: -0.025,
      ArrowDown: 0.025,
      PageUp: -0.12,
      PageDown: 0.12,
      Home: -1,
      End: 1,
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    cancelAnimation();
    scrollToRatio(
      event.key === "Home" ? 0 : event.key === "End" ? 1 : progress + step,
    );
  };

  const showLabels = hovering || dragging;
  const showRail = scrolling || hovering || dragging || animating;
  const navVisible = ready && (showRail || showLabels);

  if (headings.length < 2 || segments.length < 2) return null;

  return (
    <nav
      aria-label="文章章节"
      class={[
        "pointer-events-none fixed top-1/2 right-0 z-40 hidden h-[72vh] max-h-[52rem] min-h-[26rem] w-[17.5rem] -translate-y-1/2 text-[color:var(--ink)] transition-opacity duration-[360ms] ease-[cubic-bezier(0.16,1,0.3,1)] xl:block",
        dragging ? "select-none" : "",
        navVisible ? "opacity-100" : "opacity-0",
      ].filter(Boolean).join(" ")}
      onMouseEnter={() => {
        window.clearTimeout(hoverTimerRef.current);
        setHovering(true);
      }}
      onMouseLeave={() => {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = window.setTimeout(() => setHovering(false), 200);
      }}
    >
      <div
        aria-hidden="true"
        class={[
          "pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent to-[color:var(--paper)] transition-opacity duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] [mask-image:linear-gradient(to_bottom,transparent_0%,black_15%,black_85%,transparent_100%)]",
          showLabels ? "opacity-[0.82]" : "opacity-0",
        ].join(" ")}
      />
      <div class="pointer-events-none absolute inset-y-0 right-8 left-4">
        {segments.map((segment) => {
          const heading = headings[segment.idx];
          if (!heading) return null;
          const top = labelTops[segment.idx];
          const reached = segment.idx <= activeIndex;
          return (
            <button
              type="button"
              class={[
                "absolute right-0 max-w-full truncate border-0 bg-transparent p-0 text-right font-sans text-xs leading-tight tracking-[-0.01em] transition-colors duration-200",
                reached
                  ? "text-[color:var(--ink)]"
                  : "text-neutral-500 dark:text-neutral-500",
                showLabels
                  ? [
                    "pointer-events-auto -translate-y-1/2",
                    reached ? "opacity-100" : "opacity-80",
                  ].join(" ")
                  : "pointer-events-none translate-x-1 -translate-y-1/2 opacity-0",
                "cursor-default hover:text-[color:var(--heading)] focus-visible:text-[color:var(--heading)] focus-visible:outline-none hover:-translate-x-0.5 hover:-translate-y-1/2 focus-visible:-translate-x-0.5 focus-visible:-translate-y-1/2",
              ].join(" ")}
              style={{
                top: top === undefined
                  ? `${segment.offset * 100}%`
                  : `${top}px`,
                transition:
                  `color 200ms ease, opacity 220ms ${EASE}, transform 260ms ${EASE}`,
              }}
              aria-current={segment.idx === activeIndex ? "location" : undefined}
              onClick={() => scrollToHeading(heading.id)}
            >
              {heading.label}
            </button>
          );
        })}
      </div>
      <div
        ref={railRef}
        class="pointer-events-auto absolute inset-y-0 right-0 w-6 cursor-default touch-none outline-none"
        role="scrollbar"
        aria-label="文章滚动进度"
        aria-controls="post-content"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDragging}
        onPointerCancel={finishDragging}
        onKeyDown={handleRailKeyDown}
      >
        <div
          class={[
            "pointer-events-none absolute inset-y-0 right-3 transition-[width,opacity] ease-[cubic-bezier(0.16,1,0.3,1)]",
            showRail
              ? "opacity-100 duration-200"
              : "opacity-0 duration-500",
          ].join(" ")}
          style={{
            width: showLabels ? "0.1875rem" : "0.130rem",
            transitionDuration: showRail ? "350ms, 200ms" : "350ms, 500ms",
          }}
        >
          {segments.map((segment) => (
            <span
              class={[
                "absolute inset-x-0 rounded-full transition-colors duration-300",
                showLabels
                  ? "bg-[color-mix(in_srgb,var(--ink)_25%,transparent)]"
                  : "bg-[color-mix(in_srgb,var(--ink)_15%,transparent)]",
              ].join(" ")}
              style={{
                top: `${segment.offset * 100}%`,
                height: `calc(${segment.size * 100}% - ${SEGMENT_GAP_PX}px)`,
              }}
            />
          ))}
          {segments.map((segment) => {
            const fill = progress <= segment.offset
              ? 0
              : progress >= segment.end
              ? 1
              : (progress - segment.offset) / segment.size;
            const fillHeight = fill * segment.size * 100;
            return (
              <span
                class="absolute inset-x-0 rounded-full bg-[color:var(--ink)] transition-opacity duration-200 ease-out"
                style={{
                  top: `${segment.offset * 100}%`,
                  height: `calc(${fillHeight}% - ${SEGMENT_GAP_PX * fill}px)`,
                  opacity: fill > 0 ? 1 : 0,
                }}
              />
            );
          })}
        </div>
      </div>
    </nav>
  );
}

function computeProgress(
  sections: readonly SectionGeometry[],
  input: {
    readonly scrollY: number;
    readonly viewportHeight: number;
    readonly pageScrollHeight: number;
    readonly readingOffset: number;
  },
): { progress: number; activeIndex: number } {
  if (sections.length === 0) return { progress: 0, activeIndex: 0 };
  const readAt = input.scrollY + input.readingOffset;
  const firstTop = sections[0]!.top;
  const last = sections[sections.length - 1]!;
  const span = Math.max(last.top + last.height - firstTop, 1);
  const maxScroll = Math.max(0, input.pageScrollHeight - input.viewportHeight);
  const progress = clamp((readAt - firstTop) / span);
  let activeIndex = 0;
  for (let index = 0; index < sections.length; index += 1) {
    if (readAt >= sections[index]!.top) activeIndex = index;
  }
  if (input.scrollY >= maxScroll - 1) activeIndex = sections.length - 1;
  return { progress, activeIndex };
}

function scrollYForRatio(
  sections: readonly SectionGeometry[],
  input: { readonly ratio: number; readonly readingOffset: number },
): number {
  if (sections.length === 0) return 0;
  const firstTop = sections[0]!.top;
  const last = sections[sections.length - 1]!;
  const span = Math.max(last.top + last.height - firstTop, 1);
  return Math.max(0, firstTop + input.ratio * span - input.readingOffset);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

function uniqueHeadingId(candidate: string, usedIds: Set<string>): string {
  let id = candidate;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${candidate}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}
