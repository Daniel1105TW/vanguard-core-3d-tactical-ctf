export type TeamId = 'red' | 'blue';
export type MapMode = 'nexus' | 'crossfire' | 'labyrinth' | 'random' | 'underground';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AABB {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  kind: 'wall' | 'cover' | 'base' | 'bridge' | 'pillar';
  team?: TeamId;
}

export interface RampZone {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  yAtMinX: number;
  yAtMaxX: number;
  yAtMinZ: number;
  yAtMaxZ: number;
  axis: 'x' | 'z';
}

export interface MapModeInfo {
  id: MapMode;
  name: string;
  description: string;
}

export const MAP_MODES: MapModeInfo[] = [
  { id: 'nexus', name: '星核要塞', description: '經典雙層中央天橋與對稱戰術掩體' },
  { id: 'crossfire', name: '雙塔峽谷', description: '南北雙側高台狙擊點與中路掩體溝壑' },
  { id: 'labyrinth', name: '量子矩陣', description: '多通道交錯隔牆，適合近距離繞後搶旗' },
  { id: 'random', name: '隨機戰場', description: '每場開局隨機生成全新對稱掩體與地形' },
  { id: 'underground', name: '地底隧道', description: '出生在地下土層，射擊或按 [E] 挖隧道突襲敵營' },
];

export const ARENA_BOUNDS = {
  minX: -52,
  maxX: 52,
  minZ: -30,
  maxZ: 30,
} as const;

export const FLAG_BASES: Record<TeamId, Vec3> = {
  red: { x: -41, y: 0.35, z: 0 },
  blue: { x: 41, y: 0.35, z: 0 },
};

export const SPAWN_POINTS: Record<TeamId, Vec3[]> = {
  red: [
    { x: -47.5, y: 0.35, z: -7 },
    { x: -47.5, y: 0.35, z: 7 },
    { x: -46.5, y: 0.35, z: -3.5 },
    { x: -46.5, y: 0.35, z: 3.5 },
  ],
  blue: [
    { x: 47.5, y: 0.35, z: -7 },
    { x: 47.5, y: 0.35, z: 7 },
    { x: 46.5, y: 0.35, z: -3.5 },
    { x: 46.5, y: 0.35, z: 3.5 },
  ],
};

// Underground diggable voxel grid covering [-35..35] x [-28..28] (and up to +-49 in base rock walls)
export const UNDERGROUND_GRID = {
  cellSize: 2.0,
  originX: -48,
  originZ: -28,
  cols: 48, // [-48 .. +48]
  rows: 28, // [-28 .. +28]
  height: 3.8,
  maxHp: 2,
} as const;

