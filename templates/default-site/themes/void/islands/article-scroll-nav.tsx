import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

interface ArticleScrollNavProps {
  readonly title: string;
}

interface Section {
  readonly id: string;
  readonly label: string;
  readonly start: number;
  readonly end: number;
}

interface ScrollMetrics {
  readonly sections: readonly Section[];
  readonly startScroll: number;
  readonly endScroll: number;
}

const emptyMetrics: ScrollMetrics = {
  sections: [],
  startScroll: 0,
  endScroll: 1,
};

export default function ArticleScrollNav({ title }: ArticleScrollNavProps) {
  const [metrics, setMetrics] = useState<ScrollMetrics>(emptyMetrics);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const article = document.querySelector<HTMLElement>(".post-page article");
    const titleHeading = document.querySelector<HTMLElement>(
      "[data-scroll-heading]",
    );
    const content = document.querySelector<HTMLElement>(".post-content");

    if (!article || !titleHeading || !content) return;

    let frame = 0;
    let hideTimer = 0;
    let currentMetrics = emptyMetrics;

    const updateProgress = () => {
      frame = 0;
      const span = currentMetrics.endScroll - currentMetrics.startScroll;
      const next = span <= 0
        ? 0
        : clamp((window.scrollY - currentMetrics.startScroll) / span);
      setProgress(next);
    };

    const handleScroll = () => {
      setScrolling(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setScrolling(false), 900);
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(updateProgress);
    };

    const measure = () => {
      const headings = [
        titleHeading,
        ...Array.from(content.querySelectorAll<HTMLElement>(":scope > h2")),
      ];
      const usedIds = new Set<string>();
      const pageTop = window.scrollY;
      const articleRect = article.getBoundingClientRect();
      const articleBottom = pageTop + articleRect.bottom;
      const maxScroll = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const startScroll = clampToRange(
        pageTop + titleHeading.getBoundingClientRect().top - window.innerHeight * 0.22,
        0,
        maxScroll,
      );
      const endScroll = Math.max(
        startScroll + 1,
        clampToRange(
          articleBottom - window.innerHeight * 0.72,
          0,
          maxScroll,
        ),
      );
      const scrollSpan = endScroll - startScroll;

      const measured = headings.map((heading, index) => {
        const label = (heading.textContent || "").trim() || title;
        const id = uniqueHeadingId(
          heading.id || (index === 0 ? "post-title" : slugify(label)),
          usedIds,
        );
        heading.id = id;
        const headingScroll =
          pageTop + heading.getBoundingClientRect().top - window.innerHeight * 0.22;
        return {
          id,
          label,
          point: clamp((headingScroll - startScroll) / scrollSpan),
        };
      });

      currentMetrics = {
        startScroll,
        endScroll,
        sections: measured.map((heading, index) => ({
          id: heading.id,
          label: heading.label,
          start: heading.point,
          end: measured[index + 1]?.point ?? 1,
        })),
      };
      setMetrics(currentMetrics);
      setReady(true);
      updateProgress();
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(article);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", handleScroll);
      window.clearTimeout(hideTimer);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [title]);

  if (metrics.sections.length < 2) return null;

  const progressEpsilon = 1 / Math.max(
    1,
    metrics.endScroll - metrics.startScroll,
  );
  const activeIndex = Math.max(
    0,
    metrics.sections.findLastIndex(
      (section) => progress + progressEpsilon >= section.start,
    ),
  );

  const scrollTo = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    const top = window.scrollY + target.getBoundingClientRect().top
      - window.innerHeight * 0.22 + 1;
    window.scrollTo({
      top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };

  const scrollToProgress = (nextProgress: number) => {
    const next = clamp(nextProgress);
    setProgress(next);
    window.scrollTo({
      top: metrics.startScroll
        + next * (metrics.endScroll - metrics.startScroll),
      behavior: "auto",
    });
  };

  const updateFromPointer = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    scrollToProgress((event.clientY - rect.top) / rect.height);
  };

  const handlePointerDown = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    updateFromPointer(event);
  };

  const handlePointerMove = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>,
  ) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateFromPointer(event);
  };

  const finishDragging = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>,
  ) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const handleRailKeyDown = (
    event: JSX.TargetedKeyboardEvent<HTMLDivElement>,
  ) => {
    const pageStep = window.innerHeight
      / Math.max(1, metrics.endScroll - metrics.startScroll);
    const steps: Readonly<Record<string, number>> = {
      ArrowUp: -0.025,
      ArrowDown: 0.025,
      PageUp: -pageStep,
      PageDown: pageStep,
      Home: -1,
      End: 1,
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    scrollToProgress(
      event.key === "Home" ? 0 : event.key === "End" ? 1 : progress + step,
    );
  };

  return (
    <nav
      aria-label="文章章节"
      class={`article-scroll-nav${ready ? " is-ready" : ""}${scrolling ? " is-scrolling" : ""}${dragging ? " is-dragging" : ""}`}
    >
      <div class="article-scroll-nav__fade" aria-hidden="true" />
      <div class="article-scroll-nav__labels">
        {metrics.sections.map((section, index) => (
          <button
            type="button"
            class={`article-scroll-nav__label${index <= activeIndex ? " is-reached" : ""}`}
            style={{
              top: `clamp(0.5rem, ${section.start * 100}%, calc(100% - 0.5rem))`,
            }}
            aria-current={index === activeIndex ? "location" : undefined}
            onClick={() => scrollTo(section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>
      <div
        class="article-scroll-nav__rail"
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
        {metrics.sections.map((section) => {
          const sectionSpan = Math.max(0.0001, section.end - section.start);
          const fill = clamp((progress - section.start) / sectionSpan);
          return (
            <span
              class="article-scroll-nav__segment"
              style={{
                top: `${section.start * 100}%`,
                height: `${sectionSpan * 100}%`,
              }}
            >
              <span class="article-scroll-nav__segment-base" />
              <span
                class="article-scroll-nav__segment-fill"
                style={{ transform: `scaleY(${fill})` }}
              />
            </span>
          );
        })}
      </div>
    </nav>
  );
}

function clamp(value: number): number {
  return clampToRange(value, 0, 1);
}

function clampToRange(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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
