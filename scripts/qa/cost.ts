// What a review costs, before and after. List prices per million tokens (Oct 2026): Fable for the full
// reviews, Opus for the quick re-checks after a round of fixes (`--model`).
export type ModelChoice = "opus" | "fable";
export const MODELS = {
  opus: { id: "claude-opus-5-5", name: "Claude Opus 5.5", price: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 } },
  fable: { id: "claude-fable-5-1", name: "Claude Fable 5.1", price: { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 } },
} as const;
export type Model = (typeof MODELS)[ModelChoice];

// An image costs about width × height / 750 tokens, at most 4784 (2576 px long edge, 3.75 MP).
export const imageTokens = (w: number, h: number) => Math.min(4784, Math.ceil((w * h) / 750));
export const textTokens = (s: string) => Math.ceil(s.length / 3.6);

export type Usage = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };

export function costOf(u: Usage, { price }: Model = MODELS.opus): number {
  return (u.input_tokens * price.input + u.output_tokens * price.output + (u.cache_creation_input_tokens ?? 0) * price.cacheWrite + (u.cache_read_input_tokens ?? 0) * price.cacheRead) / 1e6;
}

// A guess before the call: the images and text in, and the thinking plus findings out.
export function estimate(images: { w: number; h: number }[], text: string, outputTokens = 3000, { price }: Model = MODELS.opus): number {
  const input = images.reduce((n, i) => n + imageTokens(i.w, i.h), 0) + textTokens(text);
  return (input * price.input + outputTokens * price.output) / 1e6;
}

// Spends against a cap. Calls run side by side, so each holds its estimate until it's settled: a call goes
// ahead only if what's spent, what's held and its own estimate fit.
export class Budget {
  spent = 0;
  held = 0;
  constructor(readonly cap: number) {}
  hold(estimateUsd: number): boolean {
    if (this.spent + this.held + estimateUsd > this.cap) return false;
    this.held += estimateUsd;
    return true;
  }
  settle(estimateUsd: number, actualUsd: number) {
    this.held = Math.max(0, this.held - estimateUsd);
    this.spent += actualUsd;
  }
  get left() {
    return Math.max(0, this.cap - this.spent - this.held);
  }
}