export interface MapLayout {
  mode: MapMode;
  seed: number;
  colliders: AABB[];
  ramps: RampZone[];
  ceilingY: number | null;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function baseColliders(): AABB[] {
  return [
    // Perimeter containment walls
    { id: 'wall-north', minX: -53, maxX: 53, minY: 0, maxY: 7, minZ: -31.5, maxZ: -30, kind: 'wall' },
    { id: 'wall-south', minX: -53, maxX: 53, minY: 0, maxY: 7, minZ: 30, maxZ: 31.5, kind: 'wall' },
    { id: 'wall-west', minX: -53.5, maxX: -52, minY: 0, maxY: 7, minZ: -31.5, maxZ: 31.5, kind: 'wall' },
    { id: 'wall-east', minX: 52, maxX: 53.5, minY: 0, maxY: 7, minZ: -31.5, maxZ: 31.5, kind: 'wall' },

    // Raised Base Platforms
    { id: 'red-platform', minX: -50, maxX: -37, minY: 0, maxY: 0.35, minZ: -13, maxZ: 13, kind: 'base', team: 'red' },
    { id: 'blue-platform', minX: 37, maxX: 50, minY: 0, maxY: 0.35, minZ: -13, maxZ: 13, kind: 'base', team: 'blue' },
  ];
}

function baseDefenceColliders(): AABB[] {
  return [
    // Red Base Bastion & Pillars
    { id: 'red-bastion-n', minX: -36, maxX: -34, minY: 0, maxY: 4.5, minZ: -14, maxZ: -4.5, kind: 'base', team: 'red' },
    { id: 'red-bastion-s', minX: -36, maxX: -34, minY: 0, maxY: 4.5, minZ: 4.5, maxZ: 14, kind: 'base', team: 'red' },
    { id: 'red-wing-n', minX: -46, maxX: -36, minY: 0, maxY: 3.8, minZ: -16, maxZ: -14.2, kind: 'base', team: 'red' },
    { id: 'red-wing-s', minX: -46, maxX: -36, minY: 0, maxY: 3.8, minZ: 14.2, maxZ: 16, kind: 'base', team: 'red' },
    { id: 'red-pillar-nw', minX: -43.5, maxX: -41.5, minY: 0, maxY: 5.5, minZ: -9.5, maxZ: -7.5, kind: 'pillar', team: 'red' },
    { id: 'red-pillar-sw', minX: -43.5, maxX: -41.5, minY: 0, maxY: 5.5, minZ: 7.5, maxZ: 9.5, kind: 'pillar', team: 'red' },
    { id: 'red-arch-n', minX: -41.6, maxX: -40.4, minY: 0, maxY: 7.5, minZ: -7.1, maxZ: -5.9, kind: 'pillar', team: 'red' },
    { id: 'red-arch-s', minX: -41.6, maxX: -40.4, minY: 0, maxY: 7.5, minZ: 5.9, maxZ: 7.1, kind: 'pillar', team: 'red' },
    { id: 'red-arch-top', minX: -41.7, maxX: -40.3, minY: 7.1, maxY: 8.0, minZ: -7.1, maxZ: 7.1, kind: 'base', team: 'red' },

    // Blue Base Bastion & Pillars
    { id: 'blue-bastion-n', minX: 34, maxX: 36, minY: 0, maxY: 4.5, minZ: -14, maxZ: -4.5, kind: 'base', team: 'blue' },
    { id: 'blue-bastion-s', minX: 34, maxX: 36, minY: 0, maxY: 4.5, minZ: 4.5, maxZ: 14, kind: 'base', team: 'blue' },
    { id: 'blue-wing-n', minX: 36, maxX: 46, minY: 0, maxY: 3.8, minZ: -16, maxZ: -14.2, kind: 'base', team: 'blue' },
    { id: 'blue-wing-s', minX: 36, maxX: 46, minY: 0, maxY: 3.8, minZ: 14.2, maxZ: 16, kind: 'base', team: 'blue' },
    { id: 'blue-pillar-ne', minX: 41.5, maxX: 43.5, minY: 0, maxY: 5.5, minZ: -9.5, maxZ: -7.5, kind: 'pillar', team: 'blue' },
    { id: 'blue-pillar-se', minX: 41.5, maxX: 43.5, minY: 0, maxY: 5.5, minZ: 7.5, maxZ: 9.5, kind: 'pillar', team: 'blue' },
    { id: 'blue-arch-n', minX: 40.4, maxX: 41.6, minY: 0, maxY: 7.5, minZ: -7.1, maxZ: -5.9, kind: 'pillar', team: 'blue' },
    { id: 'blue-arch-s', minX: 40.4, maxX: 41.6, minY: 0, maxY: 7.5, minZ: 5.9, maxZ: 7.1, kind: 'pillar', team: 'blue' },
    { id: 'blue-arch-top', minX: 40.3, maxX: 41.7, minY: 7.1, maxY: 8.0, minZ: -7.1, maxZ: 7.1, kind: 'base', team: 'blue' },
  ];
}

function mirrorCoverPair(
  id: string,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
  kind: AABB['kind'] = 'cover',
): AABB[] {
  return [
    { id: `${id}-r`, minX: -maxX, maxX: -minX, minY, maxY, minZ, maxZ, kind, team: minX > 18 ? 'red' : undefined },
    { id: `${id}-b`, minX, maxX, minY, maxY, minZ, maxZ, kind, team: minX > 18 ? 'blue' : undefined },
  ];
}

function overlapsAny(candidate: AABB, list: AABB[], pad = 2.6): boolean {
  for (const b of list) {
    if (
      candidate.maxX + pad > b.minX &&
      candidate.minX - pad < b.maxX &&
      candidate.maxZ + pad > b.minZ &&
      candidate.minZ - pad < b.maxZ &&
      candidate.maxY > b.minY &&
      candidate.minY < b.maxY
    ) {
      return true;
    }
  }
  return false;
}

export function generateMapLayout(mode: MapMode, seed = 104729): MapLayout {
  if (mode === 'underground') {
    // Enclosed subterranean bunker: bedrock perimeter + base platforms + indestructible bedrock pillars
    const colliders: AABB[] = [
      ...baseColliders(),
      // Indestructible bedrock columns in midfield for tactical anchor points
      ...mirrorCoverPair('bedrock-mid', 15, 17, 0, 3.8, -13, -11, 'pillar'),
      ...mirrorCoverPair('bedrock-mid-s', 15, 17, 0, 3.8, 11, 13, 'pillar'),
      { id: 'bedrock-center-n', minX: -2, maxX: 2, minY: 0, maxY: 3.8, minZ: -9, maxZ: -6, kind: 'pillar' },
      { id: 'bedrock-center-s', minX: -2, maxX: 2, minY: 0, maxY: 3.8, minZ: 6, maxZ: 9, kind: 'pillar' },
    ];
    return { mode, seed, colliders, ramps: [], ceilingY: UNDERGROUND_GRID.height };
  }

  if (mode === 'crossfire') {
    const colliders: AABB[] = [
      ...baseColliders(),
      ...baseDefenceColliders(),
      // North & South Twin Elevated Sniper Bunkers (Y=2.4)
      { id: 'north-deck', minX: -8, maxX: 8, minY: 1.9, maxY: 2.4, minZ: -24, maxZ: -15, kind: 'bridge' },
      { id: 'north-pylon-w', minX: -8, maxX: -6, minY: 0, maxY: 2.4, minZ: -24, maxZ: -22, kind: 'pillar' },
      { id: 'north-pylon-e', minX: 6, maxX: 8, minY: 0, maxY: 2.4, minZ: -24, maxZ: -22, kind: 'pillar' },
      { id: 'north-rail', minX: -5, maxX: 5, minY: 2.4, maxY: 3.5, minZ: -15.8, maxZ: -15, kind: 'cover' },

      { id: 'south-deck', minX: -8, maxX: 8, minY: 1.9, maxY: 2.4, minZ: 15, maxZ: 24, kind: 'bridge' },
      { id: 'south-pylon-w', minX: -8, maxX: -6, minY: 0, maxY: 2.4, minZ: 22, maxZ: 24, kind: 'pillar' },
      { id: 'south-pylon-e', minX: 6, maxX: 8, minY: 0, maxY: 2.4, minZ: 22, maxZ: 24, kind: 'pillar' },
      { id: 'south-rail', minX: -5, maxX: 5, minY: 2.4, maxY: 3.5, minZ: 15, maxZ: 15.8, kind: 'cover' },

      // Midfield Center Monolith + Staggered Trench Shields
      { id: 'mid-obelisk', minX: -2.2, maxX: 2.2, minY: 0, maxY: 4.2, minZ: -3.5, maxZ: 3.5, kind: 'pillar' },
      ...mirrorCoverPair('cf-lane', 12, 14.5, 0, 2.2, -9.5, -5.5),
      ...mirrorCoverPair('cf-lane-s', 12, 14.5, 0, 2.2, 5.5, 9.5),
      ...mirrorCoverPair('cf-outer', 22, 25, 0, 2.8, -13, -9),
      ...mirrorCoverPair('cf-outer-s', 22, 25, 0, 2.8, 9, 13),
      ...mirrorCoverPair('cf-front', 24, 26, 0, 2.0, -3.5, 3.5),
    ];

    const ramps: RampZone[] = [
      { id: 'n-ramp-w', minX: -15, maxX: -8, minZ: -22.5, maxZ: -16.5, yAtMinX: 0, yAtMaxX: 2.4, yAtMinZ: 0, yAtMaxZ: 0, axis: 'x' },
      { id: 'n-ramp-e', minX: 8, maxX: 15, minZ: -22.5, maxZ: -16.5, yAtMinX: 2.4, yAtMaxX: 0, yAtMinZ: 0, yAtMaxZ: 0, axis: 'x' },
      { id: 's-ramp-w', minX: -15, maxX: -8, minZ: 16.5, maxZ: 22.5, yAtMinX: 0, yAtMaxX: 2.4, yAtMinZ: 0, yAtMaxZ: 0, axis: 'x' },
      { id: 's-ramp-e', minX: 8, maxX: 15, minZ: 16.5, maxZ: 22.5, yAtMinX: 2.4, yAtMaxX: 0, yAtMinZ: 0, yAtMaxZ: 0, axis: 'x' },
    ];
    return { mode, seed, colliders, ramps, ceilingY: null };
  }

  if (mode === 'labyrinth') {
    const colliders: AABB[] = [
      ...baseColliders(),
      ...baseDefenceColliders(),
      // Close-quarters staggered tactical partitions
      ...mirrorCoverPair('lab-1', 24, 26, 0, 3.4, -22, -11),
      ...mirrorCoverPair('lab-2', 24, 26, 0, 3.4, 11, 22),
      ...mirrorCoverPair('lab-3', 18, 20, 0, 3.0, -7, 7),
      ...mirrorCoverPair('lab-4', 10, 12.5, 0, 3.4, -25, -15),
      ...mirrorCoverPair('lab-5', 10, 12.5, 0, 3.4, 15, 25),
      ...mirrorCoverPair('lab-6', 8.5, 11, 0, 2.5, -9, -3),
      ...mirrorCoverPair('lab-7', 8.5, 11, 0, 2.5, 3, 9),
      { id: 'lab-center-n', minX: -3, maxX: 3, minY: 0, maxY: 3.2, minZ: -14, maxZ: -11, kind: 'cover' },
      { id: 'lab-center-s', minX: -3, maxX: 3, minY: 0, maxY: 3.2, minZ: 11, maxZ: 14, kind: 'cover' },
      { id: 'lab-core', minX: -2, maxX: 2, minY: 0, maxY: 2.2, minZ: -2, maxZ: 2, kind: 'pillar' },
    ];
    return { mode, seed, colliders, ramps: [], ceilingY: null };
  }

  if (mode === 'random') {
    const rng = mulberry32(seed);
    const colliders: AABB[] = [...baseColliders(), ...baseDefenceColliders()];
    const ramps: RampZone[] = [];

    const hasCenterBridge = rng() > 0.35;
    if (hasCenterBridge) {
      const halfSpan = 5 + Math.floor(rng() * 3); // 5..7
      colliders.push(
        { id: 'rnd-bridge-deck', minX: -halfSpan, maxX: halfSpan, minY: 1.9, maxY: 2.4, minZ: -6, maxZ: 6, kind: 'bridge' },
        { id: 'rnd-pylon-nw', minX: -halfSpan, maxX: -halfSpan + 2, minY: 0, maxY: 2.4, minZ: -6, maxZ: -4, kind: 'pillar' },
        { id: 'rnd-pylon-ne', minX: halfSpan - 2, maxX: halfSpan, minY: 0, maxY: 2.4, minZ: -6, maxZ: -4, kind: 'pillar' },
        { id: 'rnd-pylon-sw', minX: -halfSpan, maxX: -halfSpan + 2, minY: 0, maxY: 2.4, minZ: 4, maxZ: 6, kind: 'pillar' },
        { id: 'rnd-pylon-se', minX: halfSpan - 2, maxX: halfSpan, minY: 0, maxY: 2.4, minZ: 4, maxZ: 6, kind: 'pillar' },
        { id: 'rnd-rail-n', minX: -3, maxX: 3, minY: 2.4, maxY: 3.5, minZ: -6, maxZ: -5.2, kind: 'cover' },
        { id: 'rnd-rail-s', minX: -3, maxX: 3, minY: 2.4, maxY: 3.5, minZ: 5.2, maxZ: 6, kind: 'cover' },
      );
      ramps.push(
        { id: 'rnd-ramp-w', minX: -(halfSpan + 7), maxX: -halfSpan, minZ: -3.2, maxZ: 3.2, yAtMinX: 0, yAtMaxX: 2.4, yAtMinZ: 0, yAtMaxZ: 0, axis: 'x' },
        { id: 'rnd-ramp-e', minX: halfSpan, maxX: halfSpan + 7, minZ: -3.2, maxZ: 3.2, yAtMinX: 2.4, yAtMaxX: 0, yAtMinZ: 0, yAtMaxZ: 0, axis: 'x' },
      );
    } else {
      // Twin mid monoliths + low center crate
      colliders.push(
        { id: 'rnd-core-n', minX: -2.2, maxX: 2.2, minY: 0, maxY: 3.6, minZ: -9, maxZ: -5, kind: 'pillar' },
        { id: 'rnd-core-s', minX: -2.2, maxX: 2.2, minY: 0, maxY: 3.6, minZ: 5, maxZ: 9, kind: 'pillar' },
        { id: 'rnd-core-mid', minX: -2.5, maxX: 2.5, minY: 0, maxY: 1.7, minZ: -2, maxZ: 2, kind: 'cover' },
      );
    }

    // Generate 8-11 mirrored random tactical cover pairs in midfield
    const targetPairs = 9 + Math.floor(rng() * 3);
    let placed = 0;
    for (let attempt = 0; attempt < 90 && placed < targetPairs; attempt++) {
      const cx = 15 + rng() * 16; // X in [15..31] (outside central bridge ramps and base walls)
      const cz = -24 + rng() * 48; // Z in [-24..24]
      if (Math.abs(cz) < 4.5 && cx < 17) continue; // Keep ramp mouths clear

      const halfW = 1.0 + rng() * 1.4;
      const halfD = 1.4 + rng() * 3.2;
      const h = 1.8 + rng() * 1.8;
      const kind: AABB['kind'] = h > 3.1 ? 'pillar' : 'cover';

      const rightBox: AABB = {
        id: `rnd-c${placed}-b`,
        minX: Number((cx - halfW).toFixed(2)),
        maxX: Number((cx + halfW).toFixed(2)),
        minY: 0,
        maxY: Number(h.toFixed(2)),
        minZ: Number((cz - halfD).toFixed(2)),
        maxZ: Number((cz + halfD).toFixed(2)),
        kind,
        team: cx > 21 ? 'blue' : undefined,
      };
      const leftBox: AABB = {
        id: `rnd-c${placed}-r`,
        minX: -rightBox.maxX,
        maxX: -rightBox.minX,
        minY: 0,
        maxY: rightBox.maxY,
        minZ: rightBox.minZ,
        maxZ: rightBox.maxZ,
        kind,
        team: cx > 21 ? 'red' : undefined,
      };

      if (
        rightBox.minZ > -28 &&
        rightBox.maxZ < 28 &&
        !overlapsAny(rightBox, colliders, 3.0) &&
        !overlapsAny(leftBox, colliders, 3.0)
      ) {
        colliders.push(leftBox, rightBox);
        placed++;
      }
    }

    // Also place 2 center-line flank covers North/South
    const flankZ = 16 + rng() * 7;
    colliders.push(
      { id: 'rnd-flank-n', minX: -3, maxX: 3, minY: 0, maxY: 2.4, minZ: -flankZ - 1.5, maxZ: -flankZ + 1.5, kind: 'cover' },
      { id: 'rnd-flank-s', minX: -3, maxX: 3, minY: 0, maxY: 2.4, minZ: flankZ - 1.5, maxZ: flankZ + 1.5, kind: 'cover' },
    );

    return { mode, seed, colliders, ramps, ceilingY: null };
  }

  // Default: 'nexus' (Original Sci-Fi Tactical Arena)
  const colliders: AABB[] = [
    ...baseColliders(),
    ...baseDefenceColliders(),
    ...mirrorCoverPair('cover-1', 24, 26, 0, 2.2, -6, 6),
    ...mirrorCoverPair('cover-2', 19, 24, 0, 2.8, -21, -18),
    ...mirrorCoverPair('cover-3', 19, 24, 0, 2.8, 18, 21),
    { id: 'cover-r4', minX: -16, maxX: -13, minY: 0, maxY: 2.0, minZ: -13.5, maxZ: -10.5, kind: 'cover' },
    { id: 'cover-r5', minX: -16, maxX: -13, minY: 0, maxY: 2.0, minZ: 10.5, maxZ: 13.5, kind: 'cover' },
    { id: 'cover-b4', minX: 13, maxX: 16, minY: 0, maxY: 2.0, minZ: -13.5, maxZ: -10.5, kind: 'cover' },
    { id: 'cover-b5', minX: 13, maxX: 16, minY: 0, maxY: 2.0, minZ: 10.5, maxZ: 13.5, kind: 'cover' },
    { id: 'bridge-deck', minX: -7, maxX: 7, minY: 1.9, maxY: 2.4, minZ: -7, maxZ: 7, kind: 'bridge' },
    { id: 'bridge-pylon-nw', minX: -7, maxX: -5, minY: 0, maxY: 2.4, minZ: -7, maxZ: -5, kind: 'pillar' },
    { id: 'bridge-pylon-ne', minX: 5, maxX: 7, minY: 0, maxY: 2.4, minZ: -7, maxZ: -5, kind: 'pillar' },
    { id: 'bridge-pylon-sw', minX: -7, maxX: -5, minY: 0, maxY: 2.4, minZ: 5, maxZ: 7, kind: 'pillar' },
    { id: 'bridge-pylon-se', minX: 5, maxX: 7, minY: 0, maxY: 2.4, minZ: 5, maxZ: 7, kind: 'pillar' },
    { id: 'bridge-rail-n', minX: -3.5, maxX: 3.5, minY: 2.4, maxY: 3.6, minZ: -7, maxZ: -6.2, kind: 'cover' },
    { id: 'bridge-rail-s', minX: -3.5, maxX: 3.5, minY: 2.4, maxY: 3.6, minZ: 6.2, maxZ: 7, kind: 'cover' },
    { id: 'flank-n-center', minX: -3, maxX: 3, minY: 0, maxY: 2.5, minZ: -25, maxZ: -22, kind: 'cover' },
    { id: 'flank-s-center', minX: -3, maxX: 3, minY: 0, maxY: 2.5, minZ: 22, maxZ: 25, kind: 'cover' },
  ];

  const ramps: RampZone[] = [
    { id: 'ramp-west', minX: -14, maxX: -7, minZ: -3.5, maxZ: 3.5, yAtMinX: 0, yAtMaxX: 2.4, yAtMinZ: 0, yAtMaxZ: 0, axis: 'x' },
    { id: 'ramp-east', minX: 7, maxX: 14, minZ: -3.5, maxZ: 3.5, yAtMinX: 2.4, yAtMaxX: 0, yAtMinZ: 0, yAtMaxZ: 0, axis: 'x' },
  ];

  return { mode, seed, colliders, ramps, ceilingY: null };
}

export const DEFAULT_MAP_LAYOUT: MapLayout = generateMapLayout('nexus', 104729);

// Underground Voxel Grid Helpers
export function createInitialUndergroundHp(layout: MapLayout): Uint8Array {
  const { cols, rows, cellSize, originX, originZ, maxHp } = UNDERGROUND_GRID;
  const hp = new Uint8Array(cols * rows);
  if (layout.mode !== 'underground') return hp;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = originX + (c + 0.5) * cellSize;
      const wz = originZ + (r + 0.5) * cellSize;
      const idx = r * cols + c;

      // Keep Red & Blue base chambers & flag pedestals open (players spawn inside carved chambers surrounded by dirt!)
      const nearRedChamber = wx <= -36.5 && Math.abs(wz) <= 12.5;
      const nearBlueChamber = wx >= 36.5 && Math.abs(wz) <= 12.5;
      if (nearRedChamber || nearBlueChamber) {
        hp[idx] = 0;
        continue;
      }

      // Skip cells occupied by indestructible bedrock pillars
      let blockedByBedrock = false;
      for (const b of layout.colliders) {
        if (b.kind !== 'pillar') continue;
        if (wx > b.minX - 0.5 && wx < b.maxX + 0.5 && wz > b.minZ - 0.5 && wz < b.maxZ + 0.5) {
          blockedByBedrock = true;
          break;
        }
      }
      hp[idx] = blockedByBedrock ? 0 : maxHp;
    }
  }
  return hp;
}

