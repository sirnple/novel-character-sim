import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/rate-limit";

const TTS_URL = process.env.TTS_SERVER_URL || "http://127.0.0.1:8765";

export async function POST(request: NextRequest) {
  const { text, voiceDesc } = await request.json();
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${TTS_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice_desc: voiceDesc || "" }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: res.status });
    }

    const audioBuffer = await res.arrayBuffer();
    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `TTS server unreachable (${TTS_URL}). Start it with: python tts_server.py` },
      { status: 503 }
    );
  }
}
