"""The gameplay film's voice: Kokoro TTS (local ONNX), read a sentence at a time, several takes per
line, with the pauses the script marks. Adapted from media/gameplay/render/voice.py (same script
marks, same fixed pronunciations); the difference is the unit of synthesis.

Why sentences: the older kit synthesised every chunk between marks on its own, so every chunk
ended on a full stop's falling pitch (the "list of announcements" sound). Here a whole sentence
goes to Kokoro at once, so its intonation runs across the commas the way a person's does, and the
marked pauses are made afterwards:

  |      inside a sentence: read as a comma; the comma's gap is then set to 0.16 s
         between sentences: a 0.16 s breath
  ||     a beat (0.38 s) - always a sentence break
  {0.6}  a pause of that many seconds. Inside a sentence ("Whoever isn't {0.35} was lunch.")
         the sentence is still read whole, with a comma there, and the gap is stretched, so the
         voice stays suspended instead of finishing the thought early
  *word* emphasis. Kokoro has no emphasis control, so: the word keeps a primary stress mark in
         its phonemes and the sentence that holds it is read a touch slower (x0.96, x0.92 when
         the emphasis is the whole sentence). The marks matter most to a human reader.

Gaps inside a sentence are found on a 10 ms energy envelope (the longest silent runs, in order);
if there are fewer gaps than marks, the sentence keeps Kokoro's own comma timing.

A take is written as a wav (24 kHz mono, pauses as digital silence) plus a layout (.json) of its
speech and pause spans, which audio/post.py uses to re-time the pauses, add breaths and fill the
gaps with room tone. Kokoro is deterministic, so takes differ by speed (a per-take factor and a
small per-sentence jitter) and, optionally, by a light blend with a second voice.

Voices: any Kokoro v1.0 voice id, or a blend "af_heart:0.85+af_nicole:0.15". British voices
(bf_*, bm_*) are phonemised as en-gb.

Two backends, the same model (Kokoro-82M v1.0): kokoro-onnx (onnxruntime + espeak-ng phonemes; a
models folder with kokoro-v1.0.onnx and voices-v1.0.bin) or the PyTorch `kokoro` package (misaki
G2P; a folder laid out like the Hugging Face repo: config.json, kokoro-v1_0.pth, voices/*.pt). The
PyTorch one takes real emphasis ([word](+1)); auto picks by what the folder holds.
"""
import json
import os
import re
import zlib

import numpy as np

import dsp

KSR = 24000
# words the G2P must not guess (espeak IPA, as Kokoro expects); the media/gameplay set plus WL, NFT
FIXED = {
    "@elymum": "æt ˈɛlɪməm",
    "$ELYMUM": "ˈɛlɪməm",
    "Elymum's": "ˈɛlɪməmz",
    "Elymum": "ˈɛlɪməm",
    "Elysium's": "ɪlˈɪziəmz",
    "Elysium": "ɪlˈɪziəm",
    "HYPE": "hˈaɪp",
    "NFTs": "ˌɛnˌɛftˈiːz",
    "NFT": "ˌɛnˌɛftˈiː",
    "WL": "dˈʌbəljuː ˈɛl",
}
PAUSE = {"|": 0.16, "||": 0.38}