export function getUndergroundCellBounds(idx: number): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  const { cols, cellSize, originX, originZ, height } = UNDERGROUND_GRID;
  const r = Math.floor(idx / cols);
  const c = idx - r * cols;
  const minX = originX + c * cellSize;
  const minZ = originZ + r * cellSize;
  return { minX, maxX: minX + cellSize, minY: 0, maxY: height, minZ, maxZ: minZ + cellSize };
}

export function worldToUndergroundCell(x: number, z: number): { col: number; row: number; idx: number } | null {
  const { cols, rows, cellSize, originX, originZ } = UNDERGROUND_GRID;
  const col = Math.floor((x - originX) / cellSize);
  const row = Math.floor((z - originZ) / cellSize);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
  return { col, row, idx: row * cols + col };
}

function getRampHeightAt(r: RampZone, x: number): number {
  const t = Math.max(0, Math.min(1, (x - r.minX) / (r.maxX - r.minX)));
  return r.yAtMinX + (r.yAtMaxX - r.yAtMinX) * t;
}

export function getGroundHeightAt(
  x: number,
  z: number,
  currentY = 0,
  layout: MapLayout = DEFAULT_MAP_LAYOUT,
): number {
  let height = 0;
  const stepTolerance = 0.6;

  for (const box of layout.colliders) {
    if (box.kind === 'wall') continue;
    if (x >= box.minX - 0.12 && x <= box.maxX + 0.12 && z >= box.minZ - 0.12 && z <= box.maxZ + 0.12) {
      if (box.maxY <= currentY + stepTolerance) {
        height = Math.max(height, box.maxY);
      }
    }
  }

  for (const r of layout.ramps) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
      const ry = getRampHeightAt(r, x);
      if (ry <= currentY + stepTolerance) {
        height = Math.max(height, ry);
      }
    }
  }

  return height;
}

