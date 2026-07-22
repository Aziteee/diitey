import { Island } from "diitey";
import BackLink from "../islands/back-link.tsx";
import { SiteFooter } from "../shared/footer.tsx";

export default function NotFound() {
  return (
    <main class="page-shell">
      <Island name="back-link" component={BackLink} props={{}} />

      <section class="mt-14" aria-labelledby="not-found-heading">
        <h1 id="not-found-heading" class="section-title mb-3">
          404
        </h1>
        <p class="muted">页面不存在。</p>
      </section>

      <SiteFooter />
    </main>
  );
}
