export default function BackLink() {
  return (
    <button
      type="button"
      aria-label="返回"
      class="group back-link"
      onClick={() => {
        if (globalThis.history.length > 1) {
          globalThis.history.back();
          return;
        }
        globalThis.location.assign("/");
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
      <span>Back</span>
    </button>
  );
}