function resolveCircleVsBox(
  rx: number,
  rz: number,
  radius: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): { x: number; z: number } {
  const closestX = Math.max(minX, Math.min(rx, maxX));
  const closestZ = Math.max(minZ, Math.min(rz, maxZ));
  const dx = rx - closestX;
  const dz = rz - closestZ;
  const distSq = dx * dx + dz * dz;
  if (distSq >= radius * radius) return { x: rx, z: rz };

  if (distSq > 0.000001) {
    const dist = Math.sqrt(distSq);
    const push = radius - dist;
    return { x: rx + (dx / dist) * push, z: rz + (dz / dist) * push };
  }

  const penLeft = Math.abs(rx - minX);
  const penRight = Math.abs(maxX - rx);
  const penTop = Math.abs(rz - minZ);
  const penBottom = Math.abs(maxZ - rz);
  const minPen = Math.min(penLeft, penRight, penTop, penBottom);
  if (minPen === penLeft) return { x: minX - radius, z: rz };
  if (minPen === penRight) return { x: maxX + radius, z: rz };
  if (minPen === penTop) return { x: rx, z: minZ - radius };
  return { x: rx, z: maxZ + radius };
}

export function resolveHorizontalCollision(
  x: number,
  y: number,
  z: number,
  radius: number,
  layout: MapLayout = DEFAULT_MAP_LAYOUT,
  digHp?: Uint8Array,
): { x: number; z: number } {
  let rx = Math.max(ARENA_BOUNDS.minX + radius, Math.min(ARENA_BOUNDS.maxX - radius, x));
  let rz = Math.max(ARENA_BOUNDS.minZ + radius, Math.min(ARENA_BOUNDS.maxZ - radius, z));

  const feetY = y;
  const headY = y + 1.75;
  const stepClearance = 0.55;

  const { cols, rows, cellSize, originX, originZ, height: digHeight } = UNDERGROUND_GRID;

  for (let iter = 0; iter < 3; iter++) {
    rx = Math.max(ARENA_BOUNDS.minX + radius, Math.min(ARENA_BOUNDS.maxX - radius, rx));
    rz = Math.max(ARENA_BOUNDS.minZ + radius, Math.min(ARENA_BOUNDS.maxZ - radius, rz));

    for (const box of layout.colliders) {
      if (box.kind === 'wall') continue;
      if (box.maxY <= feetY + stepClearance || box.minY >= headY) continue;
      const pushed = resolveCircleVsBox(rx, rz, radius, box.minX, box.maxX, box.minZ, box.maxZ);
      rx = pushed.x;
      rz = pushed.z;
    }

    if (digHp && layout.mode === 'underground' && feetY < digHeight) {
      const minCol = Math.max(0, Math.floor((rx - radius - originX) / cellSize));
      const maxCol = Math.min(cols - 1, Math.floor((rx + radius - originX) / cellSize));
      const minRow = Math.max(0, Math.floor((rz - radius - originZ) / cellSize));
      const maxRow = Math.min(rows - 1, Math.floor((rz + radius - originZ) / cellSize));

      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          if (digHp[r * cols + c] > 0) {
            const bx = originX + c * cellSize;
            const bz = originZ + r * cellSize;
            const pushed = resolveCircleVsBox(rx, rz, radius, bx, bx + cellSize, bz, bz + cellSize);
            rx = pushed.x;
            rz = pushed.z;
          }
        }
      }
    }

    for (const r of layout.ramps) {
      const closestX = Math.max(r.minX, Math.min(rx, r.maxX));
      const closestZ = Math.max(r.minZ, Math.min(rz, r.maxZ));
      const ryAtClosest = getRampHeightAt(r, closestX);
      if (ryAtClosest <= feetY + stepClearance) continue;
      const pushed = resolveCircleVsBox(rx, rz, radius, r.minX, r.maxX, r.minZ, r.maxZ);
      rx = pushed.x;
      rz = pushed.z;
    }
  }

  return { x: rx, z: rz };
}

