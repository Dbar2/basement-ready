import { loadFont as loadHanken } from "@remotion/google-fonts/HankenGrotesk";
import { loadFont as loadGeist } from "@remotion/google-fonts/GeistMono";

// Hanken Grotesk for words, Geist Mono for figures (brand/ui.md).
export const SANS = loadHanken("normal", { weights: ["400", "500", "600", "800", "900"], subsets: ["latin"] }).fontFamily;
export const MONO = loadGeist("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;
