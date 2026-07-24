import { useEffect, useState } from "preact/hooks";

type BackTarget = {
  readonly href: string;
  readonly label: string;
};

function resolveBackTarget(): BackTarget {
  try {
    const ref = globalThis.document.referrer;
    if (ref) {
      const url = new URL(ref);
      if (
        url.origin === globalThis.location.origin &&
        url.pathname === "/archives"
      ) {
        return {
          href: `${url.pathname}${url.search}${url.hash}`,
          label: "Writing",
        };
      }
    }
  } catch {
    // ignore invalid referrer
  }
  return { href: "/", label: "Home" };
}

export default function BackLink() {
  const [target, setTarget] = useState<BackTarget>({
    href: "/",
    label: "Home",
  });

  useEffect(() => {
    setTarget(resolveBackTarget());
  }, []);

  return (
    <button
      type="button"
      aria-label={`返回 ${target.label}`}
      class="group back-link"
      onClick={() => {
        globalThis.location.assign(target.href);
      }}
    >
      <svg
        class="back-arrow"
        viewBox="0 0 20 14"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M7 2 2 7l5 5M2.25 7h15"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span>{target.label}</span>
    </button>
  );
}