export function rayIntersectsAABB(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  box: Pick<AABB, 'minX' | 'maxX' | 'minY' | 'maxY' | 'minZ' | 'maxZ'>,
  maxDist: number,
): number | null {
  let tmin = 0;
  let tmax = maxDist;

  if (Math.abs(dx) < 1e-8) {
    if (ox < box.minX || ox > box.maxX) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (box.minX - ox) * inv;
    let t2 = (box.maxX - ox) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  if (Math.abs(dy) < 1e-8) {
    if (oy < box.minY || oy > box.maxY) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (box.minY - oy) * inv;
    let t2 = (box.maxY - oy) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  if (Math.abs(dz) < 1e-8) {
    if (oz < box.minZ || oz > box.maxZ) return null;
  } else {
    const inv = 1 / dz;
    let t1 = (box.minZ - oz) * inv;
    let t2 = (box.maxZ - oz) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  return tmin >= 0 && tmin <= maxDist ? tmin : null;
}

function rayIntersectsRamp(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  r: RampZone,
  maxDist: number,
): number | null {
  const slope = (r.yAtMaxX - r.yAtMinX) / (r.maxX - r.minX);
  const y0 = r.yAtMinX - slope * r.minX;
  const denom = dy - slope * dx;
  if (Math.abs(denom) < 1e-6) return null;

  let best: number | null = null;
  for (const offset of [0, -0.24]) {
    const t = (y0 + offset + slope * ox - oy) / denom;
    if (t > 0 && t <= maxDist) {
      const hx = ox + dx * t;
      const hz = oz + dz * t;
      if (hx >= r.minX && hx <= r.maxX && hz >= r.minZ && hz <= r.maxZ) {
        if (best === null || t < best) best = t;
      }
    }
  }
  return best;
}

export function raycastDigGrid(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  digHp: Uint8Array,
): { dist: number; index: number } | null {
  const { cols, rows, cellSize, originX, originZ, height } = UNDERGROUND_GRID;
  let closest = maxDist;
  let hitIdx = -1;

  // Step-accelerated bounding sweep across the ray's XZ footprint
  const minX = Math.min(ox, ox + dx * maxDist) - 0.5;
  const maxX = Math.max(ox, ox + dx * maxDist) + 0.5;
  const minZ = Math.min(oz, oz + dz * maxDist) - 0.5;
  const maxZ = Math.max(oz, oz + dz * maxDist) + 0.5;

  const c0 = Math.max(0, Math.floor((minX - originX) / cellSize));
  const c1 = Math.min(cols - 1, Math.floor((maxX - originX) / cellSize));
  const r0 = Math.max(0, Math.floor((minZ - originZ) / cellSize));
  const r1 = Math.min(rows - 1, Math.floor((maxZ - originZ) / cellSize));

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const idx = r * cols + c;
      if (digHp[idx] <= 0) continue;
      const bx = originX + c * cellSize;
      const bz = originZ + r * cellSize;
      const t = rayIntersectsAABB(
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        { minX: bx, maxX: bx + cellSize, minY: 0, maxY: height, minZ: bz, maxZ: bz + cellSize },
        closest,
      );
      if (t !== null && t < closest) {
        closest = t;
        hitIdx = idx;
      }
    }
  }

  return hitIdx !== -1 ? { dist: closest, index: hitIdx } : null;
}

export function rayIntersectsArenaObstacle(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  layout: MapLayout = DEFAULT_MAP_LAYOUT,
  digHp?: Uint8Array,
): number {
  let closest = maxDist;
  for (const box of layout.colliders) {
    const t = rayIntersectsAABB(ox, oy, oz, dx, dy, dz, box, closest);
    if (t !== null && t < closest) {
      closest = t;
    }
  }
  for (const r of layout.ramps) {
    const t = rayIntersectsRamp(ox, oy, oz, dx, dy, dz, r, closest);
    if (t !== null && t < closest) {
      closest = t;
    }
  }
  if (digHp && layout.mode === 'underground') {
    const digHit = raycastDigGrid(ox, oy, oz, dx, dy, dz, closest, digHp);
    if (digHit && digHit.dist < closest) {
      closest = digHit.dist;
    }
  }
  if (dy < -1e-6 && oy > 0) {
    const tFloor = -oy / dy;
    if (tFloor > 0 && tFloor < closest) {
      closest = tFloor;
    }
  }
  if (layout.ceilingY !== null && dy > 1e-6 && oy < layout.ceilingY) {
    const tCeil = (layout.ceilingY - oy) / dy;
    if (tCeil > 0 && tCeil < closest) {
      closest = tCeil;
    }
  }
  return closest;
}

export function isPointClearOfObstacles(
  x: number,
  y: number,
  z: number,
  radius = 0.78,
  layout: MapLayout = DEFAULT_MAP_LAYOUT,
  digHp?: Uint8Array,
): boolean {
  if (
    x < ARENA_BOUNDS.minX + radius ||
    x > ARENA_BOUNDS.maxX - radius ||
    z < ARENA_BOUNDS.minZ + radius ||
    z > ARENA_BOUNDS.maxZ - radius
  ) {
    return false;
  }

  const headY = y + 1.75;
  const stepClearance = 0.55;

  for (const box of layout.colliders) {
    if (box.kind === 'wall') continue;
    if (box.maxY <= y + stepClearance || box.minY >= headY) continue;
    if (
      x >= box.minX - radius &&
      x <= box.maxX + radius &&
      z >= box.minZ - radius &&
      z <= box.maxZ + radius
    ) {
      return false;
    }
  }

  if (digHp && layout.mode === 'underground') {
    const { cols, rows, cellSize, originX, originZ } = UNDERGROUND_GRID;
    const minCol = Math.max(0, Math.floor((x - radius - originX) / cellSize));
    const maxCol = Math.min(cols - 1, Math.floor((x + radius - originX) / cellSize));
    const minRow = Math.max(0, Math.floor((z - radius - originZ) / cellSize));
    const maxRow = Math.min(rows - 1, Math.floor((z + radius - originZ) / cellSize));
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        if (digHp[r * cols + c] > 0) return false;
      }
    }
  }

  for (const r of layout.ramps) {
    const closestX = Math.max(r.minX, Math.min(x, r.maxX));
    const closestZ = Math.max(r.minZ, Math.min(z, r.maxZ));
    const ry = getRampHeightAt(r, closestX);
    if (ry <= y + stepClearance) continue;
    const dx = x - closestX;
    const dz = z - closestZ;
    if (dx * dx + dz * dz < radius * radius) {
      return false;
    }
  }

  return true;
}

