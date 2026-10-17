import { NextResponse } from "next/server";
import { emitPrismTrace } from "@/lib/prism";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const started = Date.now();
  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: "Add ELEVENLABS_API_KEY to enable voice summaries." }, { status: 503 });
  }
  let body: { text?: string; sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 1800) : "";
  if (!text) return NextResponse.json({ error: "Text is required." }, { status: 400 });
  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId.slice(0, 120) : `closemate-voice-${Date.now()}`;
  const model = "eleven_multilingual_v2";

  const voiceId = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
  try {
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({ text, model_id: model }),
      signal: AbortSignal.timeout(20000),
      cache: "no-store"
    });
    if (!upstream.ok) {
      const message = await upstream.text().catch(() => "Unknown ElevenLabs error");
      await emitPrismTrace(text, `MODEL_ERROR: ElevenLabs ${upstream.status}: ${message.slice(0, 300)}`, {
        model,
        latencyMs: Date.now() - started,
        sessionId,
        agentId: "closemate-voice"
      });
      return NextResponse.json({ error: `ElevenLabs returned ${upstream.status}: ${message.slice(0, 240)}` }, { status: 502 });
    }
    const audio = await upstream.arrayBuffer();
    await emitPrismTrace(text, `[audio/mpeg speech synthesis, ${audio.byteLength} bytes]`, {
      model,
      latencyMs: Date.now() - started,
      sessionId,
      agentId: "closemate-voice"
    });
    return new Response(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" }
    });
  } catch (error) {
    await emitPrismTrace(text, `MODEL_ERROR: ${String(error).slice(0, 500)}`, {
      model,
      latencyMs: Date.now() - started,
      sessionId,
      agentId: "closemate-voice"
    });
    return NextResponse.json({ error: "Voice generation failed." }, { status: 502 });
  }
}
