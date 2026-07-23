import { Island } from "diitey";
import MusicPlayer from "../islands/music-player.tsx";

const musicPlayerPattern = /<music-player(?:\s|>)/i;

export function hasMusicPlayer(html: string | undefined): boolean {
  return typeof html === "string" && musicPlayerPattern.test(html);
}

export function MusicPlayerEnhancer() {
  return <Island name="music-player" component={MusicPlayer} props={{}} />;
}