# ───────────────────────── script parsing ─────────────────────────
def parse(text):
    """-> sentences: [{'text': str for TTS (marks -> commas), 'gaps': [s, ...] (inside),
    'emph': [word, ...], 'whole_emph': bool, 'after': pause s, 'after_mark': str}]"""
    toks = re.split(r"(\|\||\||\{[\d.]+\})", text)
    # flatten into words/punctuation and pause tokens
    items = []
    for t in toks:
        if not t.strip():
            continue
        if t in PAUSE:
            items.append(("pause", PAUSE[t], t))
        elif re.fullmatch(r"\{[\d.]+\}", t):
            items.append(("pause", float(t[1:-1]), t))
        else:
            items.append(("text", t.strip(), ""))
    sentences = []
    cur = {"parts": [], "gaps": []}

    def close(after, mark):
        if cur["parts"]:
            raw = " ".join(cur["parts"])
            emph = re.findall(r"\*([^*]+)\*", raw)
            plain = re.sub(r"\*([^*]+)\*", r"\1", raw)
            plain = re.sub(r"\s+,", ",", plain)
            whole = bool(emph) and re.sub(r"[^\w@$']", "", plain) == re.sub(r"[^\w@$']", "", " ".join(emph))
            sentences.append({"text": plain.strip(), "gaps": list(cur["gaps"]), "emph": emph,
                              "whole_emph": whole, "after": after, "after_mark": mark})
        cur["parts"], cur["gaps"] = [], []

    for i, it in enumerate(items):
        if it[0] == "text":
            # a text run may hold several sentences ("Pick a room. Buy a ticket.")
            pieces = re.split(r"(?<=[.?!]\*)\s+|(?<=[.?!])\s+", it[1])
            for j, p in enumerate(pieces):
                cur["parts"].append(p)
                if j < len(pieces) - 1:
                    close(0.22, "")
        else:
            _, dur, mark = it
            ends_sentence = bool(cur["parts"]) and re.search(r"[.?!][*\"')]*$", cur["parts"][-1])
            if mark == "||" or ends_sentence:
                close(dur, mark)
            elif cur["parts"]:
                # inside a sentence: a comma for the reader, a gap to stretch afterwards
                if not re.search(r"[,;:]\**$", cur["parts"][-1]):
                    cur["parts"][-1] = cur["parts"][-1] + ","
                cur["gaps"].append(dur)
    close(0.0, "end")
    return sentences


def spoken_words(text):
    return len(re.sub(r"[|*{}\d.]", " ", text).split())


# ───────────────────────── Kokoro ─────────────────────────
class Voice:
    def __init__(self, models, model_file=None):
        from kokoro_onnx import Kokoro
        mf = model_file or next((f for f in ("kokoro-v1.0.onnx", "kokoro-v1.0.fp16.onnx", "kokoro-v1.0.int8.onnx")
                                 if os.path.exists(os.path.join(models, f))), "kokoro-v1.0.onnx")
        self.k = Kokoro(os.path.join(models, mf), os.path.join(models, "voices-v1.0.bin"))
        self.model_file = mf

    def style(self, spec):
        """'af_heart' or 'af_heart:0.85+af_nicole:0.15' -> (style array, lang)."""
        parts = []
        for p in spec.split("+"):
            name, _, w = p.partition(":")
            parts.append((name.strip(), float(w) if w else 1.0))
        tot = sum(w for _, w in parts)
        st = sum(self.k.get_voice_style(n) * (w / tot) for n, w in parts)
        lang = "en-gb" if parts[0][0][:1] == "b" else "en-us"
        return st, lang

    def phonemes(self, text, lang, emph=()):
        pat = "(" + "|".join(re.escape(w) for w in sorted(FIXED, key=len, reverse=True)) + ")"
        out = []
        for p in re.split(pat, text):
            if p in FIXED:
                out.append(FIXED[p])
            elif p:
                ph = self.k.tokenizer.phonemize(p, lang)
                if p.startswith(" "):
                    ph = " " + ph.lstrip()
                if p.endswith(" "):
                    ph = ph.rstrip() + " "
                out.append(ph)
        ph = "".join(out).strip()
        # emphasis: make sure the emphasised word carries a primary stress
        for w in emph:
            wph = self.k.tokenizer.phonemize(re.sub(r"[^\w' ]", "", w), lang).strip()
            if wph and "ˈ" not in wph and wph in ph:
                ph = ph.replace(wph, "ˈ" + wph.replace("ˌ", ""), 1)
        return ph

    def say(self, text, style, lang, speed, emph=()):
        ph = self.phonemes(text, lang, emph)
        x, sr = self.k.create(ph, voice=style, speed=float(np.clip(speed, 0.6, 1.6)), lang=lang, is_phonemes=True)
        assert sr == KSR
        return trim(np.asarray(x, np.float64))


# misaki (the PyTorch Kokoro's G2P) spells some vowels with its own letters (I = aɪ, A = eɪ, O = oʊ);
# custom pronunciations go inline as [word](/phonemes/), and [word](+1) raises a word's stress
FIXED_MISAKI = {
    "@elymum": "æt ˈɛlɪməm",
    "Elymum's": "ˈɛlɪməmz",
    "Elymum": "ˈɛlɪməm",
    "Elysium's": "ɪlˈɪziəmz",
    "Elysium": "ɪlˈɪziəm",
    "HYPE": "hˈIp",
    "NFTs": "ˌɛnˌɛftˈiz",
    "NFT": "ˌɛnˌɛftˈi",
    "WL": "dˈʌbəlju ˈɛl",
}


