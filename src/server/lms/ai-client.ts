// The one place the Worker calls Workers AI. (Tests replace this file with a mock in their bundle.)
import type { AppEnv } from "../env";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

export async function runModel(env: AppEnv, messages: ChatMessage[], maxTokens: number): Promise<string> {
  if (!env.AI) throw new Error("no AI binding");
  const out = (await env.AI.run((env.AI_MODEL || DEFAULT_MODEL) as Parameters<Ai["run"]>[0], { messages, max_tokens: maxTokens, temperature: 0.3 } as never)) as { response?: string } | string;
  const text = typeof out === "string" ? out : out?.response;
  if (!text) throw new Error("empty AI response");
  return text.trim();
}
