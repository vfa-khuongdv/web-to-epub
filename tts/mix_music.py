"""Mixes background music under narrated chapters, for audio exports.

Run once per export with the Python of an installed narration engine (both venvs have
numpy, soundfile and soxr). Reads one JSON object from stdin:

  {"music": "/abs/track.mp3", "gain": 0.3, "jobs": [{"voice": "/abs/1.mp3", "out": "/abs/x.mp3"}, ...]}

The track is decoded once, looped to each chapter's length at `gain` (the player's music
volume: <audio>.volume is linear too), faded out at the end, and mixed with the voice at
full level. Each output is written to `<out>.part` then renamed, like the workers do.
"""

import json
import os
import sys

import numpy as np
import soundfile as sf
import soxr

FADE_S = 2.0


def mono(samples):
    return samples.mean(axis=1) if samples.ndim == 2 else samples


def main():
    request = json.load(sys.stdin)
    music, music_rate = sf.read(request["music"], dtype="float32", always_2d=True)
    music = mono(music)
    gain = float(request["gain"])
    resampled = {}

    for job in request["jobs"]:
        voice, rate = sf.read(job["voice"], dtype="float32", always_2d=True)
        voice = mono(voice)
        if rate not in resampled:
            resampled[rate] = music if rate == music_rate else soxr.resample(music, music_rate, rate).astype(np.float32)
        track = resampled[rate]
        if len(track) == 0 or len(voice) == 0:
            bed = np.zeros_like(voice)
        else:
            bed = np.tile(track, -(-len(voice) // len(track)))[: len(voice)] * gain
            fade = min(len(bed), int(FADE_S * rate))
            if fade:
                bed[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
        mixed = np.clip(voice + bed, -1.0, 1.0)
        partial = job["out"] + ".part"
        sf.write(partial, mixed, rate, format="MP3")
        os.replace(partial, job["out"])


if __name__ == "__main__":
    main()