class TorchVoice:
    """The same interface on the PyTorch Kokoro-82M (pip `kokoro`, G2P by misaki), for a models
    folder laid out like the Hugging Face repo: config.json, kokoro-v1_0.pth, voices/<id>.pt.
    Emphasis here is real: misaki's [word](+1) raises the word's stress."""

    def __init__(self, models, model_file=None):
        from kokoro import KModel, KPipeline
        self.models = models
        mf = model_file or "kokoro-v1_0.pth"
        self.model = KModel(config=os.path.join(models, "config.json"), model=os.path.join(models, mf)).eval()
        self.pipes = {}
        self.KPipeline = KPipeline
        self.model_file = mf

    def pipe(self, lang):
        code = "b" if lang == "en-gb" else "a"
        if code not in self.pipes:
            self.pipes[code] = self.KPipeline(lang_code=code, model=self.model)
        return self.pipes[code]

    def style(self, spec):
        parts = []
        for p in spec.split("+"):
            name, _, w = p.partition(":")
            parts.append((name.strip(), float(w) if w else 1.0))
        tot = sum(w for _, w in parts)
        lang = "en-gb" if parts[0][0][:1] == "b" else "en-us"
        pl = self.pipe(lang)
        st = sum(pl.load_voice(os.path.join(self.models, "voices", n + ".pt")) * (w / tot) for n, w in parts)
        return st, lang

    def say(self, text, style, lang, speed, emph=()):
        for w in sorted(FIXED_MISAKI, key=len, reverse=True):
            text = re.sub(r"(?<![\w\[/@$])" + re.escape(w) + r"(?![\w\]])", f"[{w}](/{FIXED_MISAKI[w]}/)", text)
        for w in emph:
            bare = re.sub(r"[^\w' ]", "", w).strip()
            if bare and f"[{bare}]" not in text:
                text = re.sub(r"(?<!\[)\b" + re.escape(bare) + r"\b(?!\])", f"[{bare}](+1)", text, count=1)
        chunks = [np.asarray(r.audio.cpu().numpy() if hasattr(r.audio, "cpu") else r.audio, np.float64)
                  for r in self.pipe(lang)(text, voice=style, speed=float(np.clip(speed, 0.6, 1.6)), split_pattern=None)
                  if r.audio is not None]
        return trim(np.concatenate(chunks)) if chunks else np.zeros(1)


def open_voice(models, model_file=None, backend="auto"):
    """kokoro-onnx when the folder holds kokoro-v1.0*.onnx, the PyTorch kokoro when it holds
    kokoro-v1_0.pth (backend: auto | onnx | torch)."""
    if backend == "auto":
        backend = "torch" if os.path.exists(os.path.join(models, model_file or "kokoro-v1_0.pth")) and \
            not any(f.endswith(".onnx") for f in os.listdir(models)) else "onnx"
    return TorchVoice(models, model_file) if backend == "torch" else Voice(models, model_file)


def trim(x, lead=0.02, tail=0.06, thr=0.008):
    idx = np.nonzero(np.abs(x) > thr)[0]
    if not len(idx):
        return x
    return x[max(0, idx[0] - int(lead * KSR)): min(len(x), idx[-1] + int(tail * KSR))]


def find_gaps(x, k, min_len=0.06):
    """The k longest silent runs inside x (10 ms frames under -38 dB of the peak), in time order:
    [(i0, i1), ...] in samples, or None when there are fewer than k."""
    if k == 0:
        return []
    hop = int(0.01 * KSR)
    nb = len(x) // hop
    e = np.sqrt((x[: nb * hop].reshape(nb, hop) ** 2).mean(1))
    quiet = e < np.max(e) * 10 ** (-38 / 20)
    runs, i = [], 0
    while i < nb:
        if quiet[i]:
            j = i
            while j < nb and quiet[j]:
                j += 1
            if i > 0 and j < nb and (j - i) * hop >= min_len * KSR:
                runs.append((i * hop, j * hop))
            i = j
        else:
            i += 1
    if len(runs) < k:
        return None
    runs = sorted(sorted(runs, key=lambda r: r[1] - r[0], reverse=True)[:k])
    return runs


