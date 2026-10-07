// GIỌNG NÓI GIỮA ĐÁM ĐÔNG: phát giọng đọc bình luận đúng chỗ nhân vật đứng trong quán.
//
// Mỗi giọng đi qua một chuỗi xử lý riêng (Web Audio):
//   nguồn -> lọc trầm (bỏ ù) -> lọc cao (người xa: đục hơn) -> âm lượng (xa: nhỏ) -> trái/phải (theo vị trí trên màn hình)
//                                                           \-> gửi sang vang phòng (xa: vang nhiều hơn)
// Tất cả trộn vào một bộ nén chung để nhiều tiếng đè lên nhau mà không vỡ, vẫn rõ.
// Người vừa nói nghe rõ nhất; các giọng đang nói dở nhỏ dần ("hiệu ứng tiệc cocktail").
// Quán đông: phát thêm tiếng rì rầm nền từ chính các câu đã nói (phát ngược + lọc đục) -> nghe ra đám đông mà không ra lời.

const AC = window.AudioContext || window.webkitAudioContext;
const MAX_VOICES = 4;
const STALE_MS = 6000; // câu làm giọng quá lâu thì bỏ (đã trôi qua rồi)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class CrowdVoices {
  constructor({ volume = 1 } = {}) {
    this.volume = volume;
    this.ctx = null;
    this.active = [];
    this.recent = []; // vài câu gần nhất (đã phát ngược) để làm tiếng rì rầm
    this.nextWalla = 0;
    this.walla = 0;
  }

  /** Tạo bộ trộn lần đầu; gọi lại khi người dùng bấm vào trang để mở tiếng (trình duyệt chặn tự phát). */
  unlock() {
    if (!AC) return;
    if (!this.ctx) this.#build();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get speaking() {
    return this.active.length;
  }

  #build() {
    const ctx = new AC();
    this.ctx = ctx;
    // bộ nén chung: nhiều giọng chồng nhau vẫn đều tiếng, không bị vỡ
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    comp.connect(this.master).connect(ctx.destination);
    this.bus = comp;
    // vang phòng: tiếng dội của quán bar (tự tạo, không cần file)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.#roomImpulse(1.7);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(comp);
  }

  /** Tiếng vang phòng: nhiễu tắt dần + vài tiếng dội sớm từ tường. */
  #roomImpulse(sec) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2) * 0.55;
      for (const [ms, g] of [
        [11 + ch * 4, 0.7],
        [23 + ch * 3, 0.45],
        [37 - ch * 5, 0.3],
      ]) {
        const at = Math.floor((ms / 1000) * ctx.sampleRate);
        d[at] += g;
      }
    }
    return buf;
  }

  /**
   * Phát một câu. spot(): vị trí người nói lúc này { pan -1..1, depth 0 (xa) .. 1 (gần), onScreen, focus }.
   * rate: tốc độ/cao độ riêng của người nói. Trả về thời lượng (giây) hoặc 0 nếu bỏ qua.
   */
  async play(url, spot, { rate = 1 } = {}) {
    if (!AC) return 0;
    this.unlock();
    const t0 = performance.now();
    let buf;
    try {
      const res = await fetch(url);
      if (!res.ok) return 0;
      buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      return 0;
    }
    if (performance.now() - t0 > STALE_MS || this.ctx.state !== 'running') return 0;
    const ctx = this.ctx;
    // quá nhiều người nói cùng lúc: cho câu cũ nhất tắt dần
    while (this.active.length >= MAX_VOICES) this.#stop(this.active[0], 0.25);
    // người vừa nói rõ nhất, các giọng đang nói dở lùi xuống
    for (const v of this.active) v.focus *= 0.62;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 130;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const send = ctx.createGain();
    src.connect(hp).connect(lp).connect(gain);
    if (pan) gain.connect(pan).connect(this.bus);
    else gain.connect(this.bus);
    gain.connect(send).connect(this.reverb);

    const v = { src, lp, gain, pan, send, spot, focus: 1 };
    this.active.push(v);
    this.#apply(v, 0.02);
    src.onended = () => this.#remove(v);
    src.start();
    this.#remember(buf);
    return buf.duration / rate;
  }

  /** Cập nhật mỗi khung hình: camera lia, nhân vật đi lại -> tiếng chạy theo. */
  update() {
    for (const v of this.active) this.#apply(v, 0.12);
  }

  #apply(v, smooth) {
    const p = v.spot?.() || { pan: 0, depth: 0.5, onScreen: true };
    const t = this.ctx.currentTime;
    const d = clamp(p.depth, 0, 1);
    const off = p.onScreen ? 0 : 1;
    const g = (0.32 + 0.68 * d) * v.focus * (off ? 0.5 : 1) * (p.focus ? 1.2 : 1);
    v.gain.gain.setTargetAtTime(g, t, smooth);
    v.lp.frequency.setTargetAtTime(off ? 1500 : 2600 + d * 8500, t, smooth);
    v.send.gain.setTargetAtTime(clamp(0.55 - 0.42 * d + off * 0.2, 0.08, 0.8), t, smooth);
    v.pan?.pan.setTargetAtTime(clamp(p.pan, -0.85, 0.85), t, smooth);
  }

  #stop(v, fade) {
    const t = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(0, t, fade / 3);
    try {
      v.src.stop(t + fade);
    } catch {
      // đã dừng
    }
    this.#remove(v);
  }

  #remove(v) {
    const i = this.active.indexOf(v);
    if (i >= 0) this.active.splice(i, 1);
  }

  /** Giữ 8 câu gần nhất, phát ngược (nghe như người nói nhưng không ra chữ) cho tiếng rì rầm. */
  #remember(buf) {
    const rev = this.ctx.createBuffer(1, buf.length, buf.sampleRate);
    const s = buf.getChannelData(0);
    const d = rev.getChannelData(0);
    for (let i = 0, n = s.length; i < n; i++) d[i] = s[n - 1 - i];
    this.recent.push(rev);
    if (this.recent.length > 8) this.recent.shift();
  }

  /**
   * Tiếng rì rầm nền khi quán đông (gọi mỗi khung hình). crowd: số người trong quán.
   * Càng đông càng dày tiếng; rất nhỏ + đục + vang để không lấn giọng chính.
   */
  ambience(crowd) {
    if (!this.ctx || this.ctx.state !== 'running' || crowd < 12 || !this.recent.length) return;
    const now = this.ctx.currentTime;
    if (now < this.nextWalla || this.walla >= 3) return;
    const dense = clamp((crowd - 12) / 80, 0, 1);
    this.nextWalla = now + 1.4 - dense * 0.9 + Math.random() * 0.6;
    const buf = this.recent[Math.floor(Math.random() * this.recent.length)];
    const len = Math.min(buf.duration, 0.8 + Math.random() * 1.0);
    const start = Math.random() * Math.max(0, buf.duration - len);
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.9 + Math.random() * 0.22;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + Math.random() * 600;
    const g = ctx.createGain();
    const level = (0.05 + dense * 0.05) * (this.active.length ? 0.6 : 1);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(level, now + 0.15);
    g.gain.setValueAtTime(level, now + len - 0.2);
    g.gain.linearRampToValueAtTime(0, now + len);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = Math.random() * 1.6 - 0.8;
    src.connect(lp).connect(g);
    (pan ? g.connect(pan) : g).connect(this.reverb);
    (pan || g).connect(this.bus);
    this.walla++;
    src.onended = () => this.walla--;
    src.start(now, start, len);
  }
}
