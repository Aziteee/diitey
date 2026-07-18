import { useThemeConfig } from "diitey";
import type { VoidThemeConfig } from "../theme.ts";

export function SiteFooter() {
  const config = useThemeConfig<VoidThemeConfig>();
  const year = new Date().getFullYear();
  const beian = config.beian?.trim() ?? "";

  return (
    <footer class="site-footer">
      <p class="site-footer-line">
        © {year} {config.siteName}
        <span class="site-footer-sep" aria-hidden="true">
          ·
        </span>
        Powered by{" "}
        <a
          href="https://github.com/Aziteee/diitey"
          target="_blank"
          rel="noopener noreferrer"
          class="site-footer-beian"
        >
          Diitey
        </a>
      </p>
      {beian ? (
        <p class="site-footer-line">
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            class="site-footer-beian"
          >
            {beian}
          </a>
        </p>
      ) : null}
    </footer>
  );
}