def set_gaps(x, gaps, targets):
    """Rebuild x with each found gap set to its target length: 15 ms of the gap's own (near
    silent) edges are kept on both sides and the middle becomes digital silence."""
    x = np.array(x, float)
    keep = int(0.015 * KSR)
    out, pos = [], 0
    for (i0, i1), dur in zip(gaps, targets):
        a = min(i0 + keep, i1)
        b = max(a, i1 - keep)
        seg = x[pos:a].copy()
        n = min(keep, len(seg))
        if n:
            seg[len(seg) - n:] *= np.linspace(1, 0, n)
        out.append(seg)
        out.append(np.zeros(max(0, int(dur * KSR) - (a - i0) - (i1 - b))))
        m = min(keep, len(x) - b)
        x[b:b + m] *= np.linspace(0, 1, m)
        pos = b
    out.append(x[pos:])
    return np.concatenate(out)


def take(v, line, voice_spec, speed, seed, blend=None, blend_w=0.0):
    """One take of a line -> (audio 24k, layout)."""
    rng = np.random.default_rng(seed)
    style, lang = v.style(voice_spec)
    if blend and blend_w > 0:
        s2, _ = v.style(blend)
        style = style * (1 - blend_w) + s2 * blend_w
    pieces, layout, t = [], [], 0.0
    sents = parse(line["text"])
    for si, s in enumerate(sents):
        sp = speed * (1 + rng.normal(0, 0.012))
        if s["emph"]:
            sp *= 0.92 if s["whole_emph"] else 0.96
        x = v.say(s["text"], style, lang, sp, s["emph"])
        if s["gaps"]:
            g = find_gaps(x, len(s["gaps"]))
            if g is not None:
                x = set_gaps(x, g, s["gaps"])
        x = dsp.fade(x, 0.006, 0.012, KSR)
        layout.append({"kind": "speech", "t0": round(t, 4), "t1": round(t + len(x) / KSR, 4), "text": s["text"]})
        pieces.append(x)
        t += len(x) / KSR
        if si < len(sents) - 1:
            d = s["after"]
            layout.append({"kind": "pause", "t0": round(t, 4), "t1": round(t + d, 4), "mark": s["after_mark"] or "."})
            pieces.append(np.zeros(int(d * KSR)))
            t += d
    return np.concatenate(pieces), layout


# ───────────────────────── take scoring ─────────────────────────
def f0_track(y, sr=KSR):
    """Rough pitch track (autocorrelation, 40 ms frames, 20 ms hop) -> Hz per voiced frame."""
    hop, win = int(0.02 * sr), int(0.04 * sr)
    f0 = []
    lo, hi = int(sr / 400), int(sr / 65)
    for i in range(0, len(y) - win, hop):
        w = y[i:i + win] * np.hanning(win)
        if np.sqrt(np.mean(w ** 2)) < 0.02:
            continue
        ac = np.fft.irfft(np.abs(np.fft.rfft(w, 2 * win)) ** 2)[:win]
        j = lo + int(np.argmax(ac[lo:hi]))
        if ac[j] > 0.35 * ac[0]:
            f0.append(sr / j)
    return np.array(f0)


def score(y, layout, words, slot):
    """Higher is better: pitch movement (monotone reads sound synthetic), a natural rate, and
    fitting the time before the next cue."""
    dur = len(y) / KSR
    f0 = f0_track(y)
    spread = float(np.std(12 * np.log2(f0 / np.median(f0)))) if len(f0) > 5 else 0.0
    speech = sum(s["t1"] - s["t0"] for s in layout if s["kind"] == "speech")
    wpm = words / max(speech, 1e-3) * 60
    s = min(spread, 3.2) * 1.0
    s -= abs(wpm - 158) / 40          # 140-175 wpm reads as a person talking to you
    if slot:
        over = dur - slot
        s -= max(0, over) * 3.0        # running into the next line is the worst sin
        s -= max(0, -over - 2.5) * 0.2  # a lot of air after the line is a mild one
    return {"dur": round(dur, 3), "pitch_spread_st": round(spread, 2), "f0_med": round(float(np.median(f0)), 1) if len(f0) else 0,
            "wpm": round(wpm), "slot": slot, "score": round(s, 3)}


