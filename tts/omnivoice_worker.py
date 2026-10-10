"""Long-lived OmniVoice worker driven by the Node server over stdin/stdout.

Same protocol as vieneu_worker.py (see there), with two differences:

- OmniVoice has no preset voices: every synth must bring a reference clip ("refAudio").
  Without one the model picks a new random voice for every part.
- Cloning wants the clip's transcript. "refText" carries the one the user typed; without
  it Whisper transcribes the clip once. Either way the resulting voice prompt is saved
  next to the clip (<clip>.omnivoice-v2.pt), or at "refPrompt" when the clip's folder is not
  writable (a clip bundled with the app), so a voice is prepared only once.

Requests:
  {"cmd": "load", "variant": "omnivoice"}
  {"cmd": "synth", "id": "...", "parts": [...], "voice": "custom:<id>", "out": "/abs/file.mp3",
   "refAudio": "/abs/clip.mp3", "refText": "...", "refPrompt": "/abs/x.pt"}  # both optional
  {"cmd": "cancel", "id": "..."}
  {"cmd": "quit"}

Responses: as vieneu_worker.py ("loaded" always lists no voices).
"""
import json
import os
import queue
import sys
import threading
import traceback

# Windows: onnxruntime, soxr and kaldi-native-fbank need msvcp140*.dll, which the msvc-runtime
# package puts in the venv root (msvcRuntimePackages in src/config/tts.ts). The venv's
# python.exe is a launcher, so that folder is not on the DLL search path by itself.
if os.name == "nt":
    os.add_dll_directory(sys.prefix)

PROTOCOL = sys.stdout
sys.stdout = sys.stderr

_send_lock = threading.Lock()


def send(message):
    with _send_lock:
        PROTOCOL.write(json.dumps(message, ensure_ascii=False) + "\n")
        PROTOCOL.flush()


# Pinned like the packages: a new upload to the model repo is a change we test first.
MODEL_REPO = "k2-fsa/OmniVoice"
MODEL_REVISION = "c5fdb5ccb189668d56333f77ba2629f4cd7535f4"
ASR_REPO = "openai/whisper-large-v3-turbo"
ASR_REVISION = "41f01f3fe87f28c78e2fbf8b568835947dd65ed9"

PAUSE_SECONDS = 0.35
# The upstream default; fewer steps were not faster on an 8 GB M2 (memory-bound there).
NUM_STEPS = 32
# OmniVoice clones best from 3–10 s. Only a clip Whisper transcribes is cut: a typed
# transcript describes the whole clip, and cutting the audio would make them disagree.
MAX_REF_SECONDS = 15
# A cut clip ends at its last pause of at least this long, never mid-word: OmniVoice
# carries the cut-off syllable into its output and says it again at the end of every
# sentence (its transcript ends with "." there).
MIN_PAUSE_SECONDS = 0.15
# Bumped when the way a prompt is made changes, so prompts saved before are made again.
PROMPT_SUFFIX = ".omnivoice-v2.pt"

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
        if message.get("cmd") == "cancel":
            cancelled.add(message.get("id"))
        else:
            commands.put(message)
    commands.put({"cmd": "quit"})


def load():
    import torch
    from huggingface_hub import snapshot_download
    from omnivoice import OmniVoice

    path = snapshot_download(MODEL_REPO, revision=MODEL_REVISION)
    device = pick_device(torch)
    dtype = torch.float16 if device != "cpu" else torch.float32
    model = OmniVoice.from_pretrained(path, device_map=device, dtype=dtype)
    return model


def pick_device(torch):
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def free_gpu_cache(torch):
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    elif torch.cuda.is_available():
        torch.cuda.empty_cache()


def loaded_message(model):
    return {"type": "loaded", "variant": "omnivoice", "voices": [], "sampleRate": model.sampling_rate}


