"""
VoxCPM2 TTS server for novel-character-sim.
Provides a lightweight HTTP API for text-to-speech with voice design.

Usage:
  pip install fastapi uvicorn voxcpm soundfile
  python tts_server.py --port 8765 --model openbmb/VoxCPM2
"""

import io
import argparse
import logging
from contextlib import asynccontextmanager

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="[TTS] %(message)s")
log = logging.getLogger(__name__)

model = None


class TTSRequest(BaseModel):
    text: str = Field(..., description="Text to synthesize (Chinese or English)")
    voice_desc: str = Field(
        default="",
        description="Voice design description in Chinese, e.g. '温柔甜美的年轻女声'",
    )
    cfg_value: float = Field(default=2.0, ge=1.0, le=5.0)
    inference_steps: int = Field(default=10, ge=4, le=30)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    log.info("Loading VoxCPM2 model — this may take a few minutes on first run...")
    from voxcpm import VoxCPM

    model_name = app.state.model_name
    model = VoxCPM.from_pretrained(model_name, load_denoiser=False)
    log.info(f"VoxCPM2 loaded (sample_rate={model.tts_model.sample_rate}) — ready.")
    yield
    log.info("Shutting down TTS server.")


app = FastAPI(title="VoxCPM2 TTS Server", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok" if model else "loading"}


@app.post("/tts")
def synthesize(req: TTSRequest):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    # Build voice design prompt
    text = req.text.strip()
    if req.voice_desc:
        text = f"({req.voice_desc}){text}"

    log.info(f"TTS: len={len(text)} desc={req.voice_desc[:60] if req.voice_desc else 'none'}")

    try:
        wav: np.ndarray = model.generate(
            text=text,
            cfg_value=req.cfg_value,
            inference_timesteps=req.inference_steps,
        )
    except Exception as e:
        log.error(f"TTS generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Encode as WAV in memory
    buf = io.BytesIO()
    sf.write(buf, wav, model.tts_model.sample_rate, format="WAV")
    buf.seek(0)
    return Response(content=buf.read(), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--model", type=str, default="openbmb/VoxCPM2")
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    app.state.model_name = args.model
    uvicorn.run(app, host=args.host, port=args.port)
