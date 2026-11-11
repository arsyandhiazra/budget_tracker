// Penghubung ke layanan AI. Ada dua "bahasa" yang didukung:
// 1) anthropic — Messages API (Claude)
// 2) openai    — Chat Completions (OpenAI, Gemini, Groq, OpenRouter, dan lainnya)

export class AIError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function readBody(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

function fail(res, data) {
  const detail = data?.error?.message || data?.message || data?.raw || res.statusText;
  return new AIError(`Layanan AI menjawab ${res.status}: ${String(detail).slice(0, 300)}`, res.status);
}

// messages: [{ role: 'user' | 'assistant', content: string }], dimulai dari 'user'.
export async function askAI(ai, { system, messages }, fetchImpl = fetch) {
  const signal = AbortSignal.timeout(45_000);

  if (ai.kind === 'anthropic') {
    const res = await fetchImpl(`${ai.baseUrl}/v1/messages`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ai.model, max_tokens: 1024, system, messages }),
    });
    const data = await readBody(res);
    if (!res.ok) throw fail(res, data);
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!text) throw new AIError('Layanan AI tidak mengembalikan jawaban.', 502);
    return text;
  }

  const res = await fetchImpl(`${ai.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({ model: ai.model, messages: [{ role: 'system', content: system }, ...messages] }),
  });
  const data = await readBody(res);
  if (!res.ok) throw fail(res, data);
  const content = data.choices?.[0]?.message?.content;
  const text = (Array.isArray(content) ? content.map((p) => p?.text || '').join('') : String(content || '')).trim();
  if (!text) throw new AIError('Layanan AI tidak mengembalikan jawaban.', 502);
  return text;
}
