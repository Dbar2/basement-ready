// The pictures of a scan's design on their own page: /scans/:id/pictures.
import { useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { Logo } from "../components/Logo";
import { DesignPictures } from "./DesignPictures";

export function PicturesPage() {
  const { scanId } = useParams({ strict: false }) as { scanId: string };
  useEffect(() => {
    document.title = "Your design, from where you stood | Basement Ready";
  }, []);
  return (
    <main className="views-page">
      <header className="views-page-head">
        <Logo />
      </header>
      <h1>Your design, from where you stood</h1>
      <p className="views-page-lede">The same design in every picture, from the best spots in your video. Tap anything to change it.</p>
      <DesignPictures scanId={scanId} view="swipe" />
    </main>
  );
}
