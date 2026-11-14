import type { WeaponId } from '../shared/gameConfig.ts';

class SoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;
  public masterVolume = 1;

  public setVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v));
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || this.masterVolume <= 0.001) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlock(): void {
    this.ensureContext();
  }

  public playShoot(weaponId: WeaponId, volumeScale = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.25 * volumeScale * this.masterVolume;
    masterGain.connect(ctx.destination);

    // 1. Filtered noise burst for crisp gunfire crackle
    const dur =
      weaponId === 'shotgun'
        ? 0.26
        : weaponId === 'sniper' || weaponId === 'plasma'
          ? 0.34
          : weaponId === 'gatling'
            ? 0.08
            : weaponId === 'rifle' || weaponId === 'burst'
              ? 0.14
              : 0.11;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = Math.exp(-i / (bufferSize * 0.24));
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = weaponId === 'shotgun' || weaponId === 'plasma' ? 'lowpass' : 'bandpass';
    filter.Q.value = weaponId === 'sniper' ? 2.2 : 1.1;
    filter.frequency.setValueAtTime(
      weaponId === 'sniper'
        ? 2200
        : weaponId === 'smg'
          ? 1650
          : weaponId === 'gatling'
            ? 1500
            : weaponId === 'shotgun'
              ? 720
              : weaponId === 'plasma'
                ? 920
                : weaponId === 'burst'
                  ? 1750
                  : weaponId === 'rifle'
                    ? 1250
                    : 1400,
      now,
    );
    filter.frequency.exponentialRampToValueAtTime(280, now + dur);
    noise.connect(filter);
    filter.connect(masterGain);
    noise.start(now);

    // 2. Sub-bass punch thump
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(
      weaponId === 'shotgun' || weaponId === 'sniper' || weaponId === 'plasma' ? 155 : 120,
      now,
    );
    subOsc.frequency.exponentialRampToValueAtTime(34, now + 0.095);
    subGain.gain.setValueAtTime(
      weaponId === 'shotgun' || weaponId === 'plasma' ? 0.92 : weaponId === 'gatling' ? 0.42 : 0.55,
      now,
    );
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.105);
    subOsc.connect(subGain);
    subGain.connect(masterGain);
    subOsc.start(now);
    subOsc.stop(now + 0.115);

    // 3. Sci-fi plasma/mechanical transient body
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type =
      weaponId === 'sniper' || weaponId === 'plasma'
        ? 'sawtooth'
        : weaponId === 'rifle' || weaponId === 'gatling'
          ? 'square'
          : 'triangle';

    const startFreq =
      weaponId === 'pistol'
        ? 620
        : weaponId === 'smg'
          ? 740
          : weaponId === 'gatling'
            ? 560
            : weaponId === 'shotgun'
              ? 240
              : weaponId === 'rifle'
                ? 460
                : weaponId === 'burst'
                  ? 820
                  : weaponId === 'plasma'
                    ? 360
                    : 1180;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(weaponId === 'plasma' ? 95 : 55, now + dur * 0.85);

    oscGain.gain.setValueAtTime(
      weaponId === 'rifle' ? 0.38 : weaponId === 'gatling' ? 0.28 : 0.55,
      now,
    );
    oscGain.gain.exponentialRampToValueAtTime(0.008, now + dur);

    osc.connect(oscGain);
    oscGain.connect(masterGain);
    osc.start(now);
    osc.stop(now + dur);
  }

  public playHitmarker(headshot = false, killed = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Crisp tactile tick
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = headshot ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(headshot ? 1950 : 1220, now);
    osc.frequency.exponentialRampToValueAtTime(headshot ? 2650 : 720, now + 0.065);
    gain.gain.setValueAtTime(headshot ? 0.24 : 0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);

    // Headshot metallic *TING*
    if (headshot) {
      const ding = ctx.createOscillator();
      const dingGain = ctx.createGain();
      ding.type = 'sine';
      ding.frequency.setValueAtTime(2880, now + 0.015);
      ding.frequency.exponentialRampToValueAtTime(2100, now + 0.14);
      dingGain.gain.setValueAtTime(0.16, now + 0.015);
      dingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      ding.connect(dingGain);
      dingGain.connect(ctx.destination);
      ding.start(now + 0.015);
      ding.stop(now + 0.16);
    }

    // Satisfying kill confirm double-chime + sub drop
    if (killed) {
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(160, now);
      sub.frequency.exponentialRampToValueAtTime(42, now + 0.16);
      subGain.gain.setValueAtTime(0.28, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      sub.connect(subGain);
      subGain.connect(ctx.destination);
      sub.start(now);
      sub.stop(now + 0.18);

      [880, 1320].forEach((freq, idx) => {
        const chime = ctx.createOscillator();
        const cGain = ctx.createGain();
        chime.type = 'triangle';
        chime.frequency.setValueAtTime(freq, now + idx * 0.045);
        cGain.gain.setValueAtTime(0.14, now + idx * 0.045);
        cGain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.045 + 0.14);
        chime.connect(cGain);
        cGain.connect(ctx.destination);
        chime.start(now + idx * 0.045);
        chime.stop(now + idx * 0.045 + 0.15);
      });
    }
  }

  public playDamageTaken(headshot = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Heavy low impact thud
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(headshot ? 900 : 480, now);
    osc.frequency.setValueAtTime(headshot ? 175 : 130, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.14);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playImpact(volumeScale = 0.25): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const base = 1800 + Math.random() * 900;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 0.45, now + 0.05);
    gain.gain.setValueAtTime(0.07 * volumeScale, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  public playFootstep(sprinting = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(sprinting ? 115 : 95, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.045);
    gain.gain.setValueAtTime(sprinting ? 0.055 : 0.038, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  public playLand(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(105, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.1);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  public playReload(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [0, 0.14].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(i === 0 ? 320 : 520, now + offset);
      gain.gain.setValueAtTime(0.08, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.065);
    });
  }

  public playFlagPickup(isOwnTeamAction: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = isOwnTeamAction ? [523, 659, 784] : [440, 349];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.08);
      gain.gain.setValueAtTime(0.14, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.17);
    });
  }

  public playFlagReturn(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [587, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.07);
      gain.gain.setValueAtTime(0.14, now + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.07);
      osc.stop(now + i * 0.07 + 0.15);
    });
  }

  public playFlagCapture(friendlyScored: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = friendlyScored ? [523, 659, 784, 1046] : [392, 349, 293, 220];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;

      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      gain.gain.setValueAtTime(0.14, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.25);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.26);
    });
  }

  public playPurchase(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [660, 880, 1174].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.055);
      gain.gain.setValueAtTime(0.12, now + i * 0.055);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.055);
      osc.stop(now + i * 0.055 + 0.13);
    });
  }

  public playJump(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.09);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  public playThrow(volumeScale = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 0.14;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufferSize) * Math.PI);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(520, now);
    filter.frequency.exponentialRampToValueAtTime(1400, now + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18 * volumeScale * this.masterVolume, now);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
  }

  public playExplosion(volumeScale = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = Math.max(0.05, Math.min(1, volumeScale)) * this.masterVolume;

    // Deep sub-bass boom
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(115, now);
    sub.frequency.exponentialRampToValueAtTime(24, now + 0.45);
    subGain.gain.setValueAtTime(0.55 * vol, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.5);

    // Explosion roar noise
    const dur = 0.55;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.28));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1450, now);
    filter.frequency.exponentialRampToValueAtTime(140, now + dur);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.42 * vol, now);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);
  }

  public playSmokeDeploy(volumeScale = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 0.65;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = Math.min(1, i / (bufferSize * 0.08)) * Math.exp(-i / (bufferSize * 0.42));
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(2200, now);
    filter.frequency.exponentialRampToValueAtTime(620, now + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.28 * volumeScale * this.masterVolume, now);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
  }

  public playEmpBlast(volumeScale = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = Math.max(0.05, Math.min(1, volumeScale)) * this.masterVolume;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(980, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.36);
    gain.gain.setValueAtTime(0.26 * vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);

    const sub = ctx.createOscillator();
    const sGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(160, now);
    sub.frequency.exponentialRampToValueAtTime(38, now + 0.24);
    sGain.gain.setValueAtTime(0.32 * vol, now);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    sub.connect(sGain);
    sGain.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.26);
  }
}

export const soundEngine = new SoundEngine();