export function hasClearNavLine(
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  z2: number,
  radius = 0.72,
  layout: MapLayout = DEFAULT_MAP_LAYOUT,
  digHp?: Uint8Array,
): boolean {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.25) return true;

  const steps = Math.ceil(dist / 0.65);
  let prevY = y1;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const sx = x1 + dx * t;
    const sz = z1 + dz * t;
    const sy = getGroundHeightAt(sx, sz, prevY, layout);
    if (Math.abs(sy - prevY) > 0.7) return false;
    if (!isPointClearOfObstacles(sx, sy, sz, radius, layout, digHp)) return false;
    prevY = sy;
  }
  return true;
}

interface NavGridCell {
  walkable: boolean;
  x: number;
  y: number;
  z: number;
}

export class ArenaNavGrid {
  public readonly cellSize = 1.5;
  public readonly originX = -51.75;
  public readonly originZ = -30.0;
  public readonly cols = 69;
  public readonly rows = 40;
  public readonly layers = 2;
  private readonly cells: NavGridCell[];
  private readonly layout: MapLayout;

  constructor(layout: MapLayout = DEFAULT_MAP_LAYOUT) {
    this.layout = layout;
    const total = this.cols * this.rows * this.layers;
    this.cells = new Array<NavGridCell>(total);
    this.buildGrid();
  }

