#!/usr/bin/env python3
"""Tạo nhạc disco tự tổng hợp (không bản quyền) cho bar: locations/bar/music/song1..5.mp3.

Mọi âm thanh do code sinh ra (trống, bass, hợp âm, giai điệu), không dùng mẫu nhạc nào.
Cần: python3 + numpy, ffmpeg (có libmp3lame).
Chạy: python3 scripts/tao-nhac.py
"""
import os
import subprocess
import sys

import numpy as np

SR = 44100
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'locations', 'bar', 'music')

# Mỗi bài: bpm khớp location.json, giọng (nốt MIDI gốc), vòng hợp âm (bậc so với gốc + loại), seed giai điệu
SONGS = [
    {'file': 'song1.mp3', 'bpm': 128, 'root': 45, 'prog': [(0, 'm7'), (5, 'm7'), (10, 'maj'), (3, 'maj7')], 'seed': 1, 'bars': 64},
    {'file': 'song2.mp3', 'bpm': 118, 'root': 48, 'prog': [(0, 'maj7'), (9, 'm7'), (5, 'maj7'), (7, 'dom7')], 'seed': 2, 'bars': 60},
    {'file': 'song3.mp3', 'bpm': 96, 'root': 50, 'prog': [(0, 'm7'), (7, 'm7'), (5, 'maj7'), (10, 'dom7')], 'seed': 3, 'bars': 52, 'chill': True},
    {'file': 'song4.mp3', 'bpm': 140, 'root': 41, 'prog': [(0, 'm7'), (0, 'm7'), (8, 'maj'), (10, 'maj')], 'seed': 4, 'bars': 72},
    {'file': 'song5.mp3', 'bpm': 124, 'root': 43, 'prog': [(0, 'maj'), (5, 'maj'), (9, 'm7'), (7, 'dom7')], 'seed': 5, 'bars': 64},
]

CHORDS = {'maj': [0, 4, 7], 'm7': [0, 3, 7, 10], 'maj7': [0, 4, 7, 11], 'dom7': [0, 4, 7, 10]}


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def env(n, attack=0.005, release=0.05, decay=None):
    """Đường bao âm lượng: lên nhanh, (tuỳ chọn) tắt dần theo hàm mũ, nhả cuối."""
    t = np.arange(n) / SR
    e = np.ones(n)
    a = max(1, int(attack * SR))
    e[:a] = np.linspace(0, 1, a)
    if decay:
        e *= np.exp(-t / decay)
    r = min(n, max(1, int(release * SR)))
    e[-r:] *= np.linspace(1, 0, r)
    return e


def saw(freq, n, cutoff=4000.0, detune=0.0):
    """Sóng răng cưa cộng hoạ âm, chỉ lấy hoạ âm dưới cutoff (tự lọc thấp, không bị rè)."""
    t = np.arange(n) / SR
    out = np.zeros(n)
    for f in (freq * (1 - detune), freq * (1 + detune)) if detune else (freq,):
        k = 1
        while k * f < min(cutoff, SR / 2 - 1000):
            out += np.sin(2 * np.pi * k * f * t) / k * (1.0 if k * f < cutoff * 0.5 else 0.5)
            k += 1
    return out / (2 if detune else 1)


def square(freq, n, cutoff=5000.0):
    t = np.arange(n) / SR
    out = np.zeros(n)
    k = 1
    while k * freq < cutoff:
        out += np.sin(2 * np.pi * k * freq * t) / k
        k += 2
    return out


def highpass_noise(n, low_hz, rng):
    x = rng.standard_normal(n)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    spec[freqs < low_hz] = 0
    return np.fft.irfft(spec, n)


def bandpass_noise(n, lo, hi, rng):
    x = rng.standard_normal(n)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    spec[(freqs < lo) | (freqs > hi)] = 0
    return np.fft.irfft(spec, n)


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 50 + 110 * np.exp(-t / 0.03)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * np.exp(-t / 0.12) * 1.0


def make_drums(rng):
    clap_n = int(0.2 * SR)
    clap = np.zeros(clap_n)
    for off in (0, 0.01, 0.02):  # tiếng vỗ tay = vài nhát nhiễu sát nhau
        s = int(off * SR)
        burst = bandpass_noise(clap_n - s, 900, 5000, rng) * env(clap_n - s, 0.001, 0.02, 0.05)
        clap[s:] += burst
    hat_c = highpass_noise(int(0.05 * SR), 7000, rng) * env(int(0.05 * SR), 0.001, 0.01, 0.015)
    hat_o = highpass_noise(int(0.2 * SR), 6000, rng) * env(int(0.2 * SR), 0.001, 0.03, 0.05)
    return {'kick': kick(), 'clap': clap * 0.5, 'hat_c': hat_c * 0.1, 'hat_o': hat_o * 0.12}


def add(buf, sig, start, pan=0.0, gain=1.0):
    """Cộng tín hiệu mono vào buffer stereo tại mẫu start, pan -1 (trái) .. 1 (phải)."""
    if start >= buf.shape[1]:
        return
    end = min(buf.shape[1], start + len(sig))
    s = sig[: end - start] * gain
    buf[0, start:end] += s * np.sqrt((1 - pan) / 2) * 1.414
    buf[1, start:end] += s * np.sqrt((1 + pan) / 2) * 1.414


