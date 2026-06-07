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
  // Cached TTS voices for the Game Master — a female voice for eliminations and
  // a male voice for game announcements. Voices load async, so these fill in
  // once they're available and we re-pick on the voiceschanged event.
  private voiceF: SpeechSynthesisVoice | null = null;
  private voiceM: SpeechSynthesisVoice | null = null;
  private voiceWatched = false;
  // Keep-alive ticker for long TTS roll calls (see speak()).
  private speakTimer: ReturnType<typeof setInterval> | null = null;

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
      this.stopKeepAlive();
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
    }
  }

  // Pick the Game Master voice for the requested gender, falling back to any
  // English voice of the right gender and finally whatever exists. Voices
  // populate asynchronously, so subscribe to voiceschanged the first time and
  // re-pick both voices when they arrive.
  private pickVoice(synth: SpeechSynthesis, gender: "f" | "m"): SpeechSynthesisVoice | null {
    if (!this.voiceWatched) {
      this.voiceWatched = true;
      synth.addEventListener?.("voiceschanged", () => {
        this.voiceF = this.chooseVoice(synth, "f");
        this.voiceM = this.chooseVoice(synth, "m");
      });
    }
    if (gender === "m") {
      if (!this.voiceM) this.voiceM = this.chooseVoice(synth, "m");
      return this.voiceM;
    }
    if (!this.voiceF) this.voiceF = this.chooseVoice(synth, "f");
    return this.voiceF;
  }

  private chooseVoice(synth: SpeechSynthesis, gender: "f" | "m"): SpeechSynthesisVoice | null {
    const voices = synth.getVoices();
    if (!voices.length) return null;
    // Common gendered voice names across OSes/browsers (no standard gender flag).
    // Word boundaries matter: \bmale\b must NOT match "Female", \bman\b not "Woman".
    const female =
      /\b(?:female|woman|samantha|victoria|allison|ava|susan|karen|moira|tessa|fiona|serena|veena|kate|zira|aria|jenny|michelle|catherine|hazel|heather|nicky)\b/i;
    const male =
      /\b(?:male|man|alex|daniel|fred|david|mark|george|james|arthur|oliver|thomas|aaron|gordon|rishi|guy|davis|ralph|albert|bruce|tom|tony)\b/i;
    const en = voices.filter((v) => /^en/i.test(v.lang));
    const pool = en.length ? en : voices;
    const want = gender === "m" ? male : female;
    const avoid = gender === "m" ? female : male;
    return (
      pool.find((v) => want.test(v.name)) ?? // a voice of the desired gender
      pool.find((v) => !avoid.test(v.name)) ?? // failing that, at least not the other gender
      pool[0] ??
      voices[0]
    );
  }

  // The Web Speech API (Chrome especially) silently truncates a single
  // utterance — or a queue — that runs past ~15s, so a long elimination roll
  // call ("Players 0 0 1, 0 0 2, …, eliminated.") gets cut off mid-list. Break
  // the line into short clause-sized chunks that each speak well under that
  // limit, queued back to back, packing pieces up to a word/char budget.
  private chunkText(text: string, maxWords = 16, maxChars = 180): string[] {
    const wc = (s: string) => (s.trim().match(/\S+/g) ?? []).length;
    if (wc(text) <= maxWords && text.length <= maxChars) return [text];
    // Clause-sized pieces, keeping their trailing punctuation and spacing.
    const pieces = text.match(/[^,;.!?]+[,;.!?]*\s*/g) ?? [text];
    const chunks: string[] = [];
    let buf = "";
    for (const p of pieces) {
      if (buf && (wc(buf) + wc(p) > maxWords || (buf + p).length > maxChars)) {
        chunks.push(buf.trim());
        buf = "";
      }
      buf += p;
    }
    if (buf.trim()) chunks.push(buf.trim());
    return chunks;
  }

  // Chrome halts a long speech queue after ~15s; a periodic pause+resume keeps
  // it ticking until the roll call finishes. Stops itself once speech is done.
  private startKeepAlive(synth: SpeechSynthesis) {
    this.stopKeepAlive();
    this.speakTimer = setInterval(() => {
      if (!synth.speaking) {
        this.stopKeepAlive();
        return;
      }
      synth.pause();
      synth.resume();
    }, 10000);
  }

  private stopKeepAlive() {
    if (this.speakTimer) clearInterval(this.speakTimer);
    this.speakTimer = null;
  }

  // Spoken voiceline via the browser's built-in TTS — no audio assets needed.
  // A flat, slightly slow robotic Game Master PA delivery. voice "f" (the
  // default) is the female eliminations voice; "m" is the male announcer.
  speak(text: string, opts: { rate?: number; pitch?: number; voice?: "f" | "m" } = {}) {
    if (this.muted || typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    try {
      synth.cancel(); // crisp, no overlap with a previous line
      this.stopKeepAlive();
      const gender = opts.voice ?? "f";
      const v = this.pickVoice(synth, gender);
      const rate = opts.rate ?? 0.85;
      // flat + low keeps it robotic without losing the gendered timbre
      const pitch = opts.pitch ?? (gender === "m" ? 0.7 : 0.8);
      const chunks = this.chunkText(text);
      chunks.forEach((part, i) => {
        const u = new SpeechSynthesisUtterance(part);
        if (v) u.voice = v;
        u.rate = rate;
        u.pitch = pitch;
        u.volume = 1;
        // Tear down the keep-alive when the last chunk finishes or errors.
        if (i === chunks.length - 1) u.onend = u.onerror = () => this.stopKeepAlive();
        synth.speak(u);
      });
      // Only long, multi-chunk lines risk the timeout; short ones speak fine.
      if (chunks.length > 1) this.startKeepAlive(synth);
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
