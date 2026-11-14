import * as THREE from 'three';
import type { PingKind, Vec3, WeaponId } from '../shared/gameConfig.ts';

export interface SpatialAudioOptions {
  sourcePos?: Vec3;
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
  volumeScale?: number;
  panOverride?: number;
}

export interface SpatialMixResult {
  audible: boolean;
  distance: number;
  attenuation: number;
  pan: number;
  rearFactor: number;
}

// Pre-allocated math helpers (zero GC on frequent audio triggers)
const _listenerPos = new THREE.Vector3();
const _listenerQuat = new THREE.Quaternion();
const _listenerScale = new THREE.Vector3();
const _listenerRight = new THREE.Vector3();
const _listenerForward = new THREE.Vector3();
const _toSource = new THREE.Vector3();

class SoundEngine {
  private ctx: AudioContext | null = null;
  private listener: THREE.AudioListener | null = null;
  private _muted = false;
  public masterVolume = 1;

  public get muted(): boolean {
    return this._muted;
  }

  public set muted(value: boolean) {
    this._muted = value;
    this.syncListenerVolume();
  }

  public attachListener(listener: THREE.AudioListener): void {
    this.listener = listener;
    this.ctx = listener.context;
    this.syncListenerVolume();
  }

  public detachListener(listener?: THREE.AudioListener): void {
    if (!listener || this.listener === listener) {
      this.listener = null;
    }
  }

  public getListener(): THREE.AudioListener | null {
    return this.listener;
  }