def render(song):
    rng = np.random.default_rng(song['seed'])
    bpm, root, prog, bars = song['bpm'], song['root'], song['prog'], song['bars']
    chill = song.get('chill', False)
    beat = 60.0 / bpm
    step = beat / 4  # nốt móc kép
    total = int((bars * 4 * beat + 2.0) * SR)
    mix = np.zeros((2, total))
    lead_bus = np.zeros((2, total))
    drums = make_drums(rng)

    # Bố cục: intro (trống + bass) → A (đủ bộ) → break (không trống kick) → drop (đủ bộ + giai điệu) → outro
    q = bars // 8
    sections = (['intro'] * q + ['A'] * (2 * q) + ['break'] * q + ['drop'] * (3 * q))
    sections += ['outro'] * (bars - len(sections))

    # Giai điệu: ngũ cung theo giọng, sinh 2 câu 2 nhịp rồi lặp lại cho dễ nhớ
    scale = [0, 3, 5, 7, 10] if prog[0][1] in ('m7',) else [0, 2, 4, 7, 9]
    motifs = []
    for _ in range(2):
        notes = []
        for s16 in range(32):
            if rng.random() < (0.35 if chill else 0.5) and s16 % 2 == 0:
                deg = rng.integers(0, len(scale))
                octave = 12 * rng.integers(1, 3)
                notes.append((s16, root + 12 + scale[deg] + octave, int(rng.integers(1, 4))))
        motifs.append(notes)

    for bar in range(bars):
        sec = sections[bar]
        bar_start = bar * 4 * beat
        chord_root, kind = prog[bar % len(prog)]
        croot = root + chord_root
        energy = {'intro': 0.7, 'A': 1.0, 'break': 0.6, 'drop': 1.1, 'outro': 0.7}[sec]

        for b in range(4):
            t0 = bar_start + b * beat
            i0 = int(t0 * SR)
            # Trống: kick đều 4 phách (disco), clap phách 2 & 4, hi-hat mở ở phách lẻ
            if sec != 'break' and not (chill and sec == 'intro' and b % 2):
                add(mix, drums['kick'], i0, 0, 0.9 * (0.8 if chill else 1))
            if b % 2 == 1 and sec != 'intro':
                add(mix, drums['clap'], i0, 0.1, 0.8)
            for k in range(4):
                ik = int((t0 + k * step) * SR)
                if k == 2:
                    add(mix, drums['hat_o'], ik, 0.4, 0.9 if sec != 'break' else 0.4)
                elif not chill or k == 0:
                    add(mix, drums['hat_c'], ik, -0.3, 0.7 + 0.2 * (k % 2))

        # Bass disco: nảy quãng tám theo móc đơn
        if sec != 'break':
            for e8 in range(8):
                note = croot - 12 + (12 if e8 % 2 else 0)
                if chill and e8 % 4 == 3:
                    note = croot - 12 + 7
                n = int(step * 2 * SR * 0.9)
                sig = saw(hz(note), n, cutoff=900 if not chill else 600) * env(n, 0.003, 0.03, 0.18)
                add(mix, sig, int((bar_start + e8 * step * 2) * SR), 0, 0.42 * energy)

        # Hợp âm: đánh chặt (stab) ở nhịp nghịch; đoạn break thì ngân dài
        tones = [croot + 12 + iv for iv in CHORDS[kind]]
        if sec == 'break' or chill:
            n = int(4 * beat * SR)
            pad = sum(saw(hz(m), n, cutoff=2500, detune=0.004) for m in tones)
            add(mix, pad * env(n, 0.3, 0.6), int(bar_start * SR), 0, 0.09)
        if sec != 'break':
            for b in range(4):
                n = int(step * 1.4 * SR)
                stab = sum(saw(hz(m), n, cutoff=3500, detune=0.006) for m in tones)
                for side, pan in ((0, -0.5), (1, 0.5)):
                    add(mix, stab * env(n, 0.002, 0.03, 0.08), int((bar_start + b * beat + 2 * step) * SR) + side * 200, pan, 0.1 * energy)

        # Giai điệu ở đoạn drop (và nhẹ ở A)
        if sec in ('drop', 'A') and not (sec == 'A' and bar % 2):
            motif = motifs[(bar // 2) % 2]
            half = (bar % 2) * 16
            for s16, m, length in motif:
                if half <= s16 < half + 16:
                    n = int(step * length * SR)
                    sig = (square(hz(m), n) * 0.6 + saw(hz(m), n, 4000) * 0.4) * env(n, 0.005, 0.04, 0.25)
                    add(lead_bus, sig, int((bar_start + (s16 - half) * step) * SR), 0, 0.12 if sec == 'drop' else 0.07)

    # Vang (delay) cho giai điệu: dội nhịp chấm, đảo trái phải
    d = int(beat * 0.75 * SR)
    echo = np.zeros_like(lead_bus)
    echo[0, d:] = lead_bus[1, :-d] * 0.35
    echo[1, d:] = lead_bus[0, :-d] * 0.35
    echo[0, 2 * d:] += lead_bus[0, :-2 * d] * 0.15
    mix += lead_bus + echo

    # Fade cuối, nén mềm, chuẩn hoá
    fade = int(3 * SR)
    mix[:, -fade:] *= np.linspace(1, 0, fade)
    mix = np.tanh(mix * 1.3)
    mix /= np.max(np.abs(mix)) + 1e-9
    return (mix * 0.8).astype(np.float32)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    only = set(sys.argv[1:])
    for song in SONGS:
        if only and song['file'] not in only:
            continue
        audio = render(song)
        out = os.path.abspath(os.path.join(OUT_DIR, song['file']))
        pcm = (audio.T * 32767).astype('<i2').tobytes()
        subprocess.run(
            ['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', str(SR), '-ac', '2', '-i', '-',
             '-codec:a', 'libmp3lame', '-b:a', '128k', out],
            input=pcm, check=True)
        print(f'{song["file"]}: {song["bpm"]} bpm, {audio.shape[1] / SR:.0f} giây')


if __name__ == '__main__':
    main()
