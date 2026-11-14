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
  | 'vector'
  | 'shotgun'
  | 'rifle'
  | 'burst'
  | 'laser'
  | 'freezer'
  | 'sniper'
  | 'gatling'
  | 'plasma'
  | 'autocannon'
  | 'katana'
  | 'twinblades'
  | 'greatsword'
  | 'plasma_saber';
export type GadgetId = 'frag' | 'smoke' | 'emp' | 'cryo' | 'medkit' | 'stim';
export type GameMode = 'ctf' | 'tdm' | 'dom';
export type UpgradeStat = 'damage' | 'fireRate' | 'mag';
export type FlagStatus = 'base' | 'carried' | 'dropped';
export type MatchPhase = 'lobby' | 'playing' | 'ended';
export type CrosshairStyle = 'cross' | 'dot' | 'circle' | 'tactical';
export type CrosshairColor = 'white' | 'cyan' | 'emerald' | 'amber';

export interface GameModeInfo {
  id: GameMode;
  name: string;
  shortLabel: string;
  description: string;
  scoreUnit: string;
  scoreOptions: readonly number[];
  defaultScoreLimit: number;
}

export const GAME_MODES: readonly GameModeInfo[] = [
  {
    id: 'ctf',
    name: '搶旗突襲',
    shortLabel: '搶旗',
    description: '潛入敵方基地奪取旗幟並帶回己方底座得分。',
    scoreUnit: '旗',
    scoreOptions: [3, 5, 7],
    defaultScoreLimit: 5,
  },
  {
    id: 'tdm',
    name: '團隊死鬥',
    shortLabel: '死鬥',
    description: '純粹火力交鋒，率先達成指定總擊殺數的隊伍獲勝。',
    scoreUnit: '殺',
    scoreOptions: [25, 35, 50],
    defaultScoreLimit: 35,
  },
  {
    id: 'dom',
    name: '據點佔領',
    shortLabel: '據點',
    description: '控制中央戰術核心累積積分，率先達成據點分數獲勝。',
    scoreUnit: '分',
    scoreOptions: [100, 150, 200],
    defaultScoreLimit: 150,
  },
] as const;

export const CONTROL_ZONE_SPEC = {
  x: 0,
  z: 0,
  radius: 7.5,
} as const;

export interface CrosshairSettings {
  style: CrosshairStyle;
  color: CrosshairColor;
  size: number;
  showDot: boolean;
}

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
  instantUse?: boolean;
}

export interface WeaponSpec {
  id: WeaponId;
  category: 'gun' | 'sword';
  isMelee?: boolean;
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
  slowOnHitSec?: number;
  healOnHit?: number;
  splashRadius?: number;
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
  assists: number;
  headshots: number;
  damageDealt: number;
  currentStreak: number;
  bestStreak: number;
  captures: number;
  returns: number;
  zoneScore: number;
  activeWeapon: WeaponId;
  ammo: number;
  maxAmmo: number;
  reloading: boolean;
  crouching?: boolean;
  slowed?: boolean;
  boosted?: boolean;
  regenerating?: boolean;
  devMode?: boolean;
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
  gameMode: GameMode;
}

export interface ControlZoneSnapshot {
  x: number;
  y: number;
  z: number;
  radius: number;
  owner: TeamId | 'neutral';
  captureTeam: TeamId | 'neutral';
  progress: number;
  contested: boolean;
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

export type PingKind = 'location' | 'enemy' | 'carrier';

export interface TacticalPing {
  id: string;
  team: TeamId;
  creatorId: string;
  creatorName: string;
  kind: PingKind;
  x: number;
  y: number;
  z: number;
  targetActorId?: string;
  targetName?: string;
  ttlSec: number;
  remainingSec: number;
  createdAt: number;
  expiresAt: number;
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
  gameMode: GameMode;
  mapMode: MapMode;
  mapSeed: number;
  digVersion?: number;
  dugCells?: number[];
  flags: Record<TeamId, FlagSnapshot>;
  controlZone?: ControlZoneSnapshot;
  actors: ActorSnapshot[];
  projectiles: ProjectileSnapshot[];
  smokeZones: SmokeZoneSnapshot[];
  pings?: TacticalPing[];
}

export interface KillFeedEvent {
  id: string;
  timestamp: number;
  type: 'kill' | 'pickup' | 'capture' | 'return' | 'drop' | 'zone_capture';
  actorName: string;
  actorTeam: TeamId;
  targetName?: string;
  targetTeam?: TeamId;
  weaponId?: WeaponId;
  gadgetId?: GadgetId;
  headshot?: boolean;
}

export interface DamageIndicatorEvent {
  sourcePos: Vec3;
  damage: number;
  headshot?: boolean;
  timestamp: number;
}

export interface TeamChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  team: TeamId;
  text: string;
  createdAt: number;
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
  isMelee?: boolean;
  streakCount?: number;
}

