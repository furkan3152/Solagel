# Elymum gameplay film (narrated)

A film of about 120 s recorded from the real UI: the home page, what Elymum is, WL → Mint → Play,
then a live round in Asphodel Meadow (the drop-in, the first eat, a chase, a split, the final
minute, the bell and the PAID stamp) and the end card. A storyteller narrates it. This folder holds
the words, the timeline and the whole soundtrack pipeline. The picture is captured with the
gameplay kit (`media/gameplay/capture`) and cut to `cues.json`.

| Path | What it is |
|---|---|
| `script.md` | The narration with a director's note per line (intent, emphasis, pace) and the cue list |
| `script-for-voice-actor.md` | One page for a human reader: the lines with breath marks, pronunciations, how to record and name the file |
| `vo-lines.json` | The lines in the voice kit's format (`\|` breath, `\|\|` beat, `{0.6}` pause, `*emphasis*`, per-line `speed`) |
| `cues.json` | The film timeline: picture beats, the time of each VO line, SFX cues, music section starts (96 BPM, one bar = 2.5 s) |
| `audio/voice.py` | Kokoro TTS, a sentence at a time (intonation runs across the commas; the marked gaps are set afterwards), several takes per line, take scoring |
| `audio/tts.py` | CLI: render takes, audition voices, lock a pick |
| `audio/post.py` | The humanising post chain (re-timed pauses, breaths, slow drift, EQ, de-ess, compression, a small room) and the light chain for human recordings |
| `audio/music.py` | The original score, synthesised (felt piano, music box, pizzicato, harp, bassoon, strings, brushes, timpani) |
| `audio/sfx.py` | Chomp, stamp thump, ticket punch, the round bell, whooshes (and a tick), laid at the cues |
| `audio/mix.py` | The mix: voice (human > TTS > placeholder), ducked music, SFX, master to -16 LUFS / true peak <= -1 dBTP |
| `audio/check.py` | Listen by proxy: R128 loudness, true peak, clipping, octave balance, loudness per film section |
| `audio/dsp.py` | numpy + ffmpeg DSP kit (no scipy, no soundfile) |

Everything except the TTS step runs on plain `python3` with numpy and the `ffmpeg` binary.
Renders go to `out/work/voice/` (gitignored).

## Run it

```bash
cd media/gameplay-film/audio
W=../../../out/work/voice

python3 music.py $W/music.wav --stems $W/stems   # ~45 s
python3 sfx.py $W                                # -> $W/sfx.wav and the kit in $W/sfx/
python3 mix.py --source placeholder --name mix-placeholder   # timing check with a murmur
python3 mix.py --no-vo --name mix-bed            # music + sfx only
python3 check.py $W/music.wav $W/mix-placeholder/mix.wav --sections
```

### The voice, option A: a person

Give `script-for-voice-actor.md` to the reader. Put the recording at
`media/gameplay-film/audio/vo-human.wav` (one file, lines separated by 1.5 s of silence; it is cut
apart and each line laid at its cue) or `media/gameplay-film/audio/vo-human/<id>.wav` (one file per
line). Both are gitignored. Then `python3 mix.py`: human lines win over TTS takes, and get the light
chain (high-pass, a gentle denoise, de-ess, 2:1 compression; no added breaths or room). A read
recorded to picture: `python3 mix.py --human-mode synced [--human-offset S]`.

### The voice, option B: Kokoro TTS

Needs the owner's go-ahead for the install and the download (this environment cannot do either):

- `kokoro-onnx` (pip; it pulls `onnxruntime`, `espeakng-loader` with a bundled espeak-ng, and
  `phonemizer-fork`), in a venv so the system Python stays clean.
- The Kokoro-82M v1.0 ONNX model and voices (Apache-2.0), from the `model-files-v1.0` release of
  github.com/thewh1teagle/kokoro-onnx: `kokoro-v1.0.onnx` (about 310 MB; `kokoro-v1.0.fp16.onnx`
  about 170 MB or `kokoro-v1.0.int8.onnx` about 90 MB also work, `--model-file`) and
  `voices-v1.0.bin` (about 27 MB). If `media/gameplay/cache` already holds them from the other films,
  point `--models` there.

```bash
python3 -m venv out/work/voice/venv
out/work/voice/venv/bin/pip install kokoro-onnx
mkdir -p out/work/voice/models && cd out/work/voice/models
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
cd -

PY=out/work/voice/venv/bin/python
$PY media/gameplay-film/audio/tts.py audition --models out/work/voice/models     # 11 voices x 3 lines
$PY media/gameplay-film/audio/tts.py --models out/work/voice/models --voice af_heart --takes 4
$PY media/gameplay-film/audio/tts.py pick first_eat 3      # optional: lock a take by ear
python3 media/gameplay-film/audio/mix.py                   # -> out/work/voice/mix/mix.wav
```

The PyTorch build of the same model works too (`pip install kokoro soundfile`, plus torch; the
Hugging Face `hexgrad/Kokoro-82M` folder: `config.json`, `kokoro-v1_0.pth` about 330 MB, `voices/*.pt`):
pass that folder as `--models` (or `--backend torch`). It is heavier to install (torch, spaCy for
misaki) but takes real emphasis: `*word*` becomes misaki's `[word](+1)`.

Takes are scored on pitch movement (a monotone read is the giveaway), words per minute (140-175)
and fit to the time before the next cue; the best one is picked unless a pick is locked. Voice
ids can be blended (`--voice "am_michael:0.8+am_puck:0.2"`), and `--blend af_nicole` mixes a second
voice lightly into some takes. Kokoro has no emphasis control: `*word*` keeps the word's stress and
slows its sentence a little; the rest of the "not a robot" work is in `audio/post.py`.

## Outputs (`out/work/voice/`)

`music.wav` and `stems/music-*.wav`; `sfx.wav` and `sfx/*.wav` (one per sound); `takes/` (TTS);
`<name>/mix.wav` (the delivery, 24-bit, -16 LUFS, true peak <= -1 dBTP), `<name>/vo-master.wav`
(the voice alone at the same spec), `<name>/stems/` (voice, ducked music, sfx at mix level),
`<name>/timeline.json` (where every line landed) and `<name>/report.json`.

The repository's other films deliver at -14 LUFS (`media/gameplay/render/finalize.py`); for the same
loudness as them, run `mix.py --target -14`, or pass `mix.wav` through `finalize.py` with the picture.