  public setVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v));
    this.syncListenerVolume();
  }

  private syncListenerVolume(): void {
    if (this.listener) {
      this.listener.setMasterVolume(this._muted ? 0 : this.masterVolume);
    }
  }

  private ensureContext(): AudioContext | null {
    if (this._muted || this.masterVolume <= 0.001) return null;
    if (this.listener) {
      this.ctx = this.listener.context;
    } else if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

  private getMasterDestination(ctx: AudioContext): AudioNode {
    if (this.listener && this.listener.context === ctx) {
      return this.listener.getInput();
    }
    return ctx.destination;
  }

  private getLocalVolumeScale(): number {
    // When routed into THREE.AudioListener, listener.gain already applies masterVolume
    return this.listener ? 1 : this.masterVolume;
  }

  /**
   * Computes 3D distance attenuation and relative-vector stereo panning
   * against the Three.js AudioListener attached to the local player camera.
   */
  public computeSpatialMix(
    sourcePos: Vec3,
    refDistance = 5,
    maxDistance = 52,
    rolloffFactor = 0.9,
  ): SpatialMixResult {
    if (!this.listener) {
      return { audible: true, distance: 0, attenuation: 1, pan: 0, rearFactor: 0 };
    }

    if (this.listener.parent) {
      this.listener.parent.updateMatrixWorld();
    } else {
      this.listener.updateMatrixWorld();
    }
    this.listener.matrixWorld.decompose(_listenerPos, _listenerQuat, _listenerScale);

    _toSource.set(
      sourcePos.x - _listenerPos.x,
      sourcePos.y - _listenerPos.y,
      sourcePos.z - _listenerPos.z,
    );
    const distance = _toSource.length();
    if (distance >= maxDistance) {
      return { audible: false, distance, attenuation: 0, pan: 0, rearFactor: 0 };
    }

    const clampedDist = Math.max(refDistance, distance);
    const inverse = refDistance / (refDistance + rolloffFactor * (clampedDist - refDistance));
    const edgeFade = Math.max(0, 1 - Math.pow(distance / maxDistance, 2.2));
    const attenuation = Math.max(0, Math.min(1, inverse * edgeFade));

    if (distance <= 0.001) {
      return { audible: attenuation > 0.004, distance, attenuation, pan: 0, rearFactor: 0 };
    }

    _toSource.divideScalar(distance);
    _listenerRight.set(1, 0, 0).applyQuaternion(_listenerQuat).normalize();
    _listenerForward.set(0, 0, -1).applyQuaternion(_listenerQuat).normalize();

    const pan = Math.max(-0.96, Math.min(0.96, _toSource.dot(_listenerRight)));
    const frontDot = _toSource.dot(_listenerForward);
    const rearFactor = Math.max(0, -frontDot);

    return {
      audible: attenuation > 0.004,
      distance,
      attenuation,
      pan,
      rearFactor,
    };
  }

  private createSpatialOutput(
    ctx: AudioContext,
    opts?: SpatialAudioOptions,
    defaultRef = 5,
    defaultMax = 52,
    defaultRolloff = 0.9,
  ): { node: AudioNode; gainScale: number } | null {
    const baseDest = this.getMasterDestination(ctx);
    let gainScale = (opts?.volumeScale ?? 1) * this.getLocalVolumeScale();
    let pan = opts?.panOverride ?? 0;
    let rearFactor = 0;
    let distanceRatio = 0;

    if (opts?.sourcePos) {
      const maxDist = opts.maxDistance ?? defaultMax;
      const mix = this.computeSpatialMix(
        opts.sourcePos,
        opts.refDistance ?? defaultRef,
        maxDist,
        opts.rolloffFactor ?? defaultRolloff,
      );
      if (!mix.audible) return null;
      gainScale *= mix.attenuation;
      pan = mix.pan;
      rearFactor = mix.rearFactor;
      distanceRatio = Math.min(1, mix.distance / Math.max(1, maxDist));
    }

    const outGain = ctx.createGain();
    outGain.gain.value = Math.max(0.001, gainScale);

    let chainTail: AudioNode = baseDest;

    const clampedPan = Math.max(-0.96, Math.min(0.96, pan));
    if (Math.abs(clampedPan) > 0.015 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clampedPan;
      panner.connect(chainTail);
      chainTail = panner;
    }

    // Subtle distance + behind-listener acoustic air absorption
    if (opts?.sourcePos && (distanceRatio > 0.18 || rearFactor > 0.25)) {
      const airFilter = ctx.createBiquadFilter();
      airFilter.type = 'lowpass';
      const cutoff = Math.max(2200, 16500 - distanceRatio * 10500 - rearFactor * 3600);
      airFilter.frequency.setValueAtTime(cutoff, ctx.currentTime);
      airFilter.connect(chainTail);
      chainTail = airFilter;
    }

    outGain.connect(chainTail);
    return { node: outGain, gainScale };
  }

  private resolveSpatialArgs(
    volumeScaleOrSpatial: number | SpatialAudioOptions,
    pan: number,
    defaults: { refDistance: number; maxDistance: number; rolloffFactor: number },
  ): SpatialAudioOptions {
    if (typeof volumeScaleOrSpatial === 'number') {
      return {
        volumeScale: volumeScaleOrSpatial,
        panOverride: pan,
        ...defaults,
      };
    }
    return {
      ...defaults,
      ...volumeScaleOrSpatial,
    };
  }

  public playShoot(
    weaponId: WeaponId,
    volumeScaleOrSpatial: number | SpatialAudioOptions = 1,
    pan = 0,
  ): void {
    if (
      weaponId === 'katana' ||
      weaponId === 'twinblades' ||
      weaponId === 'greatsword' ||
      weaponId === 'plasma_saber'
    ) {
      this.playSwordSwing(weaponId, volumeScaleOrSpatial, pan);
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx) return;

    const spatial = this.resolveSpatialArgs(volumeScaleOrSpatial, pan, {
      refDistance: 5.5,
      maxDistance: 54,
      rolloffFactor: 0.9,
    });
    const out = this.createSpatialOutput(ctx, spatial, 5.5, 54, 0.9);
    if (!out) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.25;
    masterGain.connect(out.node);

    // 1. Filtered noise burst for crisp gunfire crackle
    const dur =
      weaponId === 'shotgun' || weaponId === 'autocannon'
        ? 0.28
        : weaponId === 'sniper' || weaponId === 'plasma'
          ? 0.34
          : weaponId === 'gatling' || weaponId === 'vector'
            ? 0.08
            : weaponId === 'rifle' || weaponId === 'burst' || weaponId === 'freezer'
              ? 0.14
              : weaponId === 'laser'
                ? 0.11
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
    filter.type =
      weaponId === 'shotgun' || weaponId === 'plasma' || weaponId === 'autocannon'
        ? 'lowpass'
        : 'bandpass';
    filter.Q.value = weaponId === 'sniper' || weaponId === 'laser' ? 2.2 : 1.1;
    filter.frequency.setValueAtTime(
      weaponId === 'sniper'
        ? 2200
        : weaponId === 'laser'
          ? 2600
          : weaponId === 'freezer'
            ? 1950
            : weaponId === 'vector'
              ? 1850
              : weaponId === 'smg'
                ? 1650
                : weaponId === 'gatling'
                  ? 1500
                  : weaponId === 'autocannon'
                    ? 640
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
      weaponId === 'shotgun' ||
        weaponId === 'sniper' ||
        weaponId === 'plasma' ||
        weaponId === 'autocannon'
        ? 155
        : 120,
      now,
    );
    subOsc.frequency.exponentialRampToValueAtTime(34, now + 0.095);
    subGain.gain.setValueAtTime(
      weaponId === 'shotgun' || weaponId === 'plasma' || weaponId === 'autocannon'
        ? 0.95
        : weaponId === 'gatling' || weaponId === 'vector'
          ? 0.42
          : 0.55,
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
      weaponId === 'sniper' || weaponId === 'plasma' || weaponId === 'laser'
        ? 'sawtooth'
        : weaponId === 'rifle' || weaponId === 'gatling' || weaponId === 'autocannon'
          ? 'square'
          : 'triangle';

    const startFreq =
      weaponId === 'pistol'
        ? 620
        : weaponId === 'smg'
          ? 740
          : weaponId === 'vector'
            ? 880
            : weaponId === 'gatling'
              ? 560
              : weaponId === 'shotgun' || weaponId === 'autocannon'
                ? 220
                : weaponId === 'rifle'
                  ? 460
                  : weaponId === 'burst'
                    ? 820
                    : weaponId === 'freezer'
                      ? 1350
                      : weaponId === 'laser'
                        ? 1620
                        : weaponId === 'plasma'
                          ? 360
                          : 1180;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(
      weaponId === 'plasma' || weaponId === 'autocannon'
        ? 75
        : weaponId === 'laser'
          ? 340
          : 55,
      now + dur * 0.85,
    );

    oscGain.gain.setValueAtTime(
      weaponId === 'rifle' ? 0.38 : weaponId === 'gatling' || weaponId === 'vector' ? 0.28 : 0.55,
      now,
    );
    oscGain.gain.exponentialRampToValueAtTime(0.008, now + dur);

    osc.connect(oscGain);
    oscGain.connect(masterGain);
    osc.start(now);
    osc.stop(now + dur);
  }

  public playSwordSwing(
    weaponId: WeaponId,
    volumeScaleOrSpatial: number | SpatialAudioOptions = 1,
    pan = 0,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const spatial = this.resolveSpatialArgs(volumeScaleOrSpatial, pan, {
      refDistance: 3.5,
      maxDistance: 30,
      rolloffFactor: 1.0,
    });
    const out = this.createSpatialOutput(ctx, spatial, 3.5, 30, 1.0);
    if (!out) return;

    const now = ctx.currentTime;
    const dur = weaponId === 'greatsword' ? 0.28 : weaponId === 'twinblades' ? 0.14 : 0.2;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = Math.sin((i / bufferSize) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.6;
    const startHz = weaponId === 'greatsword' ? 320 : weaponId === 'twinblades' ? 920 : 620;
    const endHz = weaponId === 'greatsword' ? 950 : 2100;
    filter.frequency.setValueAtTime(startHz, now);
    filter.frequency.exponentialRampToValueAtTime(endHz, now + dur * 0.55);
    filter.frequency.exponentialRampToValueAtTime(startHz * 0.65, now + dur);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.32, now);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(out.node);
    noise.start(now);

    // Energy blade hum harmonic
    const osc = ctx.createOscillator();
    const oGain = ctx.createGain();
    osc.type = weaponId === 'plasma_saber' ? 'sawtooth' : 'triangle';
    const baseHz =
      weaponId === 'plasma_saber'
        ? 460
        : weaponId === 'greatsword'
          ? 185
          : weaponId === 'twinblades'
            ? 580
            : 360;
    osc.frequency.setValueAtTime(baseHz, now);
    osc.frequency.exponentialRampToValueAtTime(baseHz * 1.45, now + dur * 0.45);
    osc.frequency.exponentialRampToValueAtTime(baseHz * 0.65, now + dur);
    oGain.gain.setValueAtTime(0.14, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(oGain);
    oGain.connect(out.node);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  public playSwordHit(killed = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = this.getLocalVolumeScale();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(killed ? 920 : 680, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.14);
    gain.gain.setValueAtTime(0.24 * vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.getMasterDestination(ctx));
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playHitmarker(headshot = false, killed = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = this.getLocalVolumeScale();
    const dest = this.getMasterDestination(ctx);

    // Crisp tactile tick
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = headshot ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(headshot ? 1950 : 1220, now);
    osc.frequency.exponentialRampToValueAtTime(headshot ? 2650 : 720, now + 0.065);
    gain.gain.setValueAtTime((headshot ? 0.24 : 0.18) * vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.08);

    // Headshot metallic *TING*
    if (headshot) {
      const ding = ctx.createOscillator();
      const dingGain = ctx.createGain();
      ding.type = 'sine';
      ding.frequency.setValueAtTime(2880, now + 0.015);
      ding.frequency.exponentialRampToValueAtTime(2100, now + 0.14);
      dingGain.gain.setValueAtTime(0.16 * vol, now + 0.015);
      dingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      ding.connect(dingGain);
      dingGain.connect(dest);
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
      subGain.gain.setValueAtTime(0.28 * vol, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      sub.connect(subGain);
      subGain.connect(dest);
      sub.start(now);
      sub.stop(now + 0.18);

      [880, 1320].forEach((freq, idx) => {
        const chime = ctx.createOscillator();
        const cGain = ctx.createGain();
        chime.type = 'triangle';
        chime.frequency.setValueAtTime(freq, now + idx * 0.045);
        cGain.gain.setValueAtTime(0.14 * vol, now + idx * 0.045);
        cGain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.045 + 0.14);
        chime.connect(cGain);
        cGain.connect(dest);
        chime.start(now + idx * 0.045);
        chime.stop(now + idx * 0.045 + 0.15);
      });
    }
  }

  public playDamageTaken(headshot = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = this.getLocalVolumeScale();

    // Heavy low impact thud
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(headshot ? 900 : 480, now);
    osc.frequency.setValueAtTime(headshot ? 175 : 130, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.14);
    gain.gain.setValueAtTime(0.24 * vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.getMasterDestination(ctx));
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playImpact(volumeScaleOrSpatial: number | SpatialAudioOptions = 0.25): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const spatial = this.resolveSpatialArgs(volumeScaleOrSpatial, 0, {
      refDistance: 2.5,
      maxDistance: 24,
      rolloffFactor: 1.05,
    });
    const out = this.createSpatialOutput(ctx, spatial, 2.5, 24, 1.05);
    if (!out) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const base = 1800 + Math.random() * 900;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 0.45, now + 0.05);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    osc.connect(gain);
    gain.connect(out.node);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  public playFootstep(sprinting = false, spatial?: SpatialAudioOptions): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const out = this.createSpatialOutput(
      ctx,
      spatial ?? { volumeScale: 1 },
      2.5,
      24,
      1.05,
    );
    if (!out) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(sprinting ? 115 : 95, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.045);
    gain.gain.setValueAtTime(sprinting ? 0.055 : 0.038, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(out.node);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  public playLand(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = this.getLocalVolumeScale();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(105, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.1);
    gain.gain.setValueAtTime(0.11 * vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain);
    gain.connect(this.getMasterDestination(ctx));
    osc.start(now);
    osc.stop(now + 0.12);
  }

  public playReload(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = this.getLocalVolumeScale();
    const dest = this.getMasterDestination(ctx);
    [0, 0.14].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(i === 0 ? 320 : 520, now + offset);
      gain.gain.setValueAtTime(0.08 * vol, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.06);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now + offset);
      osc.stop(now + offset + 0.065);
    });
  }

  public playFlagPickup(isOwnTeamAction: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = this.getLocalVolumeScale();
    const dest = this.getMasterDestination(ctx);
    const notes = isOwnTeamAction ? [523, 659, 784] : [440, 349];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.08);
      gain.gain.setValueAtTime(0.14 * vol, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.16);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.17);
    });
  }

  public playFlagReturn(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = this.getLocalVolumeScale();
    const dest = this.getMasterDestination(ctx);
    [587, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.07);
      gain.gain.setValueAtTime(0.14 * vol, now + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.14);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now + i * 0.07);
      osc.stop(now + i * 0.07 + 0.15);
    });
  }

  public playFlagCapture(friendlyScored: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = this.getLocalVolumeScale();
    const dest = this.getMasterDestination(ctx);
    const notes = friendlyScored ? [523, 659, 784, 1046] : [392, 349, 293, 220];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;

      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      gain.gain.setValueAtTime(0.14 * vol, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.25);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.26);
    });
  }

  public playPurchase(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = this.getLocalVolumeScale();
    const dest = this.getMasterDestination(ctx);
    [660, 880, 1174].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.055);
      gain.gain.setValueAtTime(0.12 * vol, now + i * 0.055);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.12);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now + i * 0.055);
      osc.stop(now + i * 0.055 + 0.13);
    });
  }

  public playJump(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = this.getLocalVolumeScale();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.09);
    gain.gain.setValueAtTime(0.07 * vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(this.getMasterDestination(ctx));
    osc.start(now);
    osc.stop(now + 0.11);
  }

  public playThrow(volumeScaleOrSpatial: number | SpatialAudioOptions = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const spatial = this.resolveSpatialArgs(volumeScaleOrSpatial, 0, {
      refDistance: 3.5,
      maxDistance: 32,
      rolloffFactor: 1.0,
    });
    const out = this.createSpatialOutput(ctx, spatial, 3.5, 32, 1.0);
    if (!out) return;

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
    gain.gain.setValueAtTime(0.18, now);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(out.node);
    noise.start(now);
  }

  public playExplosion(
    volumeScaleOrSpatial: number | SpatialAudioOptions = 1,
    pan = 0,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const spatial = this.resolveSpatialArgs(volumeScaleOrSpatial, pan, {
      refDistance: 8,
      maxDistance: 66,
      rolloffFactor: 0.75,
    });
    const out = this.createSpatialOutput(ctx, spatial, 8, 66, 0.75);
    if (!out) return;

    const now = ctx.currentTime;

    // Deep sub-bass boom
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(115, now);
    sub.frequency.exponentialRampToValueAtTime(24, now + 0.45);
    subGain.gain.setValueAtTime(0.55, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    sub.connect(subGain);
    subGain.connect(out.node);
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
    nGain.gain.setValueAtTime(0.42, now);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(out.node);
    noise.start(now);
  }

  public playSmokeDeploy(volumeScaleOrSpatial: number | SpatialAudioOptions = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const spatial = this.resolveSpatialArgs(volumeScaleOrSpatial, 0, {
      refDistance: 5,
      maxDistance: 44,
      rolloffFactor: 0.9,
    });
    const out = this.createSpatialOutput(ctx, spatial, 5, 44, 0.9);
    if (!out) return;

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
    gain.gain.setValueAtTime(0.28, now);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(out.node);
    noise.start(now);
  }

  public playEmpBlast(volumeScaleOrSpatial: number | SpatialAudioOptions = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const spatial = this.resolveSpatialArgs(volumeScaleOrSpatial, 0, {
      refDistance: 6,
      maxDistance: 48,
      rolloffFactor: 0.85,
    });
    const out = this.createSpatialOutput(ctx, spatial, 6, 48, 0.85);
    if (!out) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(980, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.36);
    gain.gain.setValueAtTime(0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc.connect(gain);
    gain.connect(out.node);
    osc.start(now);
    osc.stop(now + 0.4);

    const sub = ctx.createOscillator();
    const sGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(160, now);
    sub.frequency.exponentialRampToValueAtTime(38, now + 0.24);
    sGain.gain.setValueAtTime(0.32, now);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    sub.connect(sGain);
    sGain.connect(out.node);
    sub.start(now);
    sub.stop(now + 0.26);
  }

  public playCryoBlast(volumeScaleOrSpatial: number | SpatialAudioOptions = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const spatial = this.resolveSpatialArgs(volumeScaleOrSpatial, 0, {
      refDistance: 6,
      maxDistance: 48,
      rolloffFactor: 0.85,
    });
    const out = this.createSpatialOutput(ctx, spatial, 6, 48, 0.85);
    if (!out) return;

    const now = ctx.currentTime;
    const dur = 0.48;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.32));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(5200, now + dur);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.28, now);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(out.node);
    noise.start(now);

    [1760, 2349, 3135].forEach((freq, i) => {
      const chime = ctx.createOscillator();
      const cGain = ctx.createGain();
      chime.type = 'sine';
      chime.frequency.setValueAtTime(freq, now + i * 0.04);
      cGain.gain.setValueAtTime(0.11, now + i * 0.04);
      cGain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.26);
      chime.connect(cGain);
      cGain.connect(out.node);
      chime.start(now + i * 0.04);
      chime.stop(now + i * 0.04 + 0.27);
    });
  }

  public playMedkitHeal(volumeScaleOrSpatial: number | SpatialAudioOptions = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const spatial = this.resolveSpatialArgs(volumeScaleOrSpatial, 0, {
      refDistance: 4,
      maxDistance: 34,
      rolloffFactor: 0.95,
    });
    const out = this.createSpatialOutput(ctx, spatial, 4, 34, 0.95);
    if (!out) return;

    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t0 = now + i * 0.055;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.14, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.24);
      osc.connect(gain);
      gain.connect(out.node);
      osc.start(t0);
      osc.stop(t0 + 0.25);
    });
  }

  public playStimBoost(volumeScaleOrSpatial: number | SpatialAudioOptions = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const spatial = this.resolveSpatialArgs(volumeScaleOrSpatial, 0, {
      refDistance: 4,
      maxDistance: 30,
      rolloffFactor: 0.95,
    });
    const out = this.createSpatialOutput(ctx, spatial, 4, 30, 0.95);
    if (!out) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(1120, now + 0.28);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc.connect(gain);
    gain.connect(out.node);
    osc.start(now);
    osc.stop(now + 0.33);
  }

  public playPing(kind: PingKind): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = this.getLocalVolumeScale();
    const dest = this.getMasterDestination(ctx);
    const notes =
      kind === 'carrier'
        ? [1046, 1396, 1760]
        : kind === 'enemy'
          ? [880, 1174]
          : [740, 988];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === 'carrier' ? 'triangle' : 'sine';
      const t0 = now + idx * 0.055;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.11 * vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.11);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(t0);
      osc.stop(t0 + 0.12);
    });
  }

  public playChat(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = this.getLocalVolumeScale();
    const dest = this.getMasterDestination(ctx);
    [660, 880].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t0 = now + idx * 0.045;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.065 * vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.085);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(t0);
      osc.stop(t0 + 0.095);
    });
  }

  public playKillStreak(streak: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = this.getLocalVolumeScale();
    const dest = this.getMasterDestination(ctx);
    const notes =
      streak >= 5
        ? [523, 659, 784, 1046, 1318]
        : streak >= 3
          ? [493, 659, 880, 1174]
          : [440, 659, 880];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t0 = now + idx * 0.06;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.13 * vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(t0);
      osc.stop(t0 + 0.21);
    });
  }

  public playZoneCapture(friendly: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = this.getLocalVolumeScale();
    const dest = this.getMasterDestination(ctx);
    const notes = friendly ? [440, 587, 880] : [349, 293, 220];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = friendly ? 'triangle' : 'sawtooth';
      const t0 = now + idx * 0.08;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.11 * vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(t0);
      osc.stop(t0 + 0.19);
    });
  }
}

export const soundEngine = new SoundEngine();
