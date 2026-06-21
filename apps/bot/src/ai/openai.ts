/**
 * Minimal OpenAI REST client (no SDK dependency). Covers the two endpoints the
 * assistant needs: chat completions with tool-calling (gpt-4o) and audio
 * transcription (gpt-4o-transcribe). Plain fetch so we add no package.
 */

const OPENAI_BASE = 'https://api.openai.com/v1';

export const CHAT_MODEL = 'gpt-4o';
export const TRANSCRIBE_MODEL = 'gpt-4o-transcribe';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChatMessage = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolDef = Record<string, any>;

export interface ChatResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any; // the assistant message (may contain tool_calls)
}

/** One chat-completions round. Returns the raw assistant message (content + tool_calls). */
export async function chatCompletion(
  apiKey: string,
  messages: ChatMessage[],
  tools?: ToolDef[],
): Promise<ChatResult> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}),
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI chat ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { choices: { message: unknown }[] };
  return { message: json.choices[0]?.message };
}

/** Transcribe an audio buffer (Telegram voice = ogg/opus) with gpt-4o-transcribe. */
export async function transcribeAudio(
  apiKey: string,
  audio: Uint8Array,
  filename = 'voice.ogg',
): Promise<string> {
  const form = new FormData();
  form.append('model', TRANSCRIBE_MODEL);
  form.append('file', new Blob([audio]), filename);
  const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`OpenAI transcribe ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { text?: string };
  return json.text ?? '';
}
