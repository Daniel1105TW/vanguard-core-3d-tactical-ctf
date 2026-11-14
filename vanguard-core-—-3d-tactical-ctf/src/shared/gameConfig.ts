import type { AABB, MapLayout, MapMode, RampZone, TeamId, Vec3 } from './mapBuilder.ts';
export {
  ARENA_BOUNDS,
  ArenaNavGrid,
  DEFAULT_MAP_LAYOUT,
  FLAG_BASES,
  MAP_MODES,
  SPAWN_POINTS,
  UNDERGROUND_GRID,
  createInitialUndergroundHp,
  generateMapLayout,
  getGroundHeightAt,
  getUndergroundCellBounds,
  hasClearNavLine,
  isPointClearOfObstacles,
  rayIntersectsAABB,
  rayIntersectsArenaObstacle,
  raycastDigGrid,
  resolveHorizontalCollision,
  worldToUndergroundCell,
} from './mapBuilder.ts';
export type { AABB, MapLayout, MapMode, MapModeInfo, RampZone, TeamId, Vec3 } from './mapBuilder.ts';

export type WeaponId =
  | 'pistol'
  | 'smg'
  | 'shotgun'
  | 'rifle'
  | 'burst'
  | 'sniper'
  | 'gatling'
  | 'plasma';
export type GadgetId = 'frag' | 'smoke' | 'emp';
export type UpgradeStat = 'damage' | 'fireRate' | 'mag';
export type FlagStatus = 'base' | 'carried' | 'dropped';
export type MatchPhase = 'lobby' | 'playing' | 'ended';

export interface GadgetSpec {
  id: GadgetId;
  name: string;
  englishName: string;
  description: string;
  cost: number;
  maxCarry: number;
  fuseSec: number;
  radius: number;
  accentColor: string;
}

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  englishName: string;
  description: string;
  cost: number;
  damage: number;
  fireInterval: number;
  magSize: number;
  reloadTime: number;
  spread: number;
  pellets: number;
  automatic: boolean;
  moveSpeedMult: number;
  range: number;
  tracerColor: string;
  adsFov: number;
  scopeType: 'iron' | 'holo' | 'sniper';
}

export interface WeaponUpgradeState {
  damageLevel: number;
  fireRateLevel: number;
  magLevel: number;
}

export interface ActorSnapshot {
  id: string;
  name: string;
  isBot: boolean;
  team: TeamId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnTimer: number;
  money: number;
  kills: number;
  deaths: number;
  captures: number;
  returns: number;
  activeWeapon: WeaponId;
  ammo: number;
  maxAmmo: number;
  reloading: boolean;
  crouching?: boolean;
  slowed?: boolean;
  ownedWeapons: Partial<Record<WeaponId, WeaponUpgradeState>>;
  activeGadget: GadgetId;
  gadgets: Partial<Record<GadgetId, number>>;
}

export interface FlagSnapshot {
  team: TeamId;
  status: FlagStatus;
  carrierId: string | null;
  x: number;
  y: number;
  z: number;
  autoReturnTimer: number;
}

export interface RoomSettings {
  teamSize: 3 | 4;
  durationSec: number;
  scoreLimit: number;
  mapMode: MapMode;
}

export interface RoomLobbyInfo {
  roomId: string;
  hostId: string;
  phase: MatchPhase;
  settings: RoomSettings;
  players: Array<{
    id: string;
    name: string;
    team: TeamId;
    isBot: boolean;
  }>;
}

export interface DigUpdateEvent {
  index: number;
  hp: number;
  digVersion: number;
  x: number;
  z: number;
  byTeam?: TeamId;
}

