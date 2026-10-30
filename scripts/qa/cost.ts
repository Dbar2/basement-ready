// What a review costs, before and after. Claude Opus 5.5 list prices per million tokens (Oct 2026).
export const MODEL = "claude-opus-5-5";
export const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }; // $ per MTok

// An image costs about width × height / 750 tokens, at most 4784 (2576 px long edge, 3.75 MP).
export const imageTokens = (w: number, h: number) => Math.min(4784, Math.ceil((w * h) / 750));
export const textTokens = (s: string) => Math.ceil(s.length / 3.6);

export type Usage = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };

export function costOf(u: Usage): number {
  return (u.input_tokens * PRICE.input + u.output_tokens * PRICE.output + (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead) / 1e6;
}

// A guess before the call: the images and text in, and the thinking plus findings out.
export function estimate(images: { w: number; h: number }[], text: string, outputTokens = 3000): number {
  const input = images.reduce((n, i) => n + imageTokens(i.w, i.h), 0) + textTokens(text);
  return (input * PRICE.input + outputTokens * PRICE.output) / 1e6;
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
