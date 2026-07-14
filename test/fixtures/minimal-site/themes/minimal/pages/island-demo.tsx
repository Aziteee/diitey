import { Island } from "diitey";
import Counter from "../islands/counter.tsx";

export default function IslandDemo() {
  return (
    <main class="max-w-2xl p-5">
      <h1>Island demo</h1>
      <Island name="counter" component={Counter} props={{ initial: 2 }} />
    </main>
  );
}
