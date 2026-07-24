import { useThemeConfig } from "diitey";
import type { VoidThemeConfig } from "../theme.ts";

export function SiteFooter() {
  const config = useThemeConfig<VoidThemeConfig>();
  const year = new Date().getFullYear();
  const beian = config.beian?.trim() ?? "";

  const beianLinkClass =
    "text-inherit no-underline hover:text-neutral-800 focus-visible:text-neutral-800 focus-visible:outline-none dark:hover:text-neutral-200 dark:focus-visible:text-neutral-200";

  return (
    <footer class="mt-20 font-sans text-xs tracking-[0.02em] text-neutral-500 dark:text-neutral-500 sm:mt-28">
      <p class="m-0">
        © {year} {config.siteName}
        <span class="mx-1.5" aria-hidden="true">
          ·
        </span>
        Powered by{" "}
        <a
          href="https://github.com/Aziteee/diitey"
          target="_blank"
          rel="noopener noreferrer"
          class={beianLinkClass}
        >
          Diitey
        </a>
      </p>
      {beian ? (
        <p class="m-0 mt-1.5">
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            class={beianLinkClass}
          >
            {beian}
          </a>
        </p>
      ) : null}
    </footer>
  );
}
