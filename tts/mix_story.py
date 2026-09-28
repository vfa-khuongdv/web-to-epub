"""Join a story's chapter MP3s into one MP3, with background music looped under it.

Run once per export with the Python of an installed narration engine (both venvs carry
numpy, soundfile and soxr). Reads one JSON object on stdin:

  {"chapters": ["/abs/1.mp3", ...], "music": "/abs/track.mp3" | null,
   "musicVolume": 0.3, "out": "/abs/story.mp3"}

or, for one file per chapter (the zip export and a chapter's download), "outs":
["/abs/001.mp3", ...] in place of "out" — each chapter mixed on its own, the music
starting over in every file.

and writes JSON lines on stdout:

  {"type": "progress", "done": 3, "total": 120}
  {"type": "done", "seconds": 5321.4}
  {"type": "error", "message": "..."}

The output is mono at the first chapter's sample rate. Chapters are read one at a time,
so memory stays at one chapter plus the music, whatever the story's length. The music
keeps playing across chapter boundaries instead of restarting under every chapter.
"""

import json
import os
import sys


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def main():
    import numpy as np
    import soundfile as sf
    import soxr

    job = json.load(sys.stdin)
    chapters = job["chapters"]
    rate = sf.info(chapters[0]).samplerate

    def read_mono(path):
        samples, file_rate = sf.read(path, dtype="float32", always_2d=True)
        samples = samples.mean(axis=1)
        if file_rate != rate:
            samples = soxr.resample(samples, file_rate, rate).astype(np.float32)
        return samples

    music = None
    if job.get("music"):
        track = read_mono(job["music"])
        if len(track) > 0:
            music = track * np.float32(job.get("musicVolume", 0.3))
    at = 0  # where the music loop is

    def music_for(count):
        nonlocal at
        pieces = []
        while count > 0:
            take = min(count, len(music) - at)
            pieces.append(music[at : at + take])
            at = (at + take) % len(music)
            count -= take
        return np.concatenate(pieces) if pieces else np.zeros(0, dtype=np.float32)

    def mixed(path):
        voice = read_mono(path)
        if music is not None:
            voice += music_for(len(voice))
        np.clip(voice, -1.0, 1.0, out=voice)
        return voice

    frames = 0
    if job.get("outs"):
        for index, (path, out) in enumerate(zip(chapters, job["outs"])):
            at = 0
            voice = mixed(path)
            partial = out + ".part"
            sf.write(partial, voice, rate, format="MP3")
            os.replace(partial, out)
            frames += len(voice)
            send({"type": "progress", "done": index + 1, "total": len(chapters)})
        send({"type": "done", "seconds": round(frames / rate, 2)})
        return

    out = job["out"]
    partial = out + ".part"
    with sf.SoundFile(partial, "w", samplerate=rate, channels=1, format="MP3") as sink:
        for index, path in enumerate(chapters):
            voice = mixed(path)
            sink.write(voice)
            frames += len(voice)
            send({"type": "progress", "done": index + 1, "total": len(chapters)})
    os.replace(partial, out)
    send({"type": "done", "seconds": round(frames / rate, 2)})


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # the server shows this to the reader
        send({"type": "error", "message": str(err)})
        sys.exit(1)
