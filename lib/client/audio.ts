"use client";
// Procedural sound — all synthesized with the Web Audio API, no audio files.

type Sfx =
  | "blip"
  | "click"
  | "good"
  | "bad"
  | "whoosh"
  | "throw"
  | "catch"
  | "explode"
  | "beep"
  | "alarm"
  | "chime"
  | "pickup"
  | "death"
  | "shatter"
  | "jump"
  | "win"
  | "drum";

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  // Cached TTS voice for the Game Master — voices load async, so this fills in
  // once they're available and we re-pick on the voiceschanged event.
  private voice: SpeechSynthesisVoice | null = null;
  private voiceWatched = false;

  init() {
    if (this.ctx || typeof window === "undefined") return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const saved = localStorage.getItem("eliminated:muted");
      this.muted = saved === "1";
    } catch {
      this.ctx = null;
    }
  }

  resume() {
    this.init();
    if (this.ctx?.state === "suspended") this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (typeof window !== "undefined") localStorage.setItem("eliminated:muted", m ? "1" : "0");
    if (m) {
      this.stopMusic();
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
    }
  }

  // Pick a recognizably female voice for the Game Master, falling back to any
  // English voice and finally whatever exists. Voices populate asynchronously,
  // so subscribe to voiceschanged the first time and re-pick when they arrive.
  private pickVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
    if (!this.voiceWatched) {
      this.voiceWatched = true;
      synth.addEventListener?.("voiceschanged", () => {
        this.voice = this.chooseVoice(synth);
      });
    }
    if (!this.voice) this.voice = this.chooseVoice(synth);
    return this.voice;
  }

  private chooseVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
    const voices = synth.getVoices();
    if (!voices.length) return null;
    // Common female voice names across OSes/browsers (no standard gender flag).
    const female =
      /female|samantha|victoria|zira|karen|moira|tessa|fiona|serena|allison|susan|kate|veena|google uk english female|google us english/i;
    const en = voices.filter((v) => /^en/i.test(v.lang));
    return en.find((v) => female.test(v.name)) ?? voices.find((v) => female.test(v.name)) ?? en[0] ?? voices[0];
  }

  // Spoken voiceline via the browser's built-in TTS — no audio assets needed.
  // A flat, slightly slow female voice for a robotic Game Master PA delivery.
  speak(text: string, opts: { rate?: number; pitch?: number } = {}) {
    if (this.muted || typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    try {
      synth.cancel(); // crisp, no overlap with a previous line
      const u = new SpeechSynthesisUtterance(text);
      const v = this.pickVoice(synth);
      if (v) u.voice = v;
      u.rate = opts.rate ?? 0.85;
      u.pitch = opts.pitch ?? 0.75; // flat + low keeps it robotic without losing the female timbre
      u.volume = 1;
      synth.speak(u);
    } catch {
      /* ignore */
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain = 0.3, slideTo?: number, delay = 0) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain = 0.3, filterFreq = 1200) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t0);
  }

  sfx(name: Sfx) {
    this.resume();
    switch (name) {
      case "blip":
        this.tone(520, 0.08, "square", 0.18);
        break;
      case "click":
        this.tone(320, 0.05, "square", 0.2, 220);
        break;
      case "good":
        this.tone(523, 0.1, "sine", 0.25);
        this.tone(784, 0.14, "sine", 0.22, undefined, 0.08);
        break;
      case "bad":
        this.tone(200, 0.25, "sawtooth", 0.25, 80);
        break;
      case "whoosh":
      case "throw":
        this.noise(0.18, 0.2, 900);
        this.tone(420, 0.18, "triangle", 0.12, 700);
        break;
      case "catch":
        this.tone(660, 0.08, "sine", 0.2, 880);
        break;
      case "explode":
        this.noise(0.4, 0.45, 500);
        this.tone(120, 0.4, "sawtooth", 0.3, 40);
        break;
      case "beep":
        this.tone(880, 0.12, "square", 0.22);
        break;
      case "alarm":
        this.tone(440, 0.18, "sawtooth", 0.3, 660);
        this.tone(660, 0.18, "sawtooth", 0.25, 440, 0.18);
        break;
      case "chime":
        this.tone(660, 0.12, "sine", 0.22);
        this.tone(990, 0.18, "sine", 0.2, undefined, 0.1);
        break;
      case "pickup":
        this.tone(740, 0.07, "square", 0.2);
        this.tone(1100, 0.1, "square", 0.18, undefined, 0.06);
        break;
      case "death":
        this.noise(0.5, 0.4, 400);
        this.tone(300, 0.5, "sawtooth", 0.3, 60);
        break;
      case "shatter":
        this.noise(0.3, 0.35, 3000);
        break;
      case "jump":
        this.tone(300, 0.12, "sine", 0.2, 600);
        break;
      case "drum":
        this.noise(0.12, 0.4, 160);
        break;
      case "win":
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, "triangle", 0.25, undefined, i * 0.12));
        break;
    }
  }

  // simple tense arpeggio loop for menus / lobby
  startMusic() {
    this.resume();
    if (!this.ctx || this.muted || this.musicTimer) return;
    const scale = [220, 261.63, 293.66, 329.63, 392, 440, 523.25];
    this.musicTimer = setInterval(() => {
      if (this.muted) return;
      const n = scale[(this.step * 3) % scale.length];
      this.tone(n, 0.22, "triangle", 0.06);
      if (this.step % 4 === 0) this.tone(n / 2, 0.4, "sine", 0.05);
      this.step++;
    }, 260);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

export const audio = new AudioEngine();