def voice_prompt(model, ref_audio, ref_text, ref_prompt, prompts):
    """The clone prompt of a clip: from memory, from its saved file, or made (once)."""
    import torch
    from omnivoice import VoiceClonePrompt

    if ref_audio in prompts:
        return prompts[ref_audio]
    saved = ref_prompt or ref_audio + PROMPT_SUFFIX
    if os.path.exists(saved):
        prompt = VoiceClonePrompt.load(saved)
    else:
        audio = load_clip(ref_audio, model.sampling_rate, trim=not ref_text)
        if not ref_text:
            from huggingface_hub import snapshot_download

            model.load_asr_model(model_name=snapshot_download(ASR_REPO, revision=ASR_REVISION))
        try:
            prompt = model.create_voice_clone_prompt(ref_audio=audio, ref_text=ref_text or None)
        finally:
            # Whisper is only needed for this; on an 8 GB Mac it must not stay resident.
            model._asr_pipe = None
            free_gpu_cache(torch)
        os.makedirs(os.path.dirname(saved), exist_ok=True)
        partial = saved + ".part"
        prompt.save(partial)
        os.replace(partial, saved)
    prompts[ref_audio] = prompt
    return prompt


def load_clip(path, rate, trim):
    import librosa
    import torch

    samples, _ = librosa.load(path, sr=rate, mono=True, duration=MAX_REF_SECONDS if trim else None)
    if trim and len(samples) >= int(MAX_REF_SECONDS * rate) - 1:
        samples = samples[: last_pause(samples, rate)]
    return (torch.from_numpy(samples), rate)


def last_pause(samples, rate):
    """Where the last pause before the end of a cut-off clip starts (the whole clip if none)."""
    import librosa

    spans = librosa.effects.split(samples, top_db=35)
    pauses = [end for (_, end), (start, _) in zip(spans[:-1], spans[1:]) if start - end >= MIN_PAUSE_SECONDS * rate]
    # Too short a clip clones badly; better the cut-off word than a 2 s voice.
    pauses = [end for end in pauses if end >= 3 * rate]
    return pauses[-1] if pauses else len(samples)


def synth(model, message, prompts):
    import numpy as np
    import soundfile as sf

    job_id = message["id"]
    parts = message["parts"]
    if not message.get("refAudio"):
        raise ValueError("OmniVoice needs a reference clip")
    prompt = voice_prompt(model, message["refAudio"], message.get("refText"), message.get("refPrompt"), prompts)
    rate = model.sampling_rate
    pause = np.zeros(int(rate * PAUSE_SECONDS), dtype=np.float32)
    # Silence before the first word, so a listener has a moment before the voice starts.
    lead = np.zeros(int(rate * float(message.get("lead") or 0)), dtype=np.float32)
    chunks = [lead] if len(lead) else []
    timings = []
    position = len(lead)
    for index, text in enumerate(parts):
        if job_id in cancelled:
            cancelled.discard(job_id)
            send({"type": "cancelled", "id": job_id})
            return
        audio = model.generate(text=text, language="vi", voice_clone_prompt=prompt, num_step=NUM_STEPS)
        audio = np.asarray(audio[0], dtype=np.float32).reshape(-1)
        timings.append([round(position / rate, 3), round((position + len(audio)) / rate, 3)])
        position += len(audio) + len(pause)
        chunks.append(audio)
        chunks.append(pause)
        if index == 0 and message.get("afterFirst"):
            # The introduction: a longer breath before the chapter itself starts.
            extra = np.zeros(int(rate * float(message["afterFirst"])), dtype=np.float32)
            position += len(extra)
            chunks.append(extra)
        send({"type": "progress", "id": job_id, "part": index + 1, "parts": len(parts)})

    samples = np.concatenate(chunks) if chunks else pause
    out = message["out"]
    partial = out + ".part"
    sf.write(partial, samples, rate, format="MP3")
    os.replace(partial, out)
    send({"type": "done", "id": job_id, "seconds": round(len(samples) / rate, 2), "timings": timings})


def main():
    threading.Thread(target=read_stdin, daemon=True).start()
    send({"type": "ready"})
    model = None
    prompts = {}  # clip path -> VoiceClonePrompt
    while True:
        message = commands.get()
        cmd = message.get("cmd")
        job_id = message.get("id")
        try:
            if cmd == "quit":
                return
            if cmd == "load":
                if model is None:
                    model = load()
                send(loaded_message(model))
            elif cmd == "synth":
                if model is None:
                    raise RuntimeError("model not loaded")
                synth(model, message, prompts)
            else:
                raise ValueError(f"unknown command: {cmd}")
        except Exception as exc:  # keep serving after a bad request
            traceback.print_exc()
            send({"type": "error", "id": job_id, "message": str(exc) or exc.__class__.__name__})


if __name__ == "__main__":
    main()
