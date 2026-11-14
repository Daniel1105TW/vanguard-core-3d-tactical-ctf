import * as THREE from 'three';

export interface ProceduralTextureSet {
  floorColor: THREE.CanvasTexture;
  floorRoughness: THREE.CanvasTexture;
  panelColor: THREE.CanvasTexture;
  panelBump: THREE.CanvasTexture;
  basePadGlowRed: THREE.CanvasTexture;
  basePadGlowBlue: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  dirtColor: THREE.CanvasTexture;
  dirtBump: THREE.CanvasTexture;
  dispose: () => void;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  // 1. Sci-Fi Tactical Deck Floor (Color + Roughness)
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = 512;
  floorCanvas.height = 512;
  const fctx = floorCanvas.getContext('2d')!;

  fctx.fillStyle = '#141c28';
  fctx.fillRect(0, 0, 512, 512);

  // Subtle tile plates
  fctx.strokeStyle = '#1f2b3d';
  fctx.lineWidth = 4;
  for (let i = 0; i <= 512; i += 128) {
    fctx.beginPath();
    fctx.moveTo(i, 0);
    fctx.lineTo(i, 512);
    fctx.stroke();
    fctx.beginPath();
    fctx.moveTo(0, i);
    fctx.lineTo(512, i);
    fctx.stroke();
  }

  // Micro tactical grid
  fctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
  fctx.lineWidth = 1;
  for (let i = 0; i <= 512; i += 32) {
    fctx.beginPath();
    fctx.moveTo(i, 0);
    fctx.lineTo(i, 512);
    fctx.stroke();
    fctx.beginPath();
    fctx.moveTo(0, i);
    fctx.lineTo(512, i);
    fctx.stroke();
  }

  // Corner bolt accents
  fctx.fillStyle = '#2b3b52';
  for (let x = 16; x < 512; x += 128) {
    for (let y = 16; y < 512; y += 128) {
      fctx.fillRect(x, y, 6, 6);
      fctx.fillRect(x + 90, y, 6, 6);
      fctx.fillRect(x, y + 90, 6, 6);
      fctx.fillRect(x + 90, y + 90, 6, 6);
    }
  }

  const floorColor = new THREE.CanvasTexture(floorCanvas);
  floorColor.colorSpace = THREE.SRGBColorSpace;
  floorColor.wrapS = THREE.RepeatWrapping;
  floorColor.wrapT = THREE.RepeatWrapping;
  floorColor.repeat.set(22, 13);
  floorColor.anisotropy = maxAnisotropy;

  // Floor roughness map (linear)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 256;
  roughCanvas.height = 256;
  const rctx = roughCanvas.getContext('2d')!;
  rctx.fillStyle = '#b0b0b0';
  rctx.fillRect(0, 0, 256, 256);
  rctx.strokeStyle = '#606060';
  rctx.lineWidth = 4;
  for (let i = 0; i <= 256; i += 64) {
    rctx.strokeRect(i, 0, 64, 256);
    rctx.strokeRect(0, i, 256, 64);
  }
  const floorRoughness = new THREE.CanvasTexture(roughCanvas);
  floorRoughness.wrapS = THREE.RepeatWrapping;
  floorRoughness.wrapT = THREE.RepeatWrapping;
  floorRoughness.repeat.set(22, 13);
  floorRoughness.anisotropy = maxAnisotropy;

  // 2. Brushed Alloy Cover Panel (Color + Bump)
  const panelCanvas = document.createElement('canvas');
  panelCanvas.width = 256;
  panelCanvas.height = 256;
  const pctx = panelCanvas.getContext('2d')!;
  pctx.fillStyle = '#253143';
  pctx.fillRect(0, 0, 256, 256);

  // Diagonal brushed streaks
  pctx.strokeStyle = 'rgba(255,255,255,0.04)';
  pctx.lineWidth = 2;
  for (let i = 0; i < 256; i += 6) {
    pctx.beginPath();
    pctx.moveTo(0, i);
    pctx.lineTo(256, i);
    pctx.stroke();
  }
  // Panel bevel frame
  pctx.strokeStyle = '#384a63';
  pctx.lineWidth = 8;
  pctx.strokeRect(10, 10, 236, 236);
  pctx.strokeStyle = '#111827';
  pctx.lineWidth = 3;
  pctx.strokeRect(22, 22, 212, 212);