TAKE_SPEEDS = [1.0, 0.965, 1.035, 0.94, 1.06, 0.985]


def render(lines_path, cues_path, models, out, voice="af_heart", speed=1.0, n_takes=4, only="",
           blend=None, model_file=None, backend="auto"):
    v = open_voice(models, model_file, backend)
    lines = json.load(open(lines_path))
    cues = json.load(open(cues_path))
    at = {c["id"]: c["at"] for c in cues["vo"]}
    order = sorted(at, key=at.get)
    slot = {}
    for i, k in enumerate(order):
        nxt = at[order[i + 1]] if i + 1 < len(order) else cues["duration"] - 2.0
        slot[k] = round(nxt - at[k] - 0.35, 2)
    os.makedirs(out, exist_ok=True)
    sel_p = os.path.join(out, "takes.json")
    sel = json.load(open(sel_p)) if os.path.exists(sel_p) else {}
    for ln in lines:
        if only and ln["id"] not in only.split(","):
            continue
        d = os.path.join(out, ln["id"])
        os.makedirs(d, exist_ok=True)
        rows = []
        for t in range(n_takes):
            sp = speed * ln.get("speed", 1.0) * TAKE_SPEEDS[t % len(TAKE_SPEEDS)]
            bw = (0.0, 0.08, 0.15, 0.04, 0.12, 0.0)[t % 6] if blend else 0.0
            y, lay = take(v, ln, ln.get("voice", voice), sp, seed=zlib.crc32(f'{ln["id"]}:{t}'.encode()), blend=blend, blend_w=bw)
            p = os.path.join(d, f"take{t + 1}.wav")
            dsp.write_wav(p, y.astype(np.float32), KSR)
            json.dump({"layout": lay, "speed": round(sp, 4), "voice": ln.get("voice", voice), "blend": [blend, bw] if bw else None},
                      open(p[:-4] + ".json", "w"), indent=1)
            r = score(y, lay, spoken_words(ln["text"]), slot.get(ln["id"]))
            r["take"] = t + 1
            rows.append(r)
        best = max(rows, key=lambda r: r["score"])
        prev = sel.get(ln["id"], {})
        pick = prev.get("pick") if prev.get("locked") else best["take"]
        sel[ln["id"]] = {"pick": pick, "locked": bool(prev.get("locked")), "takes": rows}
        print(f'{ln["id"]:10s} pick take{pick}  ' + "  ".join(f'{r["take"]}:{r["dur"]:.2f}s/{r["pitch_spread_st"]}st/{r["wpm"]}wpm/{r["score"]:+.2f}' for r in rows)
              + f'  (slot {slot.get(ln["id"])}s)')
    json.dump(sel, open(sel_p, "w"), indent=1)
    tot = sum(next(r["dur"] for r in s["takes"] if r["take"] == s["pick"]) for s in sel.values())
    print(f"voice {voice} ({v.model_file}); spoken total {tot:.1f}s; picks in {sel_p} (set \"locked\": true to keep a pick)")


AUDITION_LINES = [
    ("hook", "You are small change. || With a *big* appetite."),
    ("dry", "Bigger than you? || Leave. | Don't make eye contact. | Just leave."),
    ("ten", "Ten seconds. || Keep your head down. {0.5} Coins don't have heads. | Keep it down anyway."),
]
AUDITION_VOICES = ["af_heart", "af_bella", "af_nicole", "af_aoede", "am_michael", "am_puck", "am_fenrir",
                   "bm_george", "bm_fable", "bm_lewis", "bf_emma"]


def audition(models, out, voices=None, model_file=None, backend="auto"):
    v = open_voice(models, model_file, backend)
    os.makedirs(out, exist_ok=True)
    rows = []
    for name in voices or AUDITION_VOICES:
        for lid, text in AUDITION_LINES:
            y, lay = take(v, {"id": lid, "text": text}, name, 1.0, seed=1)
            dsp.write_wav(os.path.join(out, f"{name}-{lid}.wav"), y.astype(np.float32), KSR)
            r = score(y, lay, spoken_words(text), None)
            r.update(voice=name, line=lid)
            rows.append(r)
            print(r)
    json.dump(rows, open(os.path.join(out, "audition.json"), "w"), indent=1)