export interface ProjectileSnapshot {
  id: string;
  type: GadgetId;
  team: TeamId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface SmokeZoneSnapshot {
  id: string;
  team: TeamId;
  x: number;
  y: number;
  z: number;
  radius: number;
  remainingSec: number;
  maxSec: number;
}

export interface GadgetFxEvent {
  id: string;
  type: GadgetId;
  kind: 'throw' | 'explode';
  team: TeamId;
  shooterId: string;
  x: number;
  y: number;
  z: number;
  radius?: number;
}

export interface StateSyncPayload {
  roomId: string;
  phase: MatchPhase;
  timeRemaining: number;
  overtime: boolean;
  redScore: number;
  blueScore: number;
  scoreLimit: number;
  winnerTeam: TeamId | 'draw' | null;
  paused?: boolean;
  humanCount?: number;
  mapMode: MapMode;
  mapSeed: number;
  digVersion?: number;
  dugCells?: number[];
  flags: Record<TeamId, FlagSnapshot>;
  actors: ActorSnapshot[];
  projectiles: ProjectileSnapshot[];
  smokeZones: SmokeZoneSnapshot[];
}

export interface KillFeedEvent {
  id: string;
  timestamp: number;
  type: 'kill' | 'pickup' | 'capture' | 'return' | 'drop';
  actorName: string;
  actorTeam: TeamId;
  targetName?: string;
  targetTeam?: TeamId;
  weaponId?: WeaponId;
  gadgetId?: GadgetId;
  headshot?: boolean;
}

export interface TracerEvent {
  shooterId: string;
  team: TeamId;
  weaponId: WeaponId;
  from: Vec3;
  to: Vec3;
  hitActorId?: string;
  headshot?: boolean;
  damage?: number;
  killed?: boolean;
}

export interface MatchEndSummary {
  winnerTeam: TeamId | 'draw';
  redScore: number;
  blueScore: number;
  victoryBonus: number;
  actors: ActorSnapshot[];
}

export const ECONOMY = {
  STARTING_MONEY: 200,
  STIPEND_COST: 350,
  STIPEND_MATCH_BONUS: 350,
  KILL_REWARD: 150,
  HEADSHOT_BONUS: 50,
  FLAG_CARRIER_KILL_BONUS: 75,
  FLAG_PICKUP_REWARD: 100,
  FLAG_RETURN_REWARD: 75,
  FLAG_CAPTURE_REWARD: 400,
  FLAG_CAPTURE_TEAM_REWARD: 150,
  VICTORY_TEAM_BONUS: 1000,
} as const;

export const MAX_UPGRADE_LEVEL = 4;
export const UPGRADE_COSTS = [0, 220, 380, 560] as const;

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol: {
    id: 'pistol',
    name: '脈衝手槍',
    englishName: 'Pulse Pistol',
    description: '輕巧精準的初始配槍，移動速度最快，適合搶旗突圍。',
    cost: 0,
    damage: 24,
    fireInterval: 0.25,
    magSize: 14,
    reloadTime: 1.2,
    spread: 0.01,
    pellets: 1,
    automatic: false,
    moveSpeedMult: 1.06,
    range: 95,
    tracerColor: '#38bdf8',
    adsFov: 58,
    scopeType: 'iron',
  },
  smg: {
    id: 'smg',
    name: '先鋒衝鋒槍',
    englishName: 'Vanguard SMG',
    description: '高射速近中距離壓制武器，攜旗衝鋒首選。',
    cost: 400,
    damage: 15,
    fireInterval: 0.095,
    magSize: 32,
    reloadTime: 1.45,
    spread: 0.026,
    pellets: 1,
    automatic: true,
    moveSpeedMult: 1.04,
    range: 75,
    tracerColor: '#22d3ee',
    adsFov: 56,
    scopeType: 'holo',
  },
  shotgun: {
    id: 'shotgun',
    name: '破門霰彈槍',
    englishName: 'Breacher Shotgun',
    description: '單發 7 顆高能彈丸，基地守點與近戰秒殺利器。',
    cost: 650,
    damage: 14,
    fireInterval: 0.68,
    magSize: 8,
    reloadTime: 1.85,
    spread: 0.068,
    pellets: 7,
    automatic: false,
    moveSpeedMult: 1.0,
    range: 42,
    tracerColor: '#fb923c',
    adsFov: 60,
    scopeType: 'iron',
  },
  rifle: {
    id: 'rifle',
    name: '突擊步槍',
    englishName: 'Striker Rifle',
    description: '全距離均衡火力，穩定點射與中遠程壓制核心。',
    cost: 750,
    damage: 25,
    fireInterval: 0.135,
    magSize: 28,
    reloadTime: 1.65,
    spread: 0.013,
    pellets: 1,
    automatic: true,
    moveSpeedMult: 0.98,
    range: 120,
    tracerColor: '#fbbf24',
    adsFov: 50,
    scopeType: 'holo',
  },
  burst: {
    id: 'burst',
    name: '精準脈衝卡賓',
    englishName: 'Pulse Marksman',
    description: '配備 2x 光學瞄準鏡的高精準電磁卡賓，中遠程點射極具威脅。',
    cost: 900,
    damage: 38,
    fireInterval: 0.24,
    magSize: 20,
    reloadTime: 1.65,
    spread: 0.005,
    pellets: 1,
    automatic: false,
    moveSpeedMult: 0.96,
    range: 135,
    tracerColor: '#34d399',
    adsFov: 38,
    scopeType: 'sniper',
  },
  sniper: {
    id: 'sniper',
    name: '磁軌狙擊槍',
    englishName: 'Rail Sniper',
    description: '高倍率遠程瞄準鏡與貫穿電磁束，爆頭可直接秒殺滿血敵人。',
    cost: 1100,
    damage: 78,
    fireInterval: 0.95,
    magSize: 5,
    reloadTime: 2.1,
    spread: 0.0015,
    pellets: 1,
    automatic: false,
    moveSpeedMult: 0.92,
    range: 160,
    tracerColor: '#c084fc',
    adsFov: 26,
    scopeType: 'sniper',
  },
  gatling: {
    id: 'gatling',
    name: '火神加特林機槍',
    englishName: 'Vulcan Gatling',
    description: '六管旋轉重型能量機槍，每秒 18 發狂暴彈幕與 100 發超大彈鼓。',
    cost: 1350,
    damage: 12,
    fireInterval: 0.056,
    magSize: 100,
    reloadTime: 2.7,
    spread: 0.036,
    pellets: 1,
    automatic: true,
    moveSpeedMult: 0.85,
    range: 92,
    tracerColor: '#f43f5e',
    adsFov: 58,
    scopeType: 'iron',
  },
  plasma: {
    id: 'plasma',
    name: '重型電漿砲',
    englishName: 'Nova Plasma Cannon',
    description: '雙極高能磁束砲，單發雙重高爆電漿束，近中距離瞬間融毀護甲。',
    cost: 1600,
    damage: 46,
    fireInterval: 0.92,
    magSize: 6,
    reloadTime: 2.25,
    spread: 0.016,
    pellets: 2,
    automatic: false,
    moveSpeedMult: 0.88,
    range: 110,
    tracerColor: '#e879f9',
    adsFov: 48,
    scopeType: 'holo',
  },
};