  const panelColor = new THREE.CanvasTexture(panelCanvas);
  panelColor.colorSpace = THREE.SRGBColorSpace;
  panelColor.wrapS = THREE.RepeatWrapping;
  panelColor.wrapT = THREE.RepeatWrapping;
  panelColor.anisotropy = maxAnisotropy;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 256;
  bumpCanvas.height = 256;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 256, 256);
  bctx.strokeStyle = '#ffffff';
  bctx.lineWidth = 8;
  bctx.strokeRect(10, 10, 236, 236);
  bctx.strokeStyle = '#303030';
  bctx.lineWidth = 4;
  bctx.strokeRect(22, 22, 212, 212);
  const panelBump = new THREE.CanvasTexture(bumpCanvas);
  panelBump.wrapS = THREE.RepeatWrapping;
  panelBump.wrapT = THREE.RepeatWrapping;

  // 3. Base Pad Holographic Ring Textures
  const makeBasePadTex = (hexMain: string, hexGlow: string) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 256, 256);

    const grad = g.createRadialGradient(128, 128, 18, 128, 128, 124);
    grad.addColorStop(0, hexGlow);
    grad.addColorStop(0.55, hexMain);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);

    g.strokeStyle = '#ffffff';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(128, 128, 92, 0, Math.PI * 2);
    g.stroke();

    g.setLineDash([16, 10]);
    g.lineWidth = 3;
    g.beginPath();
    g.arc(128, 128, 66, 0, Math.PI * 2);
    g.stroke();

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAnisotropy;
    return tex;
  };

  const basePadGlowRed = makeBasePadTex('rgba(239, 68, 68, 0.5)', 'rgba(254, 202, 202, 0.85)');
  const basePadGlowBlue = makeBasePadTex('rgba(6, 182, 212, 0.5)', 'rgba(165, 243, 252, 0.85)');

  // 4. Radial Contact Shadow
  const csCanvas = document.createElement('canvas');
  csCanvas.width = 128;
  csCanvas.height = 128;
  const csCtx = csCanvas.getContext('2d')!;
  const csGrad = csCtx.createRadialGradient(64, 64, 8, 64, 64, 62);
  csGrad.addColorStop(0, 'rgba(0,0,0,0.65)');
  csGrad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  csGrad.addColorStop(1, 'rgba(0,0,0,0)');
  csCtx.fillStyle = csGrad;
  csCtx.fillRect(0, 0, 128, 128);
  const contactShadow = new THREE.CanvasTexture(csCanvas);

  // 5. Subterranean Stratified Rock / Earth Textures (Color + Bump)
  const dirtCanvas = document.createElement('canvas');
  dirtCanvas.width = 256;
  dirtCanvas.height = 256;
  const dctx = dirtCanvas.getContext('2d')!;
  dctx.fillStyle = '#4a3525';
  dctx.fillRect(0, 0, 256, 256);

  // Horizontal earth strata
  const strataColors = ['#3b291c', '#58402d', '#312218', '#634934'];
  for (let y = 0; y < 256; y += 22) {
    dctx.fillStyle = strataColors[(y / 22) % strataColors.length];
    dctx.fillRect(0, y, 256, 12 + (y % 7));
  }
  // Mineral & stone flecks
  let seed = 1337;
  const nextRand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 420; i++) {
    const px = nextRand() * 250;
    const py = nextRand() * 250;
    const sz = 2 + nextRand() * 5;
    dctx.fillStyle = i % 5 === 0 ? '#78624f' : i % 3 === 0 ? '#271b13' : '#5e4431';
    dctx.fillRect(px, py, sz, sz * 0.8);
  }
  // Subtle tactical dig block seam
  dctx.strokeStyle = 'rgba(15, 10, 6, 0.45)';
  dctx.lineWidth = 4;
  dctx.strokeRect(2, 2, 252, 252);

  const dirtColor = new THREE.CanvasTexture(dirtCanvas);
  dirtColor.colorSpace = THREE.SRGBColorSpace;
  dirtColor.anisotropy = maxAnisotropy;

  const dirtBumpCanvas = document.createElement('canvas');
  dirtBumpCanvas.width = 256;
  dirtBumpCanvas.height = 256;
  const dbctx = dirtBumpCanvas.getContext('2d')!;
  dbctx.fillStyle = '#7c7c7c';
  dbctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 450; i++) {
    const px = nextRand() * 250;
    const py = nextRand() * 250;
    const sz = 3 + nextRand() * 6;
    dbctx.fillStyle = i % 2 === 0 ? '#b8b8b8' : '#3a3a3a';
    dbctx.fillRect(px, py, sz, sz);
  }
  dbctx.strokeStyle = '#202020';
  dbctx.lineWidth = 6;
  dbctx.strokeRect(2, 2, 252, 252);
  const dirtBump = new THREE.CanvasTexture(dirtBumpCanvas);
  dirtBump.anisotropy = maxAnisotropy;

  return {
    floorColor,
    floorRoughness,
    panelColor,
    panelBump,
    basePadGlowRed,
    basePadGlowBlue,
    contactShadow,
    dirtColor,
    dirtBump,
    dispose: () => {
      floorColor.dispose();
      floorRoughness.dispose();
      panelColor.dispose();
      panelBump.dispose();
      basePadGlowRed.dispose();
      basePadGlowBlue.dispose();
      contactShadow.dispose();
      dirtColor.dispose();
      dirtBump.dispose();
    },
  };
}