export interface MatchEndSummary {
  winnerTeam: TeamId | 'draw';
  gameMode: GameMode;
  scoreLimit: number;
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
  ASSIST_REWARD: 45,
  HEADSHOT_BONUS: 50,
  FLAG_CARRIER_KILL_BONUS: 75,
  FLAG_PICKUP_REWARD: 100,
  FLAG_RETURN_REWARD: 75,
  FLAG_CAPTURE_REWARD: 400,
  FLAG_CAPTURE_TEAM_REWARD: 150,
  ZONE_CAPTURE_REWARD: 100,
  ZONE_TICK_REWARD: 15,
  VICTORY_TEAM_BONUS: 1000,
} as const;

export const MAX_UPGRADE_LEVEL = 4;
export const UPGRADE_COSTS = [0, 220, 380, 560] as const;

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol: {
    id: 'pistol',
    category: 'gun',
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
    category: 'gun',
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
  vector: {
    id: 'vector',
    category: 'gun',
    name: '疾風雙微衝',
    englishName: 'Cyclone PDW',
    description: '極致近戰射速與 40 發大容量彈匣，近距離瞬間傾瀉彈幕。',
    cost: 540,
    damage: 13,
    fireInterval: 0.068,
    magSize: 40,
    reloadTime: 1.38,
    spread: 0.03,
    pellets: 1,
    automatic: true,
    moveSpeedMult: 1.07,
    range: 68,
    tracerColor: '#2dd4bf',
    adsFov: 56,
    scopeType: 'holo',
  },
  shotgun: {
    id: 'shotgun',
    category: 'gun',
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
    category: 'gun',
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
    category: 'gun',
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
  freezer: {
    id: 'freezer',
    category: 'gun',
    name: '極寒冷凍步槍',
    englishName: 'Cryo Frost Rifle',
    description: '發射超低溫凍能光束，命中敵人可使其減速 1.4 秒，專剋攜旗逃兵。',
    cost: 980,
    damage: 23,
    fireInterval: 0.16,
    magSize: 26,
    reloadTime: 1.6,
    spread: 0.011,
    pellets: 1,
    automatic: true,
    moveSpeedMult: 0.99,
    range: 115,
    tracerColor: '#7dd3fc',
    adsFov: 50,
    scopeType: 'holo',
    slowOnHitSec: 1.4,
  },
  laser: {
    id: 'laser',
    category: 'gun',
    name: '光束脈衝槍',
    englishName: 'Helios Laser',
    description: '零散射高週波雷射步槍，超精準連續射擊與 36 發高能電池。',
    cost: 1050,
    damage: 21,
    fireInterval: 0.108,
    magSize: 36,
    reloadTime: 1.7,
    spread: 0.002,
    pellets: 1,
    automatic: true,
    moveSpeedMult: 0.98,
    range: 138,
    tracerColor: '#67e8f9',
    adsFov: 46,
    scopeType: 'holo',
  },
  sniper: {
    id: 'sniper',
    category: 'gun',
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
    category: 'gun',
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
  autocannon: {
    id: 'autocannon',
    category: 'gun',
    name: '重型爆裂砲',
    englishName: 'Hydra Autocannon',
    description: '大口徑高爆動能砲，命中產生 3.2m 範圍震波傷害並一擊轟穿土牆。',
    cost: 1480,
    damage: 54,
    fireInterval: 0.5,
    magSize: 10,
    reloadTime: 2.15,
    spread: 0.008,
    pellets: 1,
    automatic: false,
    moveSpeedMult: 0.89,
    range: 130,
    tracerColor: '#fb7185',
    adsFov: 44,
    scopeType: 'holo',
    splashRadius: 3.2,
  },
  plasma: {
    id: 'plasma',
    category: 'gun',
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
  katana: {
    id: 'katana',
    category: 'sword',
    isMelee: true,
    name: '疾風光刃武士刀',
    englishName: 'Cyber Katana',
    description: '高週波藍刃武士刀，無限揮砍並大幅提升 18% 移動速度，搶旗突擊神兵。',
    cost: 320,
    damage: 56,
    fireInterval: 0.38,
    magSize: 0,
    reloadTime: 0,
    spread: 0,
    pellets: 1,
    automatic: true,
    moveSpeedMult: 1.18,
    range: 3.7,
    tracerColor: '#22d3ee',
    adsFov: 70,
    scopeType: 'iron',
  },
  twinblades: {
    id: 'twinblades',
    category: 'sword',
    isMelee: true,
    name: '暗影極速雙刃',
    englishName: 'Phantom Twinblades',
    description: '紫能雙持短劍，全場最快 22% 跑速加成與每秒 4 次連斬壓制。',
    cost: 620,
    damage: 38,
    fireInterval: 0.24,
    magSize: 0,
    reloadTime: 0,
    spread: 0,
    pellets: 1,
    automatic: true,
    moveSpeedMult: 1.22,
    range: 3.3,
    tracerColor: '#c084fc',
    adsFov: 70,
    scopeType: 'iron',
  },
  greatsword: {
    id: 'greatsword',
    category: 'sword',
    isMelee: true,
    name: '泰坦破甲巨劍',
    englishName: 'Titan Greatsword',
    description: '重型熔岩寬刃巨劍，單次重劈高達 105 傷害可直接秒殺敵人並斬碎土牆。',
    cost: 820,
    damage: 105,
    fireInterval: 0.72,
    magSize: 0,
    reloadTime: 0,
    spread: 0,
    pellets: 1,
    automatic: true,
    moveSpeedMult: 1.03,
    range: 4.0,
    tracerColor: '#f97316',
    adsFov: 70,
    scopeType: 'iron',
  },
  plasma_saber: {
    id: 'plasma_saber',
    category: 'sword',
    isMelee: true,
    name: '星核電漿聖劍',
    englishName: 'Core Plasma Saber',
    description: '4.2m 超長光束聖劍，每次斬擊命中敵人可汲取 +15 HP 生命回復！',
    cost: 1180,
    damage: 74,
    fireInterval: 0.44,
    magSize: 0,
    reloadTime: 0,
    spread: 0,
    pellets: 1,
    automatic: true,
    moveSpeedMult: 1.14,
    range: 4.2,
    tracerColor: '#f43f5e',
    adsFov: 70,
    scopeType: 'iron',
    healOnHit: 15,
  },
};

export const WEAPON_ORDER: WeaponId[] = [
  'pistol',
  'smg',
  'vector',
  'shotgun',
  'rifle',
  'burst',
  'freezer',
  'laser',
  'sniper',
  'gatling',
  'autocannon',
  'plasma',
  'katana',
  'twinblades',
  'greatsword',
  'plasma_saber',
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
  cryo: {
    id: 'cryo',
    name: '極寒冷凍雷',
    englishName: 'Cryo Freeze Bomb',
    description: '引爆大範圍極寒凍霧 (6.2m)，造成 30 傷害並大幅凍結減緩範圍內敵軍 3.8 秒。',
    cost: 150,
    maxCarry: 2,
    fuseSec: 1.0,
    radius: 6.2,
    accentColor: '#38bdf8',
  },
  medkit: {
    id: 'medkit',
    name: '奈米急救包',
    englishName: 'Nano Medkit',
    description: '按 [G] 立即部署奈米修復場，為自己與 4.5m 內隊友瞬間回復 +55 HP 並解除減速！',
    cost: 130,
    maxCarry: 2,
    fuseSec: 0,
    radius: 4.5,
    accentColor: '#34d399',
    instantUse: true,
  },
  stim: {
    id: 'stim',
    name: '超頻腎上腺素',
    englishName: 'Overdrive Stim',
    description: '按 [G] 立即注射，補滿體力並獲得 6 秒無限體力 + 30% 跑速與 +20% 射速強化！',
    cost: 140,
    maxCarry: 2,
    fuseSec: 0,
    radius: 2.0,
    accentColor: '#facc15',
    instantUse: true,
  },
};

export const GADGET_ORDER: GadgetId[] = ['frag', 'smoke', 'emp', 'cryo', 'medkit', 'stim'];

export function getEffectiveWeaponStats(weaponId: WeaponId, upgrades?: WeaponUpgradeState) {
  const base = WEAPONS[weaponId];
  const dmgLv = upgrades?.damageLevel ?? 1;
  const frLv = upgrades?.fireRateLevel ?? 1;
  const magLv = upgrades?.magLevel ?? 1;

  return {
    ...base,
    damage: Math.round(base.damage * (1 + (dmgLv - 1) * 0.18)),
    fireInterval: Number((base.fireInterval / (1 + (frLv - 1) * 0.14)).toFixed(3)),
    magSize: base.isMelee ? 0 : Math.round(base.magSize * (1 + (magLv - 1) * 0.25)),
    reloadTime: base.isMelee ? 0 : Number((base.reloadTime / (1 + (magLv - 1) * 0.1)).toFixed(2)),
    range: base.isMelee ? Number((base.range + (magLv - 1) * 0.35).toFixed(2)) : base.range,
  };
}

// Legacy compatibility alias for default map layout
export const ARENA_COLLIDERS: AABB[] = [];
export const ARENA_RAMPS: RampZone[] = [];
void (null as unknown as MapLayout);