export const WEAPON_ORDER: WeaponId[] = [
  'pistol',
  'smg',
  'shotgun',
  'rifle',
  'burst',
  'sniper',
  'gatling',
  'plasma',
];

export const GADGETS: Record<GadgetId, GadgetSpec> = {
  frag: {
    id: 'frag',
    name: '高爆手榴彈',
    englishName: 'Frag Grenade',
    description: '投擲後 1.3 秒引爆，造成高達 95 範圍破片傷害，並可於地底模式炸開土牆隧道。',
    cost: 150,
    maxCarry: 2,
    fuseSec: 1.3,
    radius: 5.5,
    accentColor: '#f97316',
  },
  smoke: {
    id: 'smoke',
    name: '戰術煙霧彈',
    englishName: 'Tactical Smoke',
    description: '展開持續 9.5 秒的濃密立體煙幕，掩護搶旗撤退並阻斷敵方 AI 視線與鎖定。',
    cost: 120,
    maxCarry: 2,
    fuseSec: 0.75,
    radius: 5.4,
    accentColor: '#94a3b8',
  },
  emp: {
    id: 'emp',
    name: '電磁震撼彈',
    englishName: 'EMP Pulse Grenade',
    description: '釋放高壓電磁衝擊波，造成 25 傷害並使範圍內敵人減速與干擾 AI 射擊 2.8 秒。',
    cost: 140,
    maxCarry: 2,
    fuseSec: 0.9,
    radius: 6.0,
    accentColor: '#a855f7',
  },
};

export const GADGET_ORDER: GadgetId[] = ['frag', 'smoke', 'emp'];

export function getEffectiveWeaponStats(weaponId: WeaponId, upgrades?: WeaponUpgradeState) {
  const base = WEAPONS[weaponId];
  const dmgLv = upgrades?.damageLevel ?? 1;
  const frLv = upgrades?.fireRateLevel ?? 1;
  const magLv = upgrades?.magLevel ?? 1;

  return {
    ...base,
    damage: Math.round(base.damage * (1 + (dmgLv - 1) * 0.18)),
    fireInterval: Number((base.fireInterval / (1 + (frLv - 1) * 0.14)).toFixed(3)),
    magSize: Math.round(base.magSize * (1 + (magLv - 1) * 0.25)),
    reloadTime: Number((base.reloadTime / (1 + (magLv - 1) * 0.1)).toFixed(2)),
  };
}

// Legacy compatibility alias for default map layout
export const ARENA_COLLIDERS: AABB[] = [];
export const ARENA_RAMPS: RampZone[] = [];
void (null as unknown as MapLayout);