  private idx(layer: number, col: number, row: number): number {
    return (layer * this.rows + row) * this.cols + col;
  }

  private buildGrid(): void {
    const groundRadius = 0.76;
    const bridgeRadius = 0.7;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const wx = this.originX + (c + 0.5) * this.cellSize;
        const wz = this.originZ + (r + 0.5) * this.cellSize;

        const gy0 = getGroundHeightAt(wx, wz, 0.35, this.layout);
        const walkable0 = isPointClearOfObstacles(wx, gy0, wz, groundRadius, this.layout);
        this.cells[this.idx(0, c, r)] = { walkable: walkable0, x: wx, y: gy0, z: wz };

        let walkable1 = false;
        let gy1 = 0;
        if (this.layout.ramps.length > 0) {
          const onHigh = getGroundHeightAt(wx, wz, 2.5, this.layout) > 0.5;
          if (onHigh) {
            gy1 = getGroundHeightAt(wx, wz, 2.5, this.layout);
            walkable1 = isPointClearOfObstacles(wx, gy1, wz, bridgeRadius, this.layout);
          }
        }
        this.cells[this.idx(1, c, r)] = { walkable: walkable1, x: wx, y: gy1, z: wz };
      }
    }
  }

  public worldToCell(x: number, z: number): { col: number; row: number } {
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.originX) / this.cellSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor((z - this.originZ) / this.cellSize)));
    return { col, row };
  }

  private findNearestWalkable(x: number, y: number, z: number): number {
    const { col, row } = this.worldToCell(x, z);
    const preferLayer = y > 0.75 ? 1 : 0;

    let bestIdx = -1;
    let bestScore = Infinity;

    for (let radius = 0; radius <= 4; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const nc = col + dc;
          const nr = row + dr;
          if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
          for (const layer of [preferLayer, 1 - preferLayer]) {
            const id = this.idx(layer, nc, nr);
            const cell = this.cells[id];
            if (!cell.walkable) continue;
            const d = Math.hypot(cell.x - x, cell.z - z) + Math.abs(cell.y - y) * 2.5;
            if (d < bestScore) {
              bestScore = d;
              bestIdx = id;
            }
          }
        }
      }
      if (bestIdx !== -1) return bestIdx;
    }

    return this.idx(0, col, row);
  }

  public findPath(
    sx: number,
    sy: number,
    sz: number,
    tx: number,
    ty: number,
    tz: number,
    laneBias: 'center' | 'north' | 'south' | 'none' = 'none',
    digHp?: Uint8Array,
  ): Vec3[] {
    const startIdx = this.findNearestWalkable(sx, sy, sz);
    const goalIdx = this.findNearestWalkable(tx, ty, tz);
    if (startIdx === -1 || goalIdx === -1 || startIdx === goalIdx) {
      return [{ x: tx, y: ty, z: tz }];
    }

    const total = this.cells.length;
    const gScore = new Float32Array(total);
    const fScore = new Float32Array(total);
    const cameFrom = new Int32Array(total);
    const closed = new Uint8Array(total);
    const inOpen = new Uint8Array(total);

    gScore.fill(Infinity);
    fScore.fill(Infinity);
    cameFrom.fill(-1);

    const openList: number[] = [startIdx];
    gScore[startIdx] = 0;
    const goalCell = this.cells[goalIdx];
    const startCell = this.cells[startIdx];
    fScore[startIdx] = Math.hypot(goalCell.x - startCell.x, goalCell.z - startCell.z);
    inOpen[startIdx] = 1;

    const layerSize = this.cols * this.rows;
    const dirs = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, 1.414],
      [1, -1, 1.414],
      [-1, 1, 1.414],
      [-1, -1, 1.414],
    ];

    let iterations = 0;
    while (openList.length > 0 && iterations < 3500) {
      iterations++;
      let bestPos = 0;
      let bestF = fScore[openList[0]];
      for (let i = 1; i < openList.length; i++) {
        const f = fScore[openList[i]];
        if (f < bestF) {
          bestF = f;
          bestPos = i;
        }
      }
      const current = openList[bestPos];
      openList[bestPos] = openList[openList.length - 1];
      openList.pop();
      inOpen[current] = 0;

      if (current === goalIdx) {
        return this.reconstructAndSmooth(cameFrom, startIdx, goalIdx, sx, sy, sz, tx, ty, tz, digHp);
      }

      closed[current] = 1;

      const curLayer = Math.floor(current / layerSize);
      const rem = current - curLayer * layerSize;
      const curRow = Math.floor(rem / this.cols);
      const curCol = rem - curRow * this.cols;
      const curCell = this.cells[current];

      for (let d = 0; d < dirs.length; d++) {
        const dc = dirs[d][0];
        const dr = dirs[d][1];
        const stepCost = dirs[d][2] * this.cellSize;
        const nc = curCol + dc;
        const nr = curRow + dr;
        if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;

        const nIdx = this.idx(curLayer, nc, nr);
        if (closed[nIdx]) continue;
        const nCell = this.cells[nIdx];
        if (!nCell.walkable) continue;
        if (Math.abs(nCell.y - curCell.y) > 0.9) continue;

        if (dc !== 0 && dr !== 0) {
          const adj1 = this.cells[this.idx(curLayer, curCol + dc, curRow)];
          const adj2 = this.cells[this.idx(curLayer, curCol, curRow + dr)];
          if (!adj1.walkable || !adj2.walkable) continue;
        }

        let mult = 1;
        if (laneBias === 'north' && nCell.z > -6) mult = 1.25;
        else if (laneBias === 'south' && nCell.z < 6) mult = 1.25;
        else if (laneBias === 'center' && Math.abs(nCell.z) > 14) mult = 1.2;

        // In underground mode, already-dug tunnels cost 1x while intact dirt costs 4.2x
        if (digHp && this.layout.mode === 'underground') {
          const ug = worldToUndergroundCell(nCell.x, nCell.z);
          if (ug && digHp[ug.idx] > 0) {
            mult *= 4.2;
          }
        }

        const tentativeG = gScore[current] + stepCost * mult;
        if (tentativeG < gScore[nIdx]) {
          cameFrom[nIdx] = current;
          gScore[nIdx] = tentativeG;
          fScore[nIdx] = tentativeG + Math.hypot(goalCell.x - nCell.x, goalCell.z - nCell.z);
          if (!inOpen[nIdx]) {
            openList.push(nIdx);
            inOpen[nIdx] = 1;
          }
        }
      }

      const otherLayer = 1 - curLayer;
      const otherIdx = this.idx(otherLayer, curCol, curRow);
      if (!closed[otherIdx]) {
        const otherCell = this.cells[otherIdx];
        if (otherCell.walkable && Math.abs(otherCell.y - curCell.y) <= 0.65) {
          const tentativeG = gScore[current] + 0.4;
          if (tentativeG < gScore[otherIdx]) {
            cameFrom[otherIdx] = current;
            gScore[otherIdx] = tentativeG;
            fScore[otherIdx] = tentativeG + Math.hypot(goalCell.x - otherCell.x, goalCell.z - otherCell.z);
            if (!inOpen[otherIdx]) {
              openList.push(otherIdx);
              inOpen[otherIdx] = 1;
            }
          }
        }
      }
    }

    return [{ x: tx, y: ty, z: tz }];
  }

  private reconstructAndSmooth(
    cameFrom: Int32Array,
    startIdx: number,
    goalIdx: number,
    sx: number,
    sy: number,
    sz: number,
    tx: number,
    ty: number,
    tz: number,
    digHp?: Uint8Array,
  ): Vec3[] {
    const raw: Vec3[] = [];
    let cur = goalIdx;
    while (cur !== -1 && cur !== startIdx) {
      const c = this.cells[cur];
      raw.push({ x: c.x, y: c.y, z: c.z });
      cur = cameFrom[cur];
    }
    raw.reverse();
    if (raw.length === 0) return [{ x: tx, y: ty, z: tz }];

    const last = raw[raw.length - 1];
    if (hasClearNavLine(last.x, last.y, last.z, tx, tz, 0.7, this.layout, digHp)) {
      raw.push({ x: tx, y: ty, z: tz });
    }

    const smoothed: Vec3[] = [];
    let anchor: Vec3 = { x: sx, y: sy, z: sz };
    let i = 0;
    while (i < raw.length) {
      let furthest = i;
      for (let j = Math.min(raw.length - 1, i + 8); j > i; j--) {
        if (
          Math.abs(raw[j].y - anchor.y) < 1.2 &&
          hasClearNavLine(anchor.x, anchor.y, anchor.z, raw[j].x, raw[j].z, 0.72, this.layout, digHp)
        ) {
          furthest = j;
          break;
        }
      }
      smoothed.push(raw[furthest]);
      anchor = raw[furthest];
      i = furthest + 1;
    }

    return smoothed;
  }
}
