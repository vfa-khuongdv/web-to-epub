"""Long-lived VieNeu-TTS worker driven by the Node server over stdin/stdout.

One JSON object per line in both directions. stdout carries ONLY protocol lines —
everything the libraries print (download bars, warnings) is redirected to stderr,
which the server logs.

Requests:
  {"cmd": "load", "variant": "turbo" | "nano"}
  {"cmd": "synth", "id": "...", "parts": ["...", ...], "voice": "...", "out": "/abs/file.mp3"}
  {"cmd": "cancel", "id": "..."}        # stops a synth after its current part
  {"cmd": "quit"}

Responses:
  {"type": "ready"}                                         # once, at start
  {"type": "loaded", "variant": "...", "voices": [{"id", "label"}], "sampleRate": n}
  {"type": "progress", "id": "...", "part": i, "parts": n}  # after each part
  {"type": "done", "id": "...", "seconds": s}
  {"type": "cancelled", "id": "..."}
  {"type": "error", "id": "..." | null, "message": "..."}
"""
import json
import os
import queue
import sys
import threading
import traceback

PROTOCOL = sys.stdout
sys.stdout = sys.stderr

_send_lock = threading.Lock()


def send(message):
    with _send_lock:
        PROTOCOL.write(json.dumps(message, ensure_ascii=False) + "\n")
        PROTOCOL.flush()


# Silence between parts: a part is usually a paragraph, and back-to-back paragraphs
# without a pause sound rushed.
PAUSE_SECONDS = 0.35
NANO_STEPS = 8

commands = queue.Queue()
cancelled = set()


def read_stdin():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            send({"type": "error", "id": None, "message": "invalid JSON"})
            continue
        # Cancel must not wait behind the synth it is cancelling.
        if message.get("cmd") == "cancel":
            cancelled.add(message.get("id"))
        else:
            commands.put(message)
    commands.put({"cmd": "quit"})


def load(variant):
    from vieneu import Vieneu

    tts = Vieneu(mode="v3nano") if variant == "nano" else Vieneu(mode="v3turbo")
    voices = [{"label": label, "id": voice_id} for label, voice_id in tts.list_preset_voices()]
    send({"type": "loaded", "variant": variant, "voices": voices, "sampleRate": tts.sample_rate})
    return tts


def synth(tts, variant, message):
    import numpy as np
    import soundfile as sf

    job_id = message["id"]
    parts = message["parts"]
    extra = {"steps": NANO_STEPS} if variant == "nano" else {}
    pause = np.zeros(int(tts.sample_rate * PAUSE_SECONDS), dtype=np.float32)
    chunks = []
    for index, text in enumerate(parts):
        if job_id in cancelled:
            cancelled.discard(job_id)
            send({"type": "cancelled", "id": job_id})
            return
        audio = tts.infer(text, voice=message.get("voice") or None, **extra)
        chunks.append(np.asarray(audio, dtype=np.float32).reshape(-1))
        chunks.append(pause)
        send({"type": "progress", "id": job_id, "part": index + 1, "parts": len(parts)})

    samples = np.concatenate(chunks) if chunks else pause
    out = message["out"]
    partial = out + ".part"
    sf.write(partial, samples, tts.sample_rate, format="MP3")
    os.replace(partial, out)
    send({"type": "done", "id": job_id, "seconds": round(len(samples) / tts.sample_rate, 2)})


def main():
    threading.Thread(target=read_stdin, daemon=True).start()
    send({"type": "ready"})
    tts = None
    variant = None
    while True:
        message = commands.get()
        cmd = message.get("cmd")
        job_id = message.get("id")
        try:
            if cmd == "quit":
                return
            if cmd == "load":
                wanted = message.get("variant", "turbo")
                if tts is None or wanted != variant:
                    tts = None
                    tts = load(wanted)
                    variant = wanted
                else:
                    voices = [{"label": l, "id": v} for l, v in tts.list_preset_voices()]
                    send({"type": "loaded", "variant": variant, "voices": voices, "sampleRate": tts.sample_rate})
            elif cmd == "synth":
                if tts is None:
                    raise RuntimeError("model not loaded")
                synth(tts, variant, message)
            else:
                raise ValueError(f"unknown command: {cmd}")
        except Exception as exc:  # keep serving after a bad request
            traceback.print_exc()
            send({"type": "error", "id": job_id, "message": str(exc) or exc.__class__.__name__})


if __name__ == "__main__":
    main()
