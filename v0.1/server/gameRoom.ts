import type { WebSocket } from 'ws';
import {
  ARENA_BOUNDS,
  ArenaNavGrid,
  CONTROL_ZONE_SPEC,
  ECONOMY,
  FLAG_BASES,
  GADGETS,
  GADGET_ORDER,
  GAME_MODES,
  MAX_UPGRADE_LEVEL,
  SPAWN_POINTS,
  UNDERGROUND_GRID,
  UPGRADE_COSTS,
  WEAPONS,
  WEAPON_ORDER,
  createInitialUndergroundHp,
  generateMapLayout,
  getEffectiveWeaponStats,
  getGroundHeightAt,
  getUndergroundCellBounds,
  hasClearNavLine,
  isPointClearOfObstacles,
  rayIntersectsAABB,
  rayIntersectsArenaObstacle,
  raycastDigGrid,
  resolveHorizontalCollision,
} from '../src/shared/gameConfig.ts';
import type {
  ActorSnapshot,
  ControlZoneSnapshot,
  DamageIndicatorEvent,
  DigUpdateEvent,
  FlagSnapshot,
  GadgetFxEvent,
  GadgetId,
  GameMode,
  KillFeedEvent,
  MapLayout,
  MapMode,
  MatchEndSummary,
  MatchPhase,
  PingKind,
  ProjectileSnapshot,
  RoomLobbyInfo,
  RoomSettings,
  SmokeZoneSnapshot,
  StateSyncPayload,
  TacticalPing,
  TeamChatMessage,
  TeamId,
  TracerEvent,
  UpgradeStat,
  Vec3,
  WeaponId,
  WeaponUpgradeState,
} from '../src/shared/gameConfig.ts';

interface InternalActor extends ActorSnapshot {
  ws: WebSocket | null;
  lastShotAt: number;
  lastDigAt: number;
  lastGadgetAt: number;
  lastPingAt: number;
  lastChatAt: number;
  lastDamagedAt: number;
  hpRegenAccum: number;
  boostUntil: number;
  stunnedUntil: number;
  reloadFinishAt: number;
  devMode: boolean;
  weaponAmmo: Partial<Record<WeaponId, number>>;
  recentDamagers: Map<string, number>;
  vy: number;
  aiGoalX: number;
  aiGoalZ: number;
  aiPath: Vec3[];
  aiRepathAt: number;
  aiRole: 'offense' | 'defense' | 'flex';
  aiLaneBias: 'center' | 'north' | 'south' | 'none';
  aiStrafeDir: number;
  aiStrafeFlipAt: number;
  aiNextShopAt: number;
  aiTargetId: string | null;
  aiTargetSeenAt: number;
  aiAimYaw: number;
  aiAimPitch: number;
  aiAimNoiseYaw: number;
  aiAimNoisePitch: number;
  aiNextNoiseAt: number;
  aiBurstShotsLeft: number;
  aiBurstCooldownUntil: number;
}

interface InternalProjectile extends ProjectileSnapshot {
  shooterId: string;
  fuseRemaining: number;
}

interface InternalSmokeZone extends SmokeZoneSnapshot {}

const BOT_NAMES_RED = ['赤焰-AI', '緋紅哨兵-AI', '獵隼-AI', '狂怒-AI'];
const BOT_NAMES_BLUE = ['蒼穹-AI', '極光-AI', '哨衛-AI', '寒霜-AI'];

let eventSeq = 1;

export class GameRoom {
  public readonly roomId: string;
  public hostId: string;
  public phase: MatchPhase = 'lobby';
  public settings: RoomSettings;
  public timeRemaining: number;
  public overtime = false;
  public redScore = 0;
  public blueScore = 0;
  public winnerTeam: TeamId | 'draw' | null = null;
  public paused = false;
  public emptySince: number | null = null;

  private actors = new Map<string, InternalActor>();
  private flags: Record<TeamId, FlagSnapshot>;
  private controlZone: ControlZoneSnapshot;
  private zoneTickAccum = 0;
  private projectiles: InternalProjectile[] = [];
  private smokeZones: InternalSmokeZone[] = [];
  private pings: TacticalPing[] = [];
  private projCounter = 1;
  private pingCounter = 1;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = Date.now();
  private botCounter = 1;
  private mapSeed = Math.floor(Math.random() * 1_000_000_000);
  private layout: MapLayout;
  private navGrid: ArenaNavGrid;
  private digHp: Uint8Array;
  private digVersion = 0;

  constructor(roomId: string, hostId: string, settings?: Partial<RoomSettings>) {
    this.roomId = roomId;
    this.hostId = hostId;
    const validModes: MapMode[] = ['nexus', 'crossfire', 'labyrinth', 'random', 'underground'];
    const mapMode: MapMode = validModes.includes(settings?.mapMode as MapMode)
      ? (settings!.mapMode as MapMode)
      : 'nexus';
    const validGameModes: GameMode[] = ['ctf', 'tdm', 'dom'];
    const gameMode: GameMode = validGameModes.includes(settings?.gameMode as GameMode)
      ? (settings!.gameMode as GameMode)
      : 'ctf';
    const modeInfo = GAME_MODES.find((m) => m.id === gameMode) ?? GAME_MODES[0];
    const scoreLimit =
      typeof settings?.scoreLimit === 'number' && modeInfo.scoreOptions.includes(settings.scoreLimit)
        ? settings.scoreLimit
        : modeInfo.defaultScoreLimit;

    this.settings = {
      teamSize: settings?.teamSize === 4 ? 4 : 3,
      durationSec: settings?.durationSec ?? 300,
      scoreLimit,
      mapMode,
      gameMode,
    };
    this.timeRemaining = this.settings.durationSec;
    this.flags = this.createInitialFlags();
    this.layout = generateMapLayout(this.settings.mapMode, this.mapSeed);
    this.navGrid = new ArenaNavGrid(this.layout);
    this.digHp = createInitialUndergroundHp(this.layout);
    this.controlZone = this.createInitialControlZone();
  }

  private createInitialControlZone(): ControlZoneSnapshot {
    return {
      x: CONTROL_ZONE_SPEC.x,
      y: 0,
      z: CONTROL_ZONE_SPEC.z,
      radius: CONTROL_ZONE_SPEC.radius,
      owner: 'neutral',
      captureTeam: 'neutral',
      progress: 0,
      contested: false,
    };
  }

  private createInitialFlags(): Record<TeamId, FlagSnapshot> {
    return {
      red: {
        team: 'red',
        status: 'base',
        carrierId: null,
        x: FLAG_BASES.red.x,
        y: FLAG_BASES.red.y,
        z: FLAG_BASES.red.z,
        autoReturnTimer: 0,
      },
      blue: {
        team: 'blue',
        status: 'base',
        carrierId: null,
        x: FLAG_BASES.blue.x,
        y: FLAG_BASES.blue.y,
        z: FLAG_BASES.blue.z,
        autoReturnTimer: 0,
      },
    };
  }

  public getHumanCount(): number {
    let count = 0;
    for (const a of this.actors.values()) {
      if (!a.isBot) count++;
    }
    return count;
  }

  public hasCapacity(): boolean {
    return this.getHumanCount() < this.settings.teamSize * 2;
  }

  public getActorTeam(playerId: string): TeamId | undefined {
    return this.actors.get(playerId)?.team;
  }

  public addHumanPlayer(id: string, name: string, ws: WebSocket, preferredTeam?: TeamId, useStipend?: boolean): InternalActor {
    this.emptySince = null;

    // Pick balanced team
    const redHumans = Array.from(this.actors.values()).filter((a) => !a.isBot && a.team === 'red').length;
    const blueHumans = Array.from(this.actors.values()).filter((a) => !a.isBot && a.team === 'blue').length;

    let team: TeamId = preferredTeam ?? (redHumans <= blueHumans ? 'red' : 'blue');
    if (team === 'red' && redHumans >= this.settings.teamSize) team = 'blue';
    if (team === 'blue' && blueHumans >= this.settings.teamSize) team = 'red';

    // If playing, replace a bot on that team if one exists
    if (this.phase === 'playing') {
      const botToReplace = Array.from(this.actors.values()).find((a) => a.isBot && a.team === team);
      if (botToReplace) {
        if (this.flags.red.carrierId === botToReplace.id) this.dropFlag('red', botToReplace);
        if (this.flags.blue.carrierId === botToReplace.id) this.dropFlag('blue', botToReplace);
        this.actors.delete(botToReplace.id);
      }
    }

    const spawn = this.getSpawnPoint(team);
    const startMoney = ECONOMY.STARTING_MONEY + (useStipend ? ECONOMY.STIPEND_MATCH_BONUS : 0);
    const pistolStats = getEffectiveWeaponStats('pistol');

    const actor: InternalActor = {
      id,
      name: name.trim().slice(0, 18) || '特戰隊員',
      isBot: false,
      team,
      ws,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      yaw: team === 'red' ? -Math.PI / 2 : Math.PI / 2,
      pitch: 0,
      hp: 100,
      maxHp: 100,
      alive: true,
      respawnTimer: 0,
      money: startMoney,
      kills: 0,
      deaths: 0,
      assists: 0,
      headshots: 0,
      damageDealt: 0,
      currentStreak: 0,
      bestStreak: 0,
      captures: 0,
      returns: 0,
      zoneScore: 0,
      activeWeapon: 'pistol',
      ammo: pistolStats.magSize,
      maxAmmo: pistolStats.magSize,
      reloading: false,
      crouching: false,
      ownedWeapons: {
        pistol: { damageLevel: 1, fireRateLevel: 1, magLevel: 1 },
      },
      activeGadget: 'frag',
      gadgets: {},
      lastShotAt: 0,
      lastDigAt: 0,
      lastGadgetAt: 0,
      lastPingAt: 0,
      lastChatAt: 0,
      lastDamagedAt: 0,
      hpRegenAccum: 0,
      boostUntil: 0,
      stunnedUntil: 0,
      reloadFinishAt: 0,
      devMode: false,
      weaponAmmo: { pistol: pistolStats.magSize },
      recentDamagers: new Map(),
      vy: 0,
      aiGoalX: 0,
      aiGoalZ: 0,
      aiPath: [],
      aiRepathAt: 0,
      aiRole: 'flex',
      aiLaneBias: 'none',
      aiStrafeDir: 1,
      aiStrafeFlipAt: 0,
      aiNextShopAt: 0,
      aiTargetId: null,
      aiTargetSeenAt: 0,
      aiAimYaw: team === 'red' ? -Math.PI / 2 : Math.PI / 2,
      aiAimPitch: 0,
      aiAimNoiseYaw: 0,
      aiAimNoisePitch: 0,
      aiNextNoiseAt: 0,
      aiBurstShotsLeft: 4,
      aiBurstCooldownUntil: 0,
    };

    this.actors.set(id, actor);
    if (this.getHumanCount() > 1) {
      this.paused = false;
    }
    this.broadcastLobbyInfo();
    return actor;
  }

  public hasHumanPlayer(id: string): boolean {
    const actor = this.actors.get(id);
    return Boolean(actor && !actor.isBot);
  }

  public reattachPlayerSocket(id: string, ws: WebSocket): boolean {
    const actor = this.actors.get(id);
    if (!actor || actor.isBot) return false;
    actor.ws = ws;
    this.emptySince = null;
    return true;
  }

  public removeHumanPlayer(id: string): void {
    const actor = this.actors.get(id);
    if (!actor) return;

    if (this.flags.red.carrierId === id) this.dropFlag('red', actor);
    if (this.flags.blue.carrierId === id) this.dropFlag('blue', actor);
    this.actors.delete(id);

    if (this.hostId === id) {
      const nextHuman = Array.from(this.actors.values()).find((a) => !a.isBot);
      if (nextHuman) this.hostId = nextHuman.id;
    }

    if (this.getHumanCount() === 0) {
      this.emptySince = Date.now();
      this.paused = false;
      this.stopLoop();
    } else if (this.phase === 'playing') {
      this.fillBotsToTeamSize();
    }

    this.broadcastLobbyInfo();
  }

  public switchTeam(playerId: string, targetTeam: TeamId): void {
    if (this.phase !== 'lobby') return;
    const actor = this.actors.get(playerId);
    if (!actor) return;
    const teamHumans = Array.from(this.actors.values()).filter((a) => !a.isBot && a.team === targetTeam).length;
    if (teamHumans >= this.settings.teamSize) return;
    actor.team = targetTeam;
    const spawn = this.getSpawnPoint(targetTeam);
    actor.x = spawn.x;
    actor.y = spawn.y;
    actor.z = spawn.z;
    actor.yaw = targetTeam === 'red' ? -Math.PI / 2 : Math.PI / 2;
    this.broadcastLobbyInfo();
  }

  public updateSettings(playerId: string, next: Partial<RoomSettings>): void {
    if (this.phase !== 'lobby' || playerId !== this.hostId) return;
    if (next.teamSize === 3 || next.teamSize === 4) {
      this.settings.teamSize = next.teamSize;
    }
    if (typeof next.durationSec === 'number' && [180, 300, 480].includes(next.durationSec)) {
      this.settings.durationSec = next.durationSec;
      this.timeRemaining = next.durationSec;
    }
    const validGameModes: GameMode[] = ['ctf', 'tdm', 'dom'];
    if (next.gameMode && validGameModes.includes(next.gameMode) && next.gameMode !== this.settings.gameMode) {
      this.settings.gameMode = next.gameMode;
      const modeInfo = GAME_MODES.find((m) => m.id === next.gameMode) ?? GAME_MODES[0];
      this.settings.scoreLimit = modeInfo.defaultScoreLimit;
    }
    const curModeInfo = GAME_MODES.find((m) => m.id === this.settings.gameMode) ?? GAME_MODES[0];
    if (typeof next.scoreLimit === 'number' && curModeInfo.scoreOptions.includes(next.scoreLimit)) {
      this.settings.scoreLimit = next.scoreLimit;
    }
    const validModes: MapMode[] = ['nexus', 'crossfire', 'labyrinth', 'random', 'underground'];
    if (next.mapMode && validModes.includes(next.mapMode)) {
      this.settings.mapMode = next.mapMode;
    }
    this.broadcastLobbyInfo();
  }

  public startMatch(playerId: string): void {
    if (playerId !== this.hostId && this.getHumanCount() > 1) return;
    this.resetMatchState();
    this.phase = 'playing';
    this.fillBotsToTeamSize();
    this.broadcastLobbyInfo();
    this.broadcast({ type: 'match:started', payload: this.buildStateSync(true) });
    this.startLoop();
  }

  public restartMatch(playerId: string): void {
    if (playerId !== this.hostId && this.getHumanCount() > 1) return;
    this.resetMatchState();
    this.phase = 'playing';
    this.fillBotsToTeamSize();
    this.broadcastLobbyInfo();
    this.broadcast({ type: 'match:started', payload: this.buildStateSync(true) });
    this.startLoop();
  }

  private resetMatchState(): void {
    // Remove old bots
    for (const [id, a] of this.actors.entries()) {
      if (a.isBot) this.actors.delete(id);
    }

    this.redScore = 0;
    this.blueScore = 0;
    this.overtime = false;
    this.paused = false;
    this.winnerTeam = null;
    this.timeRemaining = this.settings.durationSec;
    this.flags = this.createInitialFlags();
    this.controlZone = this.createInitialControlZone();
    this.zoneTickAccum = 0;
    this.mapSeed = Math.floor(Math.random() * 1_000_000_000);
    this.layout = generateMapLayout(this.settings.mapMode, this.mapSeed);
    this.navGrid = new ArenaNavGrid(this.layout);
    this.digHp = createInitialUndergroundHp(this.layout);
    this.digVersion = 1;
    this.projectiles = [];
    this.smokeZones = [];
    this.pings = [];

    const pistolStats = getEffectiveWeaponStats('pistol');
    let redIdx = 0;
    let blueIdx = 0;

    for (const actor of this.actors.values()) {
      const idx = actor.team === 'red' ? redIdx++ : blueIdx++;
      const spawn = SPAWN_POINTS[actor.team][idx % SPAWN_POINTS[actor.team].length];
      actor.x = spawn.x;
      actor.y = spawn.y;
      actor.z = spawn.z;
      actor.yaw = actor.team === 'red' ? -Math.PI / 2 : Math.PI / 2;
      actor.pitch = 0;
      actor.hp = 100;
      actor.alive = true;
      actor.respawnTimer = 0;
      actor.money = ECONOMY.STARTING_MONEY;
      actor.kills = 0;
      actor.deaths = 0;
      actor.assists = 0;
      actor.headshots = 0;
      actor.damageDealt = 0;
      actor.currentStreak = 0;
      actor.bestStreak = 0;
      actor.captures = 0;
      actor.returns = 0;
      actor.zoneScore = 0;
      actor.activeWeapon = 'pistol';
      actor.ammo = pistolStats.magSize;
      actor.maxAmmo = pistolStats.magSize;
      actor.reloading = false;
      actor.crouching = false;
      actor.lastDamagedAt = 0;
      actor.hpRegenAccum = 0;
      actor.boostUntil = 0;
      actor.stunnedUntil = 0;
      actor.devMode = false;
      actor.recentDamagers.clear();
      actor.ownedWeapons = {
        pistol: { damageLevel: 1, fireRateLevel: 1, magLevel: 1 },
      };
      actor.weaponAmmo = { pistol: pistolStats.magSize };
      actor.activeGadget = 'frag';
      actor.gadgets = {};
    }
  }

  private fillBotsToTeamSize(): void {
    const roles: Array<'offense' | 'defense' | 'flex'> = ['offense', 'flex', 'defense', 'offense'];
    const laneBiases: Array<'center' | 'north' | 'south' | 'none'> = ['north', 'center', 'south', 'none'];

    (['red', 'blue'] as TeamId[]).forEach((team) => {
      const existing = Array.from(this.actors.values()).filter((a) => a.team === team);
      const needed = this.settings.teamSize - existing.length;
      const names = team === 'red' ? BOT_NAMES_RED : BOT_NAMES_BLUE;

      for (let i = 0; i < needed; i++) {
        const botId = `bot-${team}-${this.botCounter++}`;
        const slotIdx = existing.length + i;
        const spawn = SPAWN_POINTS[team][slotIdx % SPAWN_POINTS[team].length];
        const pistolStats = getEffectiveWeaponStats('pistol');
        const initialYaw = team === 'red' ? -Math.PI / 2 : Math.PI / 2;

        const bot: InternalActor = {
          id: botId,
          name: names[slotIdx % names.length],
          isBot: true,
          team,
          ws: null,
          x: spawn.x,
          y: spawn.y,
          z: spawn.z,
          yaw: initialYaw,
          pitch: 0,
          hp: 100,
          maxHp: 100,
          alive: true,
          respawnTimer: 0,
          money: ECONOMY.STARTING_MONEY,
          kills: 0,
          deaths: 0,
          assists: 0,
          headshots: 0,
          damageDealt: 0,
          currentStreak: 0,
          bestStreak: 0,
          captures: 0,
          returns: 0,
          zoneScore: 0,
          activeWeapon: 'pistol',
          ammo: pistolStats.magSize,
          maxAmmo: pistolStats.magSize,
          reloading: false,
          crouching: false,
          ownedWeapons: {
            pistol: { damageLevel: 1, fireRateLevel: 1, magLevel: 1 },
          },
          activeGadget: 'frag',
          gadgets: {},
          lastShotAt: 0,
          lastDigAt: 0,
          lastGadgetAt: 0,
          lastPingAt: 0,
          lastChatAt: 0,
          lastDamagedAt: 0,
          hpRegenAccum: 0,
          boostUntil: 0,
          stunnedUntil: 0,
          reloadFinishAt: 0,
          devMode: false,
          weaponAmmo: { pistol: pistolStats.magSize },
          recentDamagers: new Map(),
          vy: 0,
          aiGoalX: spawn.x,
          aiGoalZ: spawn.z,
          aiPath: [],
          aiRepathAt: 0,
          aiRole: roles[slotIdx % roles.length],
          aiLaneBias: laneBiases[slotIdx % laneBiases.length],
          aiStrafeDir: Math.random() > 0.5 ? 1 : -1,
          aiStrafeFlipAt: Date.now() + 1500,
          aiNextShopAt: Date.now() + 8000,
          aiTargetId: null,
          aiTargetSeenAt: 0,
          aiAimYaw: initialYaw,
          aiAimPitch: 0,
          aiAimNoiseYaw: 0,
          aiAimNoisePitch: 0,
          aiNextNoiseAt: 0,
          aiBurstShotsLeft: 4,
          aiBurstCooldownUntil: 0,
        };
        this.actors.set(botId, bot);
      }
    });
  }

  private getSpawnPoint(team: TeamId): { x: number; y: number; z: number } {
    const teamActors = Array.from(this.actors.values()).filter((a) => a.team === team);
    const list = SPAWN_POINTS[team];
    return list[teamActors.length % list.length];
  }

  public setPaused(playerId: string, paused: boolean): void {
    if (this.phase !== 'playing' || !this.actors.has(playerId)) return;
    // Only freeze simulation in solo (single human) games
    if (this.getHumanCount() > 1) {
      this.paused = false;
      return;
    }
    this.paused = paused;
    this.lastTickMs = Date.now();
    this.broadcastStateSync();
  }

  private startLoop(): void {
    if (this.tickTimer) return;
    this.lastTickMs = Date.now();
    this.tickTimer = setInterval(() => this.tick(), 50); // 20Hz authoritative server tick
  }

  public stopLoop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private tick(): void {
    if (this.phase !== 'playing') return;
    if (this.paused) {
      this.lastTickMs = Date.now();
      return;
    }
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTickMs) / 1000);
    this.lastTickMs = now;

    // Match clock
    if (!this.overtime) {
      this.timeRemaining = Math.max(0, this.timeRemaining - dt);
      if (this.timeRemaining <= 0) {
        if (this.redScore !== this.blueScore) {
          this.finishMatch(this.redScore > this.blueScore ? 'red' : 'blue');
          return;
        } else {
          this.overtime = true;
          this.timeRemaining = 60; // 60s sudden-death overtime
        }
      }
    } else {
      this.timeRemaining = Math.max(0, this.timeRemaining - dt);
      if (this.timeRemaining <= 0) {
        // Tie-breaker by total kills if overtime also expires
        const redKills = this.getTeamKills('red');
        const blueKills = this.getTeamKills('blue');
        const winner: TeamId | 'draw' =
          redKills === blueKills ? 'draw' : redKills > blueKills ? 'red' : 'blue';
        this.finishMatch(winner);
        return;
      }
    }

    // Update reloads, respawns, and AI bots
    for (const actor of this.actors.values()) {
      if (!actor.alive) {
        actor.respawnTimer -= dt;
        if (actor.respawnTimer <= 0) {
          this.respawnActor(actor);
        }
        continue;
      }

      if (actor.reloading && now >= actor.reloadFinishAt) {
        const stats = getEffectiveWeaponStats(actor.activeWeapon, actor.ownedWeapons[actor.activeWeapon]);
        if (!stats.isMelee) {
          actor.ammo = stats.magSize;
          actor.maxAmmo = stats.magSize;
          actor.weaponAmmo[actor.activeWeapon] = stats.magSize;
        }
        actor.reloading = false;
      }

      // Natural health regeneration after 4.5s out of combat (10 HP/s)
      if (actor.hp < actor.maxHp && now - actor.lastDamagedAt >= 4500) {
        actor.hpRegenAccum += 10 * dt;
        if (actor.hpRegenAccum >= 1) {
          const heal = Math.floor(actor.hpRegenAccum);
          actor.hpRegenAccum -= heal;
          actor.hp = Math.min(actor.maxHp, actor.hp + heal);
          if (actor.hp >= actor.maxHp) actor.hpRegenAccum = 0;
        }
      } else {
        actor.hpRegenAccum = 0;
      }

      if (actor.isBot) {
        this.updateBot(actor, dt, now);
      }
    }

    // Update projectiles, smoke clouds, and tactical pings
    this.updateProjectiles(dt, now);
    this.updateSmokeZones(dt);
    this.updatePings(now);

    // Update mode-specific objective state machine
    if (this.settings.gameMode === 'ctf') {
      this.updateFlags(dt);
    } else if (this.settings.gameMode === 'dom') {
      this.updateControlZone(dt);
    }

    // Broadcast authoritative team-scoped state snapshot
    this.broadcastStateSync();
  }

  private getTeamKills(team: TeamId): number {
    let total = 0;
    for (const a of this.actors.values()) {
      if (a.team === team) total += a.kills;
    }
    return total;
  }

  private respawnActor(actor: InternalActor): void {
    const spawn = this.getSpawnPoint(actor.team);
    actor.x = spawn.x + (Math.random() - 0.5) * 1.4;
    actor.y = spawn.y;
    actor.z = spawn.z + (Math.random() - 0.5) * 1.4;
    actor.vy = 0;
    actor.hp = actor.maxHp;
    actor.alive = true;
    actor.respawnTimer = 0;
    actor.reloading = false;
    actor.lastDamagedAt = 0;
    actor.hpRegenAccum = 0;
    actor.boostUntil = 0;
    actor.stunnedUntil = 0;
    for (const wid of WEAPON_ORDER) {
      if (actor.ownedWeapons[wid]) {
        const wStats = getEffectiveWeaponStats(wid, actor.ownedWeapons[wid]);
        actor.weaponAmmo[wid] = wStats.magSize;
      }
    }
    const stats = getEffectiveWeaponStats(actor.activeWeapon, actor.ownedWeapons[actor.activeWeapon]);
    actor.ammo = stats.magSize;
    actor.maxAmmo = stats.magSize;
  }

  private updateFlags(dt: number): void {
    for (const flagTeam of ['red', 'blue'] as TeamId[]) {
      const flag = this.flags[flagTeam];
      const enemyTeam: TeamId = flagTeam === 'red' ? 'blue' : 'red';

      if (flag.status === 'carried') {
        const carrier = flag.carrierId ? this.actors.get(flag.carrierId) : null;
        if (!carrier || !carrier.alive) {
          this.dropFlag(flagTeam, carrier ?? undefined);
          continue;
        }
        flag.x = carrier.x;
        flag.y = carrier.y + 1.05;
        flag.z = carrier.z;

        // Check capture at carrier's home base pedestal
        const homeBase = FLAG_BASES[carrier.team];
        const homeFlag = this.flags[carrier.team];
        const distHome = Math.hypot(carrier.x - homeBase.x, carrier.z - homeBase.z);

        if (distHome <= 2.6 && homeFlag.status === 'base') {
          // Flag Captured!
          if (carrier.team === 'red') this.redScore += 1;
          else this.blueScore += 1;

          carrier.captures += 1;
          carrier.money += ECONOMY.FLAG_CAPTURE_REWARD;
          for (const mate of this.actors.values()) {
            if (mate.team === carrier.team && mate.id !== carrier.id) {
              mate.money += ECONOMY.FLAG_CAPTURE_TEAM_REWARD;
            }
          }

          // Reset captured flag back to its base
          flag.status = 'base';
          flag.carrierId = null;
          flag.x = FLAG_BASES[flagTeam].x;
          flag.y = FLAG_BASES[flagTeam].y;
          flag.z = FLAG_BASES[flagTeam].z;
          flag.autoReturnTimer = 0;
          this.pings = this.pings.filter((p) => !(p.kind === 'carrier' && p.targetActorId === carrier.id));

          this.broadcastFeed({
            id: `ev-${eventSeq++}`,
            timestamp: Date.now(),
            type: 'capture',
            actorName: carrier.name,
            actorTeam: carrier.team,
            targetTeam: flagTeam,
          });

          if (
            this.overtime ||
            this.redScore >= this.settings.scoreLimit ||
            this.blueScore >= this.settings.scoreLimit
          ) {
            this.finishMatch(this.redScore > this.blueScore ? 'red' : 'blue');
            return;
          }
        }
      } else if (flag.status === 'dropped') {
        flag.autoReturnTimer -= dt;
        if (flag.autoReturnTimer <= 0) {
          flag.status = 'base';
          flag.carrierId = null;
          flag.x = FLAG_BASES[flagTeam].x;
          flag.y = FLAG_BASES[flagTeam].y;
          flag.z = FLAG_BASES[flagTeam].z;
          flag.autoReturnTimer = 0;
          this.broadcastFeed({
            id: `ev-${eventSeq++}`,
            timestamp: Date.now(),
            type: 'return',
            actorName: '自動防禦系統',
            actorTeam: flagTeam,
            targetTeam: flagTeam,
          });
          continue;
        }

        // Check nearby actors for pickup (enemy) or instant return (friendly)
        for (const actor of this.actors.values()) {
          if (!actor.alive) continue;
          const dist = Math.hypot(actor.x - flag.x, actor.z - flag.z);
          if (dist <= 2.3 && Math.abs(actor.y - flag.y) < 2.2) {
            if (actor.team === flagTeam) {
              // Friendly return
              flag.status = 'base';
              flag.carrierId = null;
              flag.x = FLAG_BASES[flagTeam].x;
              flag.y = FLAG_BASES[flagTeam].y;
              flag.z = FLAG_BASES[flagTeam].z;
              flag.autoReturnTimer = 0;
              actor.returns += 1;
              actor.money += ECONOMY.FLAG_RETURN_REWARD;
              this.broadcastFeed({
                id: `ev-${eventSeq++}`,
                timestamp: Date.now(),
                type: 'return',
                actorName: actor.name,
                actorTeam: actor.team,
                targetTeam: flagTeam,
              });
              break;
            } else {
              // Enemy pickup dropped flag
              flag.status = 'carried';
              flag.carrierId = actor.id;
              flag.autoReturnTimer = 0;
              this.broadcastFeed({
                id: `ev-${eventSeq++}`,
                timestamp: Date.now(),
                type: 'pickup',
                actorName: actor.name,
                actorTeam: actor.team,
                targetTeam: flagTeam,
              });
              break;
            }
          }
        }
      } else {
        // Flag is at base -> check enemy pickup
        for (const actor of this.actors.values()) {
          if (!actor.alive || actor.team !== enemyTeam) continue;
          const dist = Math.hypot(actor.x - flag.x, actor.z - flag.z);
          if (dist <= 2.4 && Math.abs(actor.y - flag.y) < 2.2) {
            flag.status = 'carried';
            flag.carrierId = actor.id;
            actor.money += ECONOMY.FLAG_PICKUP_REWARD;
            this.broadcastFeed({
              id: `ev-${eventSeq++}`,
              timestamp: Date.now(),
              type: 'pickup',
              actorName: actor.name,
              actorTeam: actor.team,
              targetTeam: flagTeam,
            });
            break;
          }
        }
      }
    }
  }

  private dropFlag(flagTeam: TeamId, carrier?: InternalActor): void {
    const flag = this.flags[flagTeam];
    if (flag.status !== 'carried') return;
    const fx = carrier ? carrier.x : flag.x;
    const fz = carrier ? carrier.z : flag.z;
    const fy = getGroundHeightAt(fx, fz, carrier ? carrier.y : flag.y, this.layout);
    flag.status = 'dropped';
    flag.carrierId = null;
    flag.x = fx;
    flag.y = fy;
    flag.z = fz;
    flag.autoReturnTimer = 20;

    if (carrier) {
      this.broadcastFeed({
        id: `ev-${eventSeq++}`,
        timestamp: Date.now(),
        type: 'drop',
        actorName: carrier.name,
        actorTeam: carrier.team,
        targetTeam: flagTeam,
      });
    }
  }

  private finishMatch(winner: TeamId | 'draw'): void {
    this.phase = 'ended';
    this.winnerTeam = winner;
    this.stopLoop();

    if (winner !== 'draw') {
      for (const actor of this.actors.values()) {
        if (actor.team === winner) {
          actor.money += ECONOMY.VICTORY_TEAM_BONUS;
        }
      }
    }

    const summary: MatchEndSummary = {
      winnerTeam: winner,
      gameMode: this.settings.gameMode,
      scoreLimit: this.settings.scoreLimit,
      redScore: this.redScore,
      blueScore: this.blueScore,
      victoryBonus: ECONOMY.VICTORY_TEAM_BONUS,
      actors: Array.from(this.actors.values()).map((a) => this.toSnapshot(a)),
    };

    this.broadcast({ type: 'match:ended', payload: summary });
    this.broadcastLobbyInfo();
  }

  private updateControlZone(dt: number): void {
    const cz = this.controlZone;
    const redInside: InternalActor[] = [];
    const blueInside: InternalActor[] = [];

    for (const actor of this.actors.values()) {
      if (!actor.alive) continue;
      const dist = Math.hypot(actor.x - cz.x, actor.z - cz.z);
      if (dist <= cz.radius) {
        if (actor.team === 'red') redInside.push(actor);
        else blueInside.push(actor);
      }
    }

    cz.contested = redInside.length > 0 && blueInside.length > 0;

    if (!cz.contested) {
      const activeTeam: TeamId | null =
        redInside.length > 0 ? 'red' : blueInside.length > 0 ? 'blue' : null;
      const count = activeTeam === 'red' ? redInside.length : activeTeam === 'blue' ? blueInside.length : 0;

      if (activeTeam) {
        const capSpeed = 0.25 + Math.min(2, count - 1) * 0.085;
        if (cz.owner === activeTeam) {
          cz.captureTeam = activeTeam;
          cz.progress = 1;
        } else if (cz.owner !== 'neutral') {
          // Neutralizing enemy-owned point
          cz.captureTeam = activeTeam;
          cz.progress = Math.max(0, cz.progress - capSpeed * dt);
          if (cz.progress <= 0) {
            cz.owner = 'neutral';
            cz.progress = 0;
          }
        } else {
          // Capturing neutral point
          if (cz.captureTeam !== activeTeam && cz.progress > 0) {
            cz.progress = Math.max(0, cz.progress - capSpeed * dt);
            if (cz.progress <= 0) {
              cz.captureTeam = activeTeam;
            }
          } else {
            cz.captureTeam = activeTeam;
            cz.progress = Math.min(1, cz.progress + capSpeed * dt);
            if (cz.progress >= 1) {
              cz.owner = activeTeam;
              const insideList = activeTeam === 'red' ? redInside : blueInside;
              const capturer = insideList[0];
              for (const ally of insideList) {
                ally.money += ECONOMY.ZONE_CAPTURE_REWARD;
                ally.captures += 1;
              }
              this.broadcastFeed({
                id: `ev-${eventSeq++}`,
                timestamp: Date.now(),
                type: 'zone_capture',
                actorName: capturer?.name ?? (activeTeam === 'red' ? '紅隊' : '藍隊'),
                actorTeam: activeTeam,
                targetTeam: activeTeam,
              });
            }
          }
        }
      } else if (cz.owner === 'neutral' && cz.progress > 0) {
        cz.progress = Math.max(0, cz.progress - 0.1 * dt);
        if (cz.progress <= 0) {
          cz.captureTeam = 'neutral';
        }
      }
    }

    if (cz.owner !== 'neutral') {
      this.zoneTickAccum += dt * 1.45;
      if (this.zoneTickAccum >= 1) {
        const pts = Math.floor(this.zoneTickAccum);
        this.zoneTickAccum -= pts;
        if (cz.owner === 'red') this.redScore += pts;
        else this.blueScore += pts;

        const defenders = cz.owner === 'red' ? redInside : blueInside;
        for (const ally of defenders) {
          ally.zoneScore += pts;
          ally.money += ECONOMY.ZONE_TICK_REWARD * pts;
        }

        if (
          (this.overtime && this.redScore !== this.blueScore) ||
          this.redScore >= this.settings.scoreLimit ||
          this.blueScore >= this.settings.scoreLimit
        ) {
          this.finishMatch(this.redScore > this.blueScore ? 'red' : 'blue');
        }
      }
    }
  }

  // Client Input Handlers
  public handlePlayerState(
    playerId: string,
    data: { x: number; y: number; z: number; yaw: number; pitch: number; crouching?: boolean },
  ): void {
    const actor = this.actors.get(playerId);
    if (!actor || !actor.alive || this.phase !== 'playing' || this.paused) return;

    const clampedY = Math.max(0, Math.min(8, data.y));
    const resolved = resolveHorizontalCollision(data.x, clampedY, data.z, 0.45, this.layout, this.digHp);
    actor.x = resolved.x;
    actor.y = clampedY;
    actor.z = resolved.z;
    actor.yaw = data.yaw;
    actor.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, data.pitch));
    actor.crouching = Boolean(data.crouching);
  }

  public handlePlayerDig(
    playerId: string,
    data: { origin?: Vec3; dir?: Vec3 },
  ): void {
    const actor = this.actors.get(playerId);
    if (!actor || !actor.alive || this.phase !== 'playing' || this.paused) return;
    if (this.layout.mode !== 'underground') return;

    const now = Date.now();
    if (now - actor.lastDigAt < 180) return;
    actor.lastDigAt = now;

    const eyeOffset = actor.crouching ? 0.98 : 1.55;
    const ox = data.origin && Math.hypot(data.origin.x - actor.x, data.origin.z - actor.z) < 2.0 ? data.origin.x : actor.x;
    const oy = data.origin ? Math.max(0.4, Math.min(3.4, data.origin.y)) : actor.y + eyeOffset;
    const oz = data.origin && Math.hypot(data.origin.x - actor.x, data.origin.z - actor.z) < 2.0 ? data.origin.z : actor.z;

    const dx = data.dir?.x ?? -Math.sin(actor.yaw);
    const dy = data.dir?.y ?? Math.sin(actor.pitch);
    const dz = data.dir?.z ?? -Math.cos(actor.yaw);
    const len = Math.hypot(dx, dy, dz) || 1;

    const hit = raycastDigGrid(ox, oy, oz, dx / len, dy / len, dz / len, 4.2, this.digHp);
    if (hit) {
      this.damageDigCell(hit.index, 2, actor.team);
    }
  }

  private damageDigCell(index: number, dmg: number, byTeam?: TeamId): void {
    if (index < 0 || index >= this.digHp.length) return;
    const cur = this.digHp[index];
    if (cur <= 0) return;
    const next = Math.max(0, cur - dmg);
    this.digHp[index] = next;
    this.digVersion += 1;

    const bounds = getUndergroundCellBounds(index);
    const payload: DigUpdateEvent = {
      index,
      hp: next,
      digVersion: this.digVersion,
      x: (bounds.minX + bounds.maxX) * 0.5,
      z: (bounds.minZ + bounds.maxZ) * 0.5,
      byTeam,
    };
    this.broadcast({ type: 'dig:update', payload });
  }

  public handlePlayerShoot(
    playerId: string,
    data: {
      origin: { x: number; y: number; z: number };
      dir: { x: number; y: number; z: number };
      aiming?: boolean;
    },
  ): void {
    const actor = this.actors.get(playerId);
    if (!actor || !actor.alive || this.phase !== 'playing' || this.paused) return;

    const now = Date.now();
    const stats = getEffectiveWeaponStats(actor.activeWeapon, actor.ownedWeapons[actor.activeWeapon]);

    if (!stats.isMelee) {
      if (actor.reloading) return;
      if (actor.ammo <= 0) {
        this.startReload(actor, now);
        return;
      }
    }
    const rateMult = now < actor.boostUntil ? 0.72 : 0.85;
    if (now - actor.lastShotAt < stats.fireInterval * 1000 * rateMult) return;

    actor.lastShotAt = now;
    if (!stats.isMelee) {
      actor.ammo -= 1;
      actor.weaponAmmo[actor.activeWeapon] = actor.ammo;
    }

    // Validate origin close to actor eye and outside any wall collider
    const eyeOffset = actor.crouching ? 0.98 : 1.55;
    const eyeX = actor.x;
    const eyeY = actor.y + eyeOffset;
    const eyeZ = actor.z;
    const originDist = Math.hypot(data.origin.x - eyeX, data.origin.y - eyeY, data.origin.z - eyeZ);
    const rawOx = originDist < 2.2 ? data.origin.x : eyeX;
    const oy = originDist < 2.2 ? data.origin.y : eyeY;
    const rawOz = originDist < 2.2 ? data.origin.z : eyeZ;
    const safeOrigin = resolveHorizontalCollision(rawOx, Math.max(0, oy - eyeOffset), rawOz, 0.38, this.layout, this.digHp);
    const ox = safeOrigin.x;
    const oz = safeOrigin.z;

    // Normalize dir
    const len = Math.hypot(data.dir.x, data.dir.y, data.dir.z) || 1;
    const baseDx = data.dir.x / len;
    const baseDy = data.dir.y / len;
    const baseDz = data.dir.z / len;

    const adsMult = data.aiming ? 0.42 : 1.0;
    const effectiveStats = adsMult < 1 ? { ...stats, spread: stats.spread * adsMult } : stats;
    this.executeWeaponFire(actor, ox, oy, oz, baseDx, baseDy, baseDz, effectiveStats, now);

    if (!stats.isMelee && actor.ammo <= 0) {
      this.startReload(actor, now);
    }
  }

  private applyDamage(
    target: InternalActor,
    amount: number,
    now: number,
    attacker?: InternalActor,
    sourcePos?: Vec3,
    headshot = false,
  ): boolean {
    if (target.devMode) return false;
    target.lastDamagedAt = now;
    target.hpRegenAccum = 0;
    target.hp = Math.max(0, target.hp - amount);

    if (attacker && attacker.id !== target.id && attacker.team !== target.team) {
      attacker.damageDealt += amount;
      target.recentDamagers.set(attacker.id, now);
    }

    if (sourcePos && !target.isBot) {
      const hitDir: DamageIndicatorEvent = {
        sourcePos,
        damage: amount,
        headshot,
        timestamp: now,
      };
      this.sendTo(target.id, { type: 'combat:hitdir', payload: hitDir });
    }

    return target.hp <= 0;
  }

  private executeWeaponFire(
    shooter: InternalActor,
    ox: number,
    oy: number,
    oz: number,
    baseDx: number,
    baseDy: number,
    baseDz: number,
    stats: ReturnType<typeof getEffectiveWeaponStats>,
    now: number,
  ): void {
    const shooterOrigin: Vec3 = { x: shooter.x, y: shooter.y + 1.2, z: shooter.z };

    // Melee Sword Slash Cleave
    if (stats.isMelee) {
      const hitTargets: Array<{ target: InternalActor; dist: number; headshot: boolean }> = [];
      for (const target of this.actors.values()) {
        if (!target.alive || target.team === shooter.team) continue;
        const tx = target.x - ox;
        const ty = target.y + (target.crouching ? 0.85 : 1.15) - oy;
        const tz = target.z - oz;
        const dist = Math.hypot(tx, ty, tz);
        if (dist > stats.range + 0.55) continue;

        if (dist > 0.25) {
          const dot = (tx * baseDx + ty * baseDy + tz * baseDz) / dist;
          if (dot < 0.32) continue;
          const obsDist = rayIntersectsArenaObstacle(
            ox,
            oy,
            oz,
            tx / dist,
            ty / dist,
            tz / dist,
            dist,
            this.layout,
            this.digHp,
          );
          if (obsDist < dist - 0.35) continue;
        }
        const headshot = baseDy > 0.06 && dist <= stats.range + 0.35;
        hitTargets.push({ target, dist, headshot });
      }

      if (hitTargets.length === 0) {
        if (this.layout.mode === 'underground' && !shooter.isBot) {
          const digHit = raycastDigGrid(ox, oy, oz, baseDx, baseDy, baseDz, stats.range + 0.4, this.digHp);
          if (digHit) {
            this.damageDigCell(digHit.index, stats.id === 'greatsword' ? 2 : 1, shooter.team);
          }
        }
        const endDist = Math.min(
          stats.range,
          rayIntersectsArenaObstacle(ox, oy, oz, baseDx, baseDy, baseDz, stats.range, this.layout, this.digHp),
        );
        const slashEv: TracerEvent = {
          shooterId: shooter.id,
          team: shooter.team,
          weaponId: shooter.activeWeapon,
          from: { x: ox, y: oy - 0.1, z: oz },
          to: { x: ox + baseDx * endDist, y: oy + baseDy * endDist, z: oz + baseDz * endDist },
          isMelee: true,
        };
        this.broadcast({ type: 'combat:tracer', payload: slashEv });
        return;
      }

      let healedTotal = 0;
      for (const h of hitTargets) {
        const rawDmg = h.headshot ? Math.round(stats.damage * 1.25) : stats.damage;
        const dmg = h.target.devMode ? 0 : rawDmg;
        const killed =
          dmg > 0 ? this.applyDamage(h.target, dmg, now, shooter, shooterOrigin, h.headshot) : false;
        if (stats.healOnHit && healedTotal === 0) {
          healedTotal = stats.healOnHit;
          shooter.hp = Math.min(shooter.maxHp, shooter.hp + stats.healOnHit);
        }
        const streakCount = killed ? this.handleKill(shooter, h.target, h.headshot) : undefined;
        const slashEv: TracerEvent = {
          shooterId: shooter.id,
          team: shooter.team,
          weaponId: shooter.activeWeapon,
          from: { x: ox, y: oy - 0.1, z: oz },
          to: {
            x: h.target.x,
            y: h.target.y + (h.target.crouching ? 0.95 : 1.35),
            z: h.target.z,
          },
          hitActorId: h.target.id,
          headshot: h.headshot,
          damage: dmg || undefined,
          killed: killed || undefined,
          isMelee: true,
          streakCount,
        };
        this.broadcast({ type: 'combat:tracer', payload: slashEv });
      }
      return;
    }

    for (let p = 0; p < stats.pellets; p++) {
      const spreadX = (Math.random() - 0.5) * stats.spread;
      const spreadY = (Math.random() - 0.5) * stats.spread;
      const spreadZ = (Math.random() - 0.5) * stats.spread;
      const dx = baseDx + spreadX;
      const dy = baseDy + spreadY;
      const dz = baseDz + spreadZ;
      const dLen = Math.hypot(dx, dy, dz) || 1;
      const ndx = dx / dLen;
      const ndy = dy / dLen;
      const ndz = dz / dLen;

      const wallDist = rayIntersectsArenaObstacle(ox, oy, oz, ndx, ndy, ndz, stats.range, this.layout, this.digHp);
      let bestDist = wallDist;
      let hitTarget: InternalActor | null = null;
      let isHeadshot = false;

      for (const target of this.actors.values()) {
        if (!target.alive || target.team === shooter.team) continue;

        const crouched = Boolean(target.crouching);
        // Head hitbox check (lowers when crouching)
        const headBox = {
          minX: target.x - 0.3,
          maxX: target.x + 0.3,
          minY: target.y + (crouched ? 0.85 : 1.38),
          maxY: target.y + (crouched ? 1.32 : 1.88),
          minZ: target.z - 0.3,
          maxZ: target.z + 0.3,
        };
        const tHead = rayIntersectsAABB(ox, oy, oz, ndx, ndy, ndz, headBox, bestDist);
        if (tHead !== null && tHead < bestDist) {
          bestDist = tHead;
          hitTarget = target;
          isHeadshot = true;
          continue;
        }

        // Body hitbox check
        const bodyBox = {
          minX: target.x - 0.5,
          maxX: target.x + 0.5,
          minY: target.y,
          maxY: target.y + (crouched ? 0.92 : 1.42),
          minZ: target.z - 0.5,
          maxZ: target.z + 0.5,
        };
        const tBody = rayIntersectsAABB(ox, oy, oz, ndx, ndy, ndz, bodyBox, bestDist);
        if (tBody !== null && tBody < bestDist) {
          bestDist = tBody;
          hitTarget = target;
          isHeadshot = false;
        }
      }

      let dmg = 0;
      let killed = false;
      if (hitTarget) {
        dmg = hitTarget.devMode ? 0 : isHeadshot ? Math.round(stats.damage * 1.5) : stats.damage;
        killed =
          dmg > 0 ? this.applyDamage(hitTarget, dmg, now, shooter, shooterOrigin, isHeadshot) : false;
        if (!killed && !hitTarget.devMode && stats.slowOnHitSec) {
          hitTarget.stunnedUntil = Math.max(hitTarget.stunnedUntil, now + stats.slowOnHitSec * 1000);
        }
      } else if (this.layout.mode === 'underground' && !shooter.isBot) {
        // Bullets hitting soil blocks carve tunnels too!
        const digHit = raycastDigGrid(ox, oy, oz, ndx, ndy, ndz, wallDist + 0.08, this.digHp);
        if (digHit && digHit.dist <= wallDist + 0.05) {
          this.damageDigCell(digHit.index, stats.damage >= 35 ? 2 : 1, shooter.team);
        }
      }

      const endX = ox + ndx * bestDist;
      const endY = oy + ndy * bestDist;
      const endZ = oz + ndz * bestDist;

      const streakCount =
        hitTarget && killed ? this.handleKill(shooter, hitTarget, isHeadshot) : undefined;

      const tracer: TracerEvent = {
        shooterId: shooter.id,
        team: shooter.team,
        weaponId: shooter.activeWeapon,
        from: { x: ox, y: oy - 0.08, z: oz },
        to: { x: endX, y: endY, z: endZ },
        hitActorId: hitTarget?.id,
        headshot: isHeadshot,
        damage: dmg || undefined,
        killed: killed || undefined,
        streakCount,
      };
      this.broadcast({ type: 'combat:tracer', payload: tracer });

      // Explosive Autocannon Splash Damage + Soil Blast
      if (stats.splashRadius && stats.splashRadius > 0) {
        if (this.layout.mode === 'underground') {
          const { cols, rows, cellSize, originX, originZ } = UNDERGROUND_GRID;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const idx = r * cols + c;
              if (this.digHp[idx] <= 0) continue;
              const cx = originX + (c + 0.5) * cellSize;
              const cz = originZ + (r + 0.5) * cellSize;
              if (Math.hypot(cx - endX, cz - endZ) <= 1.95) {
                this.damageDigCell(idx, 2, shooter.team);
              }
            }
          }
        }
        const splashPos: Vec3 = { x: endX, y: endY, z: endZ };
        for (const other of this.actors.values()) {
          if (!other.alive || other.team === shooter.team || other.id === hitTarget?.id) continue;
          const dist = Math.hypot(other.x - endX, other.y + 1.0 - endY, other.z - endZ);
          if (dist > stats.splashRadius) continue;
          const falloff = Math.max(0.25, 1 - dist / (stats.splashRadius + 0.6));
          const splashDmg = Math.round(stats.damage * 0.62 * falloff);
          if (splashDmg <= 0) continue;
          const splashKilled = this.applyDamage(other, splashDmg, now, shooter, splashPos, false);
          if (splashKilled) {
            this.handleKill(shooter, other, false);
          }
        }
      }
    }
  }

  private handleKill(
    killer: InternalActor,
    victim: InternalActor,
    headshot: boolean,
    gadgetId?: GadgetId,
  ): number {
    if (!victim.alive) return killer.currentStreak;
    victim.alive = false;
    victim.respawnTimer = 3.5;
    victim.deaths += 1;
    victim.currentStreak = 0;

    const wasCarrier =
      this.settings.gameMode === 'ctf' &&
      (this.flags.red.carrierId === victim.id || this.flags.blue.carrierId === victim.id);

    if (this.flags.red.carrierId === victim.id) this.dropFlag('red', victim);
    if (this.flags.blue.carrierId === victim.id) this.dropFlag('blue', victim);
    this.pings = this.pings.filter((p) => p.targetActorId !== victim.id);

    const now = Date.now();
    if (killer.id !== victim.id && killer.team !== victim.team) {
      killer.kills += 1;
      if (headshot) killer.headshots += 1;
      killer.currentStreak += 1;
      if (killer.currentStreak > killer.bestStreak) {
        killer.bestStreak = killer.currentStreak;
      }

      let reward = ECONOMY.KILL_REWARD;
      if (headshot) reward += ECONOMY.HEADSHOT_BONUS;
      if (wasCarrier) reward += ECONOMY.FLAG_CARRIER_KILL_BONUS;
      killer.money += reward;

      // Award assists to teammates who damaged victim in the last 8s
      for (const [damagerId, damagedAt] of victim.recentDamagers.entries()) {
        if (damagerId === killer.id || now - damagedAt > 8000) continue;
        const assister = this.actors.get(damagerId);
        if (assister && assister.team === killer.team) {
          assister.assists += 1;
          assister.money += ECONOMY.ASSIST_REWARD;
        }
      }
    }
    victim.recentDamagers.clear();

    this.broadcastFeed({
      id: `ev-${eventSeq++}`,
      timestamp: now,
      type: 'kill',
      actorName: killer.name,
      actorTeam: killer.team,
      targetName: victim.name,
      targetTeam: victim.team,
      weaponId: gadgetId ? undefined : killer.activeWeapon,
      gadgetId,
      headshot,
    });

    if (this.settings.gameMode === 'tdm' && killer.id !== victim.id && killer.team !== victim.team) {
      if (killer.team === 'red') this.redScore += 1;
      else this.blueScore += 1;

      if (
        (this.overtime && this.redScore !== this.blueScore) ||
        this.redScore >= this.settings.scoreLimit ||
        this.blueScore >= this.settings.scoreLimit
      ) {
        this.finishMatch(this.redScore > this.blueScore ? 'red' : 'blue');
      }
    }

    return killer.currentStreak;
  }

  public handleReload(playerId: string): void {
    const actor = this.actors.get(playerId);
    if (!actor || !actor.alive || actor.reloading) return;
    const stats = getEffectiveWeaponStats(actor.activeWeapon, actor.ownedWeapons[actor.activeWeapon]);
    if (stats.isMelee || actor.ammo >= stats.magSize) return;
    this.startReload(actor, Date.now());
  }

  private startReload(actor: InternalActor, now: number): void {
    const stats = getEffectiveWeaponStats(actor.activeWeapon, actor.ownedWeapons[actor.activeWeapon]);
    if (stats.isMelee) return;
    actor.reloading = true;
    actor.reloadFinishAt = now + stats.reloadTime * 1000;
  }

  public handleSwitchWeapon(playerId: string, weaponId: WeaponId): void {
    const actor = this.actors.get(playerId);
    if (!actor || !actor.ownedWeapons[weaponId]) return;
    if (actor.activeWeapon === weaponId) return;

    const prevStats = getEffectiveWeaponStats(actor.activeWeapon, actor.ownedWeapons[actor.activeWeapon]);
    if (!prevStats.isMelee) {
      actor.weaponAmmo[actor.activeWeapon] = Math.max(0, Math.min(prevStats.magSize, actor.ammo));
    }

    actor.activeWeapon = weaponId;
    actor.reloading = false;
    const stats = getEffectiveWeaponStats(weaponId, actor.ownedWeapons[weaponId]);
    if (stats.isMelee) {
      actor.ammo = 0;
      actor.maxAmmo = 0;
    } else {
      const savedAmmo = actor.weaponAmmo[weaponId];
      const nextAmmo =
        typeof savedAmmo === 'number' ? Math.max(0, Math.min(stats.magSize, savedAmmo)) : stats.magSize;
      actor.ammo = nextAmmo;
      actor.maxAmmo = stats.magSize;
      actor.weaponAmmo[weaponId] = nextAmmo;
    }
  }

  public handleToggleDevMode(playerId: string): void {
    const actor = this.actors.get(playerId);
    if (!actor || actor.isBot || this.phase !== 'playing') return;

    actor.devMode = !actor.devMode;
    if (actor.devMode) {
      actor.hp = actor.maxHp;
      actor.lastDamagedAt = 0;
      actor.hpRegenAccum = 0;
      actor.stunnedUntil = 0;

      for (const wid of WEAPON_ORDER) {
        if (!actor.ownedWeapons[wid]) {
          actor.ownedWeapons[wid] = { damageLevel: 1, fireRateLevel: 1, magLevel: 1 };
          const stats = getEffectiveWeaponStats(wid, actor.ownedWeapons[wid]);
          actor.weaponAmmo[wid] = stats.magSize;
        }
      }
    }
  }

  public handleBuyWeapon(playerId: string, weaponId: WeaponId): { ok: boolean; error?: string } {
    const actor = this.actors.get(playerId);
    if (!actor) return { ok: false, error: '找不到玩家' };
    const spec = WEAPONS[weaponId];
    if (!spec) return { ok: false, error: '無效武器' };

    if (actor.ownedWeapons[weaponId]) {
      this.handleSwitchWeapon(playerId, weaponId);
      return { ok: true };
    }

    if (actor.money < spec.cost) {
      return { ok: false, error: '金錢不足' };
    }

    actor.money -= spec.cost;
    actor.ownedWeapons[weaponId] = { damageLevel: 1, fireRateLevel: 1, magLevel: 1 };
    const stats = getEffectiveWeaponStats(weaponId, actor.ownedWeapons[weaponId]);
    actor.weaponAmmo[weaponId] = stats.magSize;
    this.handleSwitchWeapon(playerId, weaponId);
    return { ok: true };
  }

  public handleUpgradeWeapon(
    playerId: string,
    weaponId: WeaponId,
    stat: UpgradeStat,
  ): { ok: boolean; error?: string } {
    const actor = this.actors.get(playerId);
    if (!actor) return { ok: false, error: '找不到玩家' };
    const upg = actor.ownedWeapons[weaponId];
    if (!upg) return { ok: false, error: '尚未解鎖此武器' };

    const key =
      stat === 'damage' ? 'damageLevel' : stat === 'fireRate' ? 'fireRateLevel' : 'magLevel';
    const currentLv = upg[key];
    if (currentLv >= MAX_UPGRADE_LEVEL) {
      return { ok: false, error: '已達最高等級' };
    }

    const cost = UPGRADE_COSTS[currentLv];
    if (actor.money < cost) {
      return { ok: false, error: '金錢不足' };
    }

    actor.money -= cost;
    upg[key] = currentLv + 1;

    const stats = getEffectiveWeaponStats(weaponId, upg);
    if (actor.activeWeapon === weaponId) {
      actor.maxAmmo = stats.magSize;
      actor.ammo = stats.isMelee ? 0 : Math.min(stats.magSize, actor.ammo + (stat === 'mag' ? 4 : 0));
      actor.weaponAmmo[weaponId] = actor.ammo;
    } else if (!stats.isMelee) {
      const prev = actor.weaponAmmo[weaponId] ?? stats.magSize;
      actor.weaponAmmo[weaponId] = Math.min(stats.magSize, prev + (stat === 'mag' ? 4 : 0));
    }

    return { ok: true };
  }

  public handleBuyGadget(playerId: string, gadgetId: GadgetId): { ok: boolean; error?: string } {
    const actor = this.actors.get(playerId);
    if (!actor) return { ok: false, error: '找不到玩家' };
    const spec = GADGETS[gadgetId];
    if (!spec) return { ok: false, error: '無效裝備' };

    const cur = actor.gadgets[gadgetId] ?? 0;
    if (cur >= spec.maxCarry) {
      return { ok: false, error: `已達攜帶上限 (${spec.maxCarry})` };
    }
    if (actor.money < spec.cost) {
      return { ok: false, error: '金錢不足' };
    }

    actor.money -= spec.cost;
    actor.gadgets[gadgetId] = cur + 1;
    actor.activeGadget = gadgetId;
    return { ok: true };
  }

  public handleSwitchGadget(playerId: string, gadgetId: GadgetId): void {
    const actor = this.actors.get(playerId);
    if (!actor || !GADGETS[gadgetId]) return;
    actor.activeGadget = gadgetId;
  }

  public handleThrowGadget(
    playerId: string,
    data: { origin?: Vec3; dir?: Vec3 },
  ): void {
    const actor = this.actors.get(playerId);
    if (!actor || !actor.alive || this.phase !== 'playing' || this.paused) return;

    const now = Date.now();
    if (now - actor.lastGadgetAt < 450) return;

    let gId = actor.activeGadget;
    if ((actor.gadgets[gId] ?? 0) <= 0) {
      const fallback = GADGET_ORDER.find((id) => (actor.gadgets[id] ?? 0) > 0);
      if (!fallback) return;
      gId = fallback;
      actor.activeGadget = fallback;
    }

    actor.lastGadgetAt = now;
    const count = (actor.gadgets[gId] ?? 0) - 1;
    actor.gadgets[gId] = Math.max(0, count);

    if (count <= 0) {
      const nextAvail = GADGET_ORDER.find((id) => (actor.gadgets[id] ?? 0) > 0);
      if (nextAvail) actor.activeGadget = nextAvail;
    }

    const spec = GADGETS[gId];
    if (spec.instantUse) {
      if (gId === 'medkit') {
        for (const ally of this.actors.values()) {
          if (!ally.alive || ally.team !== actor.team) continue;
          const dist = Math.hypot(ally.x - actor.x, ally.y - actor.y, ally.z - actor.z);
          if (dist <= spec.radius) {
            ally.hp = Math.min(ally.maxHp, ally.hp + 55);
            ally.stunnedUntil = 0;
          }
        }
      } else if (gId === 'stim') {
        actor.boostUntil = now + 6000;
        actor.stunnedUntil = 0;
      }

      const instantFx: GadgetFxEvent = {
        id: `prj-${this.projCounter++}`,
        type: gId,
        kind: 'explode',
        team: actor.team,
        shooterId: actor.id,
        x: actor.x,
        y: actor.y + 1.0,
        z: actor.z,
        radius: spec.radius,
      };
      this.broadcast({ type: 'gadget:fx', payload: instantFx });
      return;
    }

    const eyeOffset = actor.crouching ? 0.98 : 1.55;
    const eyeX = actor.x;
    const eyeY = actor.y + eyeOffset;
    const eyeZ = actor.z;

    const oxRaw =
      data.origin && Math.hypot(data.origin.x - eyeX, data.origin.z - eyeZ) < 2.2 ? data.origin.x : eyeX;
    const oyRaw = data.origin ? Math.max(0.4, Math.min(3.5, data.origin.y)) : eyeY;
    const ozRaw =
      data.origin && Math.hypot(data.origin.x - eyeX, data.origin.z - eyeZ) < 2.2 ? data.origin.z : eyeZ;

    const dx = data.dir?.x ?? -Math.sin(actor.yaw);
    const dy = data.dir?.y ?? Math.sin(actor.pitch);
    const dz = data.dir?.z ?? -Math.cos(actor.yaw);
    const len = Math.hypot(dx, dy, dz) || 1;
    const ndx = dx / len;
    const ndy = dy / len;
    const ndz = dz / len;

    const spawnPos = resolveHorizontalCollision(
      oxRaw + ndx * 0.45,
      Math.max(0.2, oyRaw - 0.15),
      ozRaw + ndz * 0.45,
      0.24,
      this.layout,
      this.digHp,
    );

    const proj: InternalProjectile = {
      id: `prj-${this.projCounter++}`,
      type: gId,
      team: actor.team,
      shooterId: actor.id,
      x: spawnPos.x,
      y: oyRaw - 0.1,
      z: spawnPos.z,
      vx: ndx * 19.5,
      vy: ndy * 19.5 + 3.6,
      vz: ndz * 19.5,
      fuseRemaining: spec.fuseSec,
    };
    this.projectiles.push(proj);

    const fx: GadgetFxEvent = {
      id: proj.id,
      type: gId,
      kind: 'throw',
      team: actor.team,
      shooterId: actor.id,
      x: proj.x,
      y: proj.y,
      z: proj.z,
    };
    this.broadcast({ type: 'gadget:fx', payload: fx });
  }

  public handlePlayerPing(
    playerId: string,
    data: { origin?: Vec3; dir?: Vec3 },
  ): void {
    const actor = this.actors.get(playerId);
    if (!actor || !actor.alive || this.phase !== 'playing' || this.paused) return;

    const now = Date.now();
    if (now - actor.lastPingAt < 400) return;
    actor.lastPingAt = now;

    const eyeOffset = actor.crouching ? 0.98 : 1.55;
    const eyeX = actor.x;
    const eyeY = actor.y + eyeOffset;
    const eyeZ = actor.z;

    const ox =
      data.origin && Math.hypot(data.origin.x - eyeX, data.origin.z - eyeZ) < 2.2 ? data.origin.x : eyeX;
    const oy = data.origin ? Math.max(0.4, Math.min(3.8, data.origin.y)) : eyeY;
    const oz =
      data.origin && Math.hypot(data.origin.x - eyeX, data.origin.z - eyeZ) < 2.2 ? data.origin.z : eyeZ;

    const dx = data.dir?.x ?? -Math.sin(actor.yaw);
    const dy = data.dir?.y ?? Math.sin(actor.pitch);
    const dz = data.dir?.z ?? -Math.cos(actor.yaw);
    const len = Math.hypot(dx, dy, dz) || 1;
    const ndx = dx / len;
    const ndy = dy / len;
    const ndz = dz / len;

    const maxRange = 160;
    const wallDist = rayIntersectsArenaObstacle(ox, oy, oz, ndx, ndy, ndz, maxRange, this.layout, this.digHp);
    let bestDist = wallDist;
    let hitTarget: InternalActor | null = null;

    // Slightly generous ping hitbox so teammates can reliably mark moving enemies/carriers
    for (const target of this.actors.values()) {
      if (!target.alive || target.team === actor.team) continue;
      const crouched = Boolean(target.crouching);
      const pingBox = {
        minX: target.x - 0.72,
        maxX: target.x + 0.72,
        minY: target.y,
        maxY: target.y + (crouched ? 1.55 : 2.15),
        minZ: target.z - 0.72,
        maxZ: target.z + 0.72,
      };
      const tHit = rayIntersectsAABB(ox, oy, oz, ndx, ndy, ndz, pingBox, bestDist);
      if (tHit !== null && tHit < bestDist) {
        bestDist = tHit;
        hitTarget = target;
      }
    }

    let kind: PingKind = 'location';
    let px = ox + ndx * wallDist;
    let py = oy + ndy * wallDist;
    let pz = oz + ndz * wallDist;
    let targetActorId: string | undefined;
    let targetName: string | undefined;

    if (hitTarget) {
      const isCarrier =
        this.flags.red.carrierId === hitTarget.id || this.flags.blue.carrierId === hitTarget.id;
      kind = isCarrier ? 'carrier' : 'enemy';
      targetActorId = hitTarget.id;
      targetName = hitTarget.name;
      px = hitTarget.x;
      py = hitTarget.y + (hitTarget.crouching ? 1.65 : 2.2);
      pz = hitTarget.z;
    } else {
      // Also check if aiming right near an enemy flag carrier (ping-assist within 1.4m of ray)
      for (const flagTeam of ['red', 'blue'] as TeamId[]) {
        const flag = this.flags[flagTeam];
        if (flag.status === 'carried' && flag.carrierId) {
          const carrier = this.actors.get(flag.carrierId);
          if (carrier && carrier.alive && carrier.team !== actor.team) {
            const vx = carrier.x - ox;
            const vy = carrier.y + 1.2 - oy;
            const vz = carrier.z - oz;
            const proj = vx * ndx + vy * ndy + vz * ndz;
            if (proj > 0 && proj < wallDist + 0.8) {
              const cx = ox + ndx * proj - carrier.x;
              const cy = oy + ndy * proj - (carrier.y + 1.2);
              const cz = oz + ndz * proj - carrier.z;
              if (cx * cx + cy * cy + cz * cz <= 1.45 * 1.45) {
                kind = 'carrier';
                targetActorId = carrier.id;
                targetName = carrier.name;
                px = carrier.x;
                py = carrier.y + 2.2;
                pz = carrier.z;
                break;
              }
            }
          }
        }
      }
    }

    this.createTeamPing(actor, kind, px, py, pz, now, targetActorId, targetName);
  }

  private createTeamPing(
    creator: InternalActor,
    kind: PingKind,
    x: number,
    y: number,
    z: number,
    now: number,
    targetActorId?: string,
    targetName?: string,
  ): void {
    // Replace existing ping on same target by same team, and cap per-creator active pings to 2
    if (targetActorId) {
      this.pings = this.pings.filter(
        (p) => !(p.team === creator.team && p.targetActorId === targetActorId),
      );
    }
    const creatorPings = this.pings.filter((p) => p.creatorId === creator.id);
    if (creatorPings.length >= 2) {
      const oldest = creatorPings[0];
      this.pings = this.pings.filter((p) => p.id !== oldest.id);
    }

    const ttlMs = kind === 'carrier' ? 8000 : 6500;
    const ttlSec = ttlMs / 1000;
    const ping: TacticalPing = {
      id: `png-${this.pingCounter++}`,
      team: creator.team,
      creatorId: creator.id,
      creatorName: creator.name,
      kind,
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      z: Number(z.toFixed(2)),
      targetActorId,
      targetName,
      ttlSec,
      remainingSec: ttlSec,
      createdAt: now,
      expiresAt: now + ttlMs,
    };

    this.pings.push(ping);
    this.broadcastToTeam(creator.team, { type: 'ping:added', payload: ping });
  }

  private updatePings(now: number): void {
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      if (now >= p.expiresAt) {
        this.pings.splice(i, 1);
        continue;
      }
      p.remainingSec = Number(Math.max(0, (p.expiresAt - now) / 1000).toFixed(2));
      if (p.targetActorId) {
        const target = this.actors.get(p.targetActorId);
        if (!target || !target.alive) {
          this.pings.splice(i, 1);
          continue;
        }
        p.x = Number(target.x.toFixed(2));
        p.y = Number((target.y + (target.crouching ? 1.65 : 2.2)).toFixed(2));
        p.z = Number(target.z.toFixed(2));
      }
    }
  }

  private updateProjectiles(dt: number, now: number): void {
    const subSteps = 2;
    const subDt = dt / subSteps;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.fuseRemaining -= dt;

      for (let s = 0; s < subSteps; s++) {
        p.vy -= 22 * subDt;
        const nextX = p.x + p.vx * subDt;
        const nextY = p.y + p.vy * subDt;
        const nextZ = p.z + p.vz * subDt;

        // Check horizontal wall/cover/soil bounce
        const resX = resolveHorizontalCollision(nextX, Math.max(0, p.y), p.z, 0.22, this.layout, this.digHp);
        if (Math.abs(resX.x - nextX) > 0.01) {
          p.vx = -p.vx * 0.48;
          p.x = resX.x;
        } else {
          p.x = nextX;
        }

        const resZ = resolveHorizontalCollision(p.x, Math.max(0, p.y), nextZ, 0.22, this.layout, this.digHp);
        if (Math.abs(resZ.z - nextZ) > 0.01) {
          p.vz = -p.vz * 0.48;
          p.z = resZ.z;
        } else {
          p.z = nextZ;
        }

        // Ceiling bounce in underground mode
        if (this.layout.ceilingY !== null && nextY > this.layout.ceilingY - 0.25) {
          p.y = this.layout.ceilingY - 0.25;
          if (p.vy > 0) p.vy = -p.vy * 0.4;
        } else {
          const groundY = getGroundHeightAt(p.x, p.z, Math.max(0, p.y), this.layout) + 0.14;
          if (nextY <= groundY) {
            p.y = groundY;
            if (p.vy < -1.2) {
              p.vy = -p.vy * 0.42;
              p.vx *= 0.72;
              p.vz *= 0.72;
            } else {
              p.vy = 0;
              p.vx *= 0.82;
              p.vz *= 0.82;
            }
          } else {
            p.y = nextY;
          }
        }
      }

      if (p.fuseRemaining <= 0) {
        this.detonateProjectile(p, now);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private detonateProjectile(proj: InternalProjectile, now: number): void {
    const spec = GADGETS[proj.type];
    const shooter = this.actors.get(proj.shooterId);

    if (proj.type === 'frag') {
      // Underground mode: blast crater in nearby soil blocks
      if (this.layout.mode === 'underground') {
        const { cols, rows, cellSize, originX, originZ } = UNDERGROUND_GRID;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            if (this.digHp[idx] <= 0) continue;
            const cx = originX + (c + 0.5) * cellSize;
            const cz = originZ + (r + 0.5) * cellSize;
            if (Math.hypot(cx - proj.x, cz - proj.z) <= 2.95) {
              this.damageDigCell(idx, 2, proj.team);
            }
          }
        }
      }

      // Frag splash damage with wall line-of-sight occlusion
      for (const target of this.actors.values()) {
        if (!target.alive) continue;
        const isSelf = target.id === proj.shooterId;
        if (!isSelf && target.team === proj.team) continue;

        const dx = target.x - proj.x;
        const dy = target.y + 1.0 - (proj.y + 0.25);
        const dz = target.z - proj.z;
        const dist = Math.hypot(dx, dy, dz);
        const maxR = isSelf ? 4.0 : spec.radius;
        if (dist > maxR) continue;

        if (dist > 0.35) {
          const obsDist = rayIntersectsArenaObstacle(
            proj.x,
            proj.y + 0.25,
            proj.z,
            dx / dist,
            dy / dist,
            dz / dist,
            dist,
            this.layout,
            this.digHp,
          );
          if (obsDist < dist - 0.35) continue;
        }

        const falloff = Math.max(0.18, 1 - dist / (maxR + 0.7));
        const rawDmg = Math.round(95 * falloff * (isSelf ? 0.35 : 1));
        if (rawDmg <= 0) continue;

        if (this.applyDamage(target, rawDmg, now, isSelf ? undefined : shooter, { x: proj.x, y: proj.y, z: proj.z }, false)) {
          this.handleKill(shooter ?? target, target, false, 'frag');
        }
      }
    } else if (proj.type === 'smoke') {
      this.smokeZones.push({
        id: `smk-${this.projCounter++}`,
        team: proj.team,
        x: proj.x,
        y: Math.max(0.2, proj.y),
        z: proj.z,
        radius: spec.radius,
        remainingSec: 9.5,
        maxSec: 9.5,
      });
    } else if (proj.type === 'emp') {
      for (const target of this.actors.values()) {
        if (!target.alive || target.team === proj.team || target.devMode) continue;
        const dist = Math.hypot(target.x - proj.x, target.y + 1.0 - (proj.y + 0.25), target.z - proj.z);
        if (dist > spec.radius) continue;

        target.stunnedUntil = Math.max(target.stunnedUntil, now + 2800);
        const dmg = Math.round(25 * Math.max(0.4, 1 - dist / (spec.radius + 1)));
        if (this.applyDamage(target, dmg, now, shooter, { x: proj.x, y: proj.y, z: proj.z }, false)) {
          this.handleKill(shooter ?? target, target, false, 'emp');
        }
      }
    } else if (proj.type === 'cryo') {
      for (const target of this.actors.values()) {
        if (!target.alive || target.team === proj.team || target.devMode) continue;
        const dist = Math.hypot(target.x - proj.x, target.y + 1.0 - (proj.y + 0.25), target.z - proj.z);
        if (dist > spec.radius) continue;

        target.stunnedUntil = Math.max(target.stunnedUntil, now + 3800);
        const dmg = Math.round(30 * Math.max(0.35, 1 - dist / (spec.radius + 1)));
        if (this.applyDamage(target, dmg, now, shooter, { x: proj.x, y: proj.y, z: proj.z }, false)) {
          this.handleKill(shooter ?? target, target, false, 'cryo');
        }
      }
    }

    const fx: GadgetFxEvent = {
      id: proj.id,
      type: proj.type,
      kind: 'explode',
      team: proj.team,
      shooterId: proj.shooterId,
      x: proj.x,
      y: proj.y,
      z: proj.z,
      radius: spec.radius,
    };
    this.broadcast({ type: 'gadget:fx', payload: fx });
  }

  private updateSmokeZones(dt: number): void {
    for (let i = this.smokeZones.length - 1; i >= 0; i--) {
      this.smokeZones[i].remainingSec -= dt;
      if (this.smokeZones[i].remainingSec <= 0) {
        this.smokeZones.splice(i, 1);
      }
    }
  }

  private rayIntersectsSmoke(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
  ): boolean {
    for (const s of this.smokeZones) {
      const vx = s.x - ox;
      const vy = s.y + 1.2 - oy;
      const vz = s.z - oz;
      const proj = vx * dx + vy * dy + vz * dz;
      const clampedT = Math.max(0, Math.min(maxDist, proj));
      const cx = ox + dx * clampedT - s.x;
      const cy = oy + dy * clampedT - (s.y + 1.2);
      const cz = oz + dz * clampedT - s.z;
      const r = s.radius * 0.85;
      if (cx * cx + cy * cy + cz * cz <= r * r) {
        return true;
      }
    }
    return false;
  }

  // AI Bot Logic: Grid A* Navigation + Balanced Human-Like Aim
  private updateBot(bot: InternalActor, dt: number, now: number): void {
    // 1. Periodic bot armory shopping
    if (now >= bot.aiNextShopAt) {
      bot.aiNextShopAt = now + 7000 + Math.random() * 5000;
      this.runBotShopping(bot);
    }

    // 2. Scan visible enemies (capped sight range & blocked by smoke screens)
    let nearestEnemy: InternalActor | null = null;
    let nearestEnemyDist = bot.activeWeapon === 'sniper' ? 44 : 38;
    const eyeY = bot.y + 1.55;

    for (const other of this.actors.values()) {
      if (!other.alive || other.team === bot.team) continue;
      const dx = other.x - bot.x;
      const dy = other.y + 1.1 - eyeY;
      const dz = other.z - bot.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > nearestEnemyDist) continue;

      if (this.rayIntersectsSmoke(bot.x, eyeY, bot.z, dx / dist, dy / dist, dz / dist, dist)) {
        continue;
      }

      const obsDist = rayIntersectsArenaObstacle(
        bot.x,
        eyeY,
        bot.z,
        dx / dist,
        dy / dist,
        dz / dist,
        dist,
        this.layout,
        this.digHp,
      );
      if (obsDist >= dist - 0.4) {
        nearestEnemyDist = dist;
        nearestEnemy = other;
      }
    }

    // AI teammates call out enemy flag carriers (CTF) or nearby spotted enemies
    if (nearestEnemy && now - bot.lastPingAt >= 12000) {
      if (this.settings.gameMode === 'ctf') {
        const myFlag = this.flags[bot.team];
        if (myFlag.status === 'carried' && myFlag.carrierId === nearestEnemy.id) {
          const alreadyMarked = this.pings.some(
            (p) => p.team === bot.team && p.kind === 'carrier' && p.targetActorId === nearestEnemy!.id,
          );
          if (!alreadyMarked) {
            bot.lastPingAt = now;
            this.createTeamPing(
              bot,
              'carrier',
              nearestEnemy.x,
              nearestEnemy.y + 2.2,
              nearestEnemy.z,
              now,
              nearestEnemy.id,
              nearestEnemy.name,
            );
          }
        }
      }
    }

    // 3. Determine GameMode-aware navigation objective
    const enemyTeam: TeamId = bot.team === 'red' ? 'blue' : 'red';
    const enemyFlag = this.flags[enemyTeam];
    const carryingEnemyFlag = this.settings.gameMode === 'ctf' && enemyFlag.carrierId === bot.id;

    let targetX = FLAG_BASES[enemyTeam].x;
    let targetY = FLAG_BASES[enemyTeam].y;
    let targetZ = FLAG_BASES[enemyTeam].z;

    if (this.settings.gameMode === 'dom') {
      const laneOffsetZ =
        bot.aiLaneBias === 'north' ? -4.2 : bot.aiLaneBias === 'south' ? 4.2 : 0;
      const laneOffsetX = bot.team === 'red' ? -2.8 : 2.8;
      if (this.controlZone.owner !== bot.team || this.controlZone.contested || bot.aiRole !== 'defense') {
        targetX = CONTROL_ZONE_SPEC.x + laneOffsetX;
        targetZ = CONTROL_ZONE_SPEC.z + laneOffsetZ;
        targetY = 0;
      } else {
        targetX = (bot.team === 'red' ? -8 : 8);
        targetZ = Math.sin(now * 0.00055) * 9;
        targetY = 0;
      }
    } else if (this.settings.gameMode === 'tdm') {
      let huntTarget: InternalActor | null = nearestEnemy;
      if (!huntTarget) {
        let closestDist = Infinity;
        for (const other of this.actors.values()) {
          if (!other.alive || other.team === bot.team) continue;
          const d = Math.hypot(other.x - bot.x, other.z - bot.z);
          if (d < closestDist) {
            closestDist = d;
            huntTarget = other;
          }
        }
      }
      if (huntTarget) {
        targetX = huntTarget.x;
        targetY = huntTarget.y;
        targetZ = huntTarget.z;
      } else {
        targetX = bot.aiLaneBias === 'north' ? 0 : bot.aiLaneBias === 'south' ? 0 : (bot.team === 'red' ? 12 : -12);
        targetZ = bot.aiLaneBias === 'north' ? -15 : bot.aiLaneBias === 'south' ? 15 : 0;
        targetY = 0;
      }
    } else {
      const myFlag = this.flags[bot.team];
      if (carryingEnemyFlag) {
        targetX = FLAG_BASES[bot.team].x;
        targetY = FLAG_BASES[bot.team].y;
        targetZ = FLAG_BASES[bot.team].z;
      } else if (myFlag.status === 'dropped') {
        targetX = myFlag.x;
        targetY = myFlag.y;
        targetZ = myFlag.z;
      } else if (myFlag.status === 'carried' && myFlag.carrierId) {
        const enemyCarrier = this.actors.get(myFlag.carrierId);
        if (
          enemyCarrier &&
          (bot.aiRole !== 'offense' || Math.hypot(enemyCarrier.x - bot.x, enemyCarrier.z - bot.z) < 28)
        ) {
          targetX = enemyCarrier.x;
          targetY = enemyCarrier.y;
          targetZ = enemyCarrier.z;
        }
      } else if (enemyFlag.status === 'dropped') {
        targetX = enemyFlag.x;
        targetY = enemyFlag.y;
        targetZ = enemyFlag.z;
      } else if (bot.aiRole === 'defense') {
        targetX = bot.team === 'red' ? -30 : 30;
        targetY = 0;
        targetZ = Math.sin(now * 0.00055) * 8;
      }
    }

    // 4. Grid-based A* Pathfinding + Waypoint Queue
    if (bot.aiPath.length > 0) {
      const wp = bot.aiPath[0];
      if (Math.hypot(wp.x - bot.x, wp.z - bot.z) < 1.35) {
        bot.aiPath.shift();
      }
    }

    const needRepath =
      now >= bot.aiRepathAt ||
      bot.aiPath.length === 0 ||
      Math.hypot(bot.aiGoalX - targetX, bot.aiGoalZ - targetZ) > 3.5;

    if (needRepath) {
      bot.aiRepathAt = now + 850 + Math.random() * 450;
      bot.aiGoalX = targetX;
      bot.aiGoalZ = targetZ;

      const directDist = Math.hypot(targetX - bot.x, targetZ - bot.z);
      if (
        directDist < 14 &&
        Math.abs(targetY - bot.y) < 0.8 &&
        hasClearNavLine(bot.x, bot.y, bot.z, targetX, targetZ, 0.72, this.layout, this.digHp)
      ) {
        bot.aiPath = [{ x: targetX, y: targetY, z: targetZ }];
      } else {
        const bias = carryingEnemyFlag ? 'none' : bot.aiLaneBias;
        bot.aiPath = this.navGrid.findPath(bot.x, bot.y, bot.z, targetX, targetY, targetZ, bias, this.digHp);
      }
    }

    const activeWp = bot.aiPath[0] ?? { x: targetX, y: targetY, z: targetZ };

    // 5. Move bot with multi-ray clearance steering + teammate separation
    if (now >= bot.aiStrafeFlipAt) {
      bot.aiStrafeFlipAt = now + 1150 + Math.random() * 850;
      bot.aiStrafeDir *= -1;
    }

    const stats = getEffectiveWeaponStats(bot.activeWeapon, bot.ownedWeapons[bot.activeWeapon]);
    const stunMult = now < bot.stunnedUntil ? 0.6 : 1.0;
    const boostMult = now < bot.boostUntil ? 1.3 : 1.0;
    const moveSpeed = (carryingEnemyFlag ? 5.4 : 6.0) * stats.moveSpeedMult * stunMult * boostMult;

    let moveDx = activeWp.x - bot.x;
    let moveDz = activeWp.z - bot.z;
    const goalLen = Math.hypot(moveDx, moveDz) || 1;
    moveDx /= goalLen;
    moveDz /= goalLen;

    // Gentle combat strafe only if side corridor has solid obstacle clearance
    if (nearestEnemy && !carryingEnemyFlag && nearestEnemyDist < 20) {
      const perpX = -moveDz * bot.aiStrafeDir;
      const perpZ = moveDx * bot.aiStrafeDir;
      if (this.isStepClear(bot.x, bot.y, bot.z, perpX, perpZ, 1.9)) {
        moveDx = moveDx * 0.68 + perpX * 0.45;
        moveDz = moveDz * 0.68 + perpZ * 0.45;
        const mLen = Math.hypot(moveDx, moveDz) || 1;
        moveDx /= mLen;
        moveDz /= mLen;
      }
    }

    // Soft separation from teammates so bots don't clump in doorways
    for (const mate of this.actors.values()) {
      if (mate.id === bot.id || !mate.alive || mate.team !== bot.team) continue;
      const sx = bot.x - mate.x;
      const sz = bot.z - mate.z;
      const sDist = Math.hypot(sx, sz);
      if (sDist > 0.05 && sDist < 1.8) {
        const push = (1.8 - sDist) / 1.8;
        moveDx += (sx / sDist) * push * 0.55;
        moveDz += (sz / sDist) * push * 0.55;
      }
    }
    const normMove = Math.hypot(moveDx, moveDz) || 1;
    moveDx /= normMove;
    moveDz /= normMove;

    // Multi-angle obstacle whisker steering using radius-aware clearance checks
    const ignoreSoilForSteer = this.layout.mode === 'underground';
    if (!this.isStepClear(bot.x, bot.y, bot.z, moveDx, moveDz, 1.6, ignoreSoilForSteer)) {
      const baseAngle = Math.atan2(moveDz, moveDx);
      const offsets = [0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.85, -1.85];
      let steered = false;
      for (const off of offsets) {
        const tx = Math.cos(baseAngle + off);
        const tz = Math.sin(baseAngle + off);
        if (this.isStepClear(bot.x, bot.y, bot.z, tx, tz, 1.75, ignoreSoilForSteer)) {
          moveDx = tx;
          moveDz = tz;
          steered = true;
          break;
        }
      }
      if (!steered && this.layout.mode !== 'underground') {
        bot.aiRepathAt = 0;
        bot.aiPath = [];
      }
    }

    // In Underground Mode, bots dig soil blocks directly ahead along their A* tunnel path!
    if (this.layout.mode === 'underground' && now - bot.lastDigAt >= 360) {
      const digHit = raycastDigGrid(bot.x, bot.y + 1.1, bot.z, moveDx, 0, moveDz, 2.35, this.digHp);
      if (digHit) {
        bot.lastDigAt = now;
        this.damageDigCell(digHit.index, 2, bot.team);
      }
    }

    const prevX = bot.x;
    const prevZ = bot.z;
    const nextX = bot.x + moveDx * moveSpeed * dt;
    const nextZ = bot.z + moveDz * moveSpeed * dt;
    const resolved = resolveHorizontalCollision(nextX, bot.y, nextZ, 0.48, this.layout, this.digHp);
    bot.x = resolved.x;
    bot.z = resolved.z;

    const actualMoved = Math.hypot(bot.x - prevX, bot.z - prevZ);
    const isMoving = actualMoved > moveSpeed * dt * 0.25;
    if (!isMoving) {
      const blockedBySoil =
        this.layout.mode === 'underground'
          ? raycastDigGrid(bot.x, bot.y + 1.1, bot.z, moveDx, 0, moveDz, 2.6, this.digHp)
          : null;
      if (blockedBySoil) {
        if (now - bot.lastDigAt >= 320) {
          bot.lastDigAt = now;
          this.damageDigCell(blockedBySoil.index, 2, bot.team);
        }
      } else {
        bot.aiRepathAt = 0;
        bot.aiPath = [];
        bot.aiStrafeDir *= -1;
      }
    }

    // Gravity & ground height
    bot.vy -= 22 * dt;
    bot.y += bot.vy * dt;
    const groundY = getGroundHeightAt(bot.x, bot.z, bot.y, this.layout);
    if (bot.y <= groundY) {
      bot.y = groundY;
      bot.vy = 0;
    }

    // 6. Balanced Human-Like Aiming & Burst Shooting
    if (nearestEnemy) {
      if (bot.aiTargetId !== nearestEnemy.id) {
        bot.aiTargetId = nearestEnemy.id;
        bot.aiTargetSeenAt = now;
        bot.aiBurstShotsLeft = stats.automatic ? 3 + Math.floor(Math.random() * 3) : 1;
        bot.aiBurstCooldownUntil = 0;
      }

      // Aim toward torso center with smooth angular tracking speed (no instant aimbot snap)
      const tx = nearestEnemy.x;
      const ty = nearestEnemy.y + 1.0;
      const tz = nearestEnemy.z;
      const dx = tx - bot.x;
      const dy = ty - eyeY;
      const dz = tz - bot.z;
      const horiz = Math.hypot(dx, dz) || 1;

      const desiredYaw = Math.atan2(-dx, -dz);
      const desiredPitch = Math.atan2(dy, horiz);

      // Wandering aim sway updated every 220-360ms so bots miss naturally like humans
      if (now >= bot.aiNextNoiseAt) {
        bot.aiNextNoiseAt = now + 220 + Math.random() * 140;
        const swayScale = 0.065 + Math.min(0.055, nearestEnemyDist * 0.0018);
        bot.aiAimNoiseYaw = (Math.random() - 0.5) * 2 * swayScale;
        bot.aiAimNoisePitch = (Math.random() - 0.5) * 1.4 * swayScale;
      }

      const maxTurn = (bot.activeWeapon === 'sniper' ? 2.6 : 3.5) * dt;
      let yawDiff = desiredYaw + bot.aiAimNoiseYaw - bot.aiAimYaw;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      bot.aiAimYaw += Math.max(-maxTurn, Math.min(maxTurn, yawDiff));

      const pitchDiff = desiredPitch + bot.aiAimNoisePitch - bot.aiAimPitch;
      bot.aiAimPitch = Math.max(
        -Math.PI / 2 + 0.1,
        Math.min(Math.PI / 2 - 0.1, bot.aiAimPitch + Math.max(-maxTurn, Math.min(maxTurn, pitchDiff))),
      );

      bot.yaw = bot.aiAimYaw;
      bot.pitch = bot.aiAimPitch;

      // Reaction delay on target acquisition before pulling trigger
      const reactionMs = bot.activeWeapon === 'sniper' ? 560 : 340;
      const aimAligned = Math.abs(yawDiff) < 0.28 && Math.abs(pitchDiff) < 0.25;
      const intervalMult = stats.automatic ? 1.7 : 1.95;

      // AI Bot occasional tactical gadget deployment
      if (now - bot.lastGadgetAt >= 15000 && now >= bot.stunnedUntil) {
        if (carryingEnemyFlag && (bot.gadgets.smoke ?? 0) > 0 && nearestEnemyDist < 24) {
          bot.activeGadget = 'smoke';
          this.handleThrowGadget(bot.id, {
            origin: { x: bot.x, y: eyeY, z: bot.z },
            dir: { x: 0, y: -0.35, z: 0 },
          });
        } else if (
          nearestEnemyDist >= 8 &&
          nearestEnemyDist <= 22 &&
          (bot.gadgets.frag ?? 0) > 0 &&
          Math.random() < 0.06
        ) {
          bot.activeGadget = 'frag';
          const len = Math.hypot(dx, dy, dz) || 1;
          this.handleThrowGadget(bot.id, {
            origin: { x: bot.x, y: eyeY, z: bot.z },
            dir: { x: dx / len, y: Math.min(0.35, dy / len + 0.12), z: dz / len },
          });
        }
      }

      if (
        now >= bot.stunnedUntil &&
        now - bot.aiTargetSeenAt >= reactionMs &&
        now >= bot.aiBurstCooldownUntil &&
        aimAligned &&
        !bot.reloading &&
        bot.ammo > 0 &&
        now - bot.lastShotAt >= stats.fireInterval * 1000 * intervalMult
      ) {
        bot.lastShotAt = now;
        bot.ammo -= 1;
        bot.weaponAmmo[bot.activeWeapon] = bot.ammo;

        // Realistic random bullet dispersion around bot's tracked aim vector
        const cosPitch = Math.cos(bot.aiAimPitch);
        const baseAimX = -Math.sin(bot.aiAimYaw) * cosPitch;
        const baseAimY = Math.sin(bot.aiAimPitch);
        const baseAimZ = -Math.cos(bot.aiAimYaw) * cosPitch;

        const baseSpread =
          bot.activeWeapon === 'sniper'
            ? 0.042
            : bot.activeWeapon === 'shotgun'
              ? 0.075
              : 0.068;
        const movePenalty = isMoving ? 0.032 : 0;
        const distPenalty = Math.min(0.035, nearestEnemyDist * 0.001);
        const totalSpread = baseSpread + movePenalty + distPenalty;

        const aimDx = baseAimX + (Math.random() - 0.5) * 2 * totalSpread;
        const aimDy = baseAimY + (Math.random() - 0.5) * 1.4 * totalSpread;
        const aimDz = baseAimZ + (Math.random() - 0.5) * 2 * totalSpread;
        const aimLen = Math.hypot(aimDx, aimDy, aimDz) || 1;

        this.executeWeaponFire(
          bot,
          bot.x,
          eyeY,
          bot.z,
          aimDx / aimLen,
          aimDy / aimLen,
          aimDz / aimLen,
          stats,
          now,
        );

        // Burst pause cadence on automatic rifles/SMGs so bots don't laser non-stop
        if (stats.automatic) {
          bot.aiBurstShotsLeft -= 1;
          if (bot.aiBurstShotsLeft <= 0) {
            bot.aiBurstShotsLeft = 3 + Math.floor(Math.random() * 4);
            bot.aiBurstCooldownUntil = now + 380 + Math.random() * 280;
          }
        }

        if (bot.ammo <= 0) {
          this.startReload(bot, now);
        }
      } else if (bot.ammo <= 0 && !bot.reloading) {
        this.startReload(bot, now);
      }
    } else {
      bot.aiTargetId = null;
      const moveYaw = Math.atan2(-moveDx, -moveDz);
      let yawDiff = moveYaw - bot.aiAimYaw;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      bot.aiAimYaw += yawDiff * Math.min(1, dt * 7);
      bot.aiAimPitch += (0 - bot.aiAimPitch) * Math.min(1, dt * 7);
      bot.yaw = bot.aiAimYaw;
      bot.pitch = bot.aiAimPitch;
    }
  }

  private isStepClear(x: number, y: number, z: number, dx: number, dz: number, dist: number, ignoreDigSoil = false): boolean {
    const steps = 3;
    let prevY = y;
    const soilCheck = ignoreDigSoil ? undefined : this.digHp;
    for (let i = 1; i <= steps; i++) {
      const d = (dist * i) / steps;
      const sx = x + dx * d;
      const sz = z + dz * d;
      const sy = getGroundHeightAt(sx, sz, prevY, this.layout);
      if (Math.abs(sy - prevY) > 0.75) return false;
      if (!isPointClearOfObstacles(sx, sy, sz, 0.68, this.layout, soilCheck)) return false;
      prevY = sy;
    }
    return true;
  }

  private runBotShopping(bot: InternalActor): void {
    // Bots buy better weapons or upgrade current weapon
    const desiredOrder: WeaponId[] =
      bot.aiRole === 'defense'
        ? ['shotgun', 'vector', 'gatling', 'autocannon', 'rifle']
        : ['smg', 'vector', 'rifle', 'freezer', 'laser', 'burst', 'sniper'];

    for (const wid of desiredOrder) {
      if (!bot.ownedWeapons[wid] && bot.money >= WEAPONS[wid].cost) {
        this.handleBuyWeapon(bot.id, wid);
        return;
      }
    }

    const upg = bot.ownedWeapons[bot.activeWeapon];
    if (upg) {
      if (upg.damageLevel < MAX_UPGRADE_LEVEL && bot.money >= UPGRADE_COSTS[upg.damageLevel]) {
        this.handleUpgradeWeapon(bot.id, bot.activeWeapon, 'damage');
      } else if (upg.fireRateLevel < MAX_UPGRADE_LEVEL && bot.money >= UPGRADE_COSTS[upg.fireRateLevel]) {
        this.handleUpgradeWeapon(bot.id, bot.activeWeapon, 'fireRate');
      }
    }

    if (bot.money >= 260 && (bot.gadgets.frag ?? 0) < 1) {
      this.handleBuyGadget(bot.id, 'frag');
    } else if (bot.money >= 240 && (bot.gadgets.smoke ?? 0) < 1) {
      this.handleBuyGadget(bot.id, 'smoke');
    }
  }

  private toSnapshot(a: InternalActor): ActorSnapshot {
    const now = Date.now();
    const ownedCopy: Partial<Record<WeaponId, WeaponUpgradeState>> = {};
    for (const wid of WEAPON_ORDER) {
      if (a.ownedWeapons[wid]) ownedCopy[wid] = { ...a.ownedWeapons[wid]! };
    }
    const gadgetsCopy: Partial<Record<GadgetId, number>> = {};
    for (const gid of GADGET_ORDER) {
      if ((a.gadgets[gid] ?? 0) > 0) gadgetsCopy[gid] = a.gadgets[gid]!;
    }
    return {
      id: a.id,
      name: a.name,
      isBot: a.isBot,
      team: a.team,
      x: Number(a.x.toFixed(3)),
      y: Number(a.y.toFixed(3)),
      z: Number(a.z.toFixed(3)),
      yaw: Number(a.yaw.toFixed(3)),
      pitch: Number(a.pitch.toFixed(3)),
      hp: a.hp,
      maxHp: a.maxHp,
      alive: a.alive,
      respawnTimer: Number(a.respawnTimer.toFixed(1)),
      money: a.money,
      kills: a.kills,
      deaths: a.deaths,
      assists: a.assists,
      headshots: a.headshots,
      damageDealt: a.damageDealt,
      currentStreak: a.currentStreak,
      bestStreak: a.bestStreak,
      captures: a.captures,
      returns: a.returns,
      zoneScore: a.zoneScore,
      activeWeapon: a.activeWeapon,
      ammo: a.ammo,
      maxAmmo: a.maxAmmo,
      reloading: a.reloading,
      crouching: Boolean(a.crouching),
      slowed: now < a.stunnedUntil,
      boosted: now < a.boostUntil,
      regenerating: a.alive && a.hp < a.maxHp && now - a.lastDamagedAt >= 4500,
      devMode: Boolean(a.devMode),
      ownedWeapons: ownedCopy,
      activeGadget: a.activeGadget,
      gadgets: gadgetsCopy,
    };
  }

  public getDugCellsList(): number[] {
    if (this.layout.mode !== 'underground') return [];
    const list: number[] = [];
    for (let i = 0; i < this.digHp.length; i++) {
      if (this.digHp[i] <= 0) list.push(i);
    }
    return list;
  }

  public buildStateSync(includeDugCells = false, forTeam?: TeamId): StateSyncPayload {
    const visiblePings = forTeam
      ? this.pings.filter((p) => p.team === forTeam).map((p) => ({ ...p }))
      : [];

    return {
      roomId: this.roomId,
      phase: this.phase,
      timeRemaining: Number(this.timeRemaining.toFixed(1)),
      overtime: this.overtime,
      redScore: this.redScore,
      blueScore: this.blueScore,
      scoreLimit: this.settings.scoreLimit,
      winnerTeam: this.winnerTeam,
      paused: this.paused,
      humanCount: this.getHumanCount(),
      gameMode: this.settings.gameMode,
      mapMode: this.layout.mode,
      mapSeed: this.mapSeed,
      digVersion: this.layout.mode === 'underground' ? this.digVersion : undefined,
      dugCells: includeDugCells ? this.getDugCellsList() : undefined,
      flags: {
        red: { ...this.flags.red },
        blue: { ...this.flags.blue },
      },
      controlZone: this.settings.gameMode === 'dom' ? { ...this.controlZone } : undefined,
      actors: Array.from(this.actors.values()).map((a) => this.toSnapshot(a)),
      projectiles: this.projectiles.map((p) => ({
        id: p.id,
        type: p.type,
        team: p.team,
        x: Number(p.x.toFixed(3)),
        y: Number(p.y.toFixed(3)),
        z: Number(p.z.toFixed(3)),
        vx: Number(p.vx.toFixed(2)),
        vy: Number(p.vy.toFixed(2)),
        vz: Number(p.vz.toFixed(2)),
      })),
      smokeZones: this.smokeZones.map((s) => ({
        id: s.id,
        team: s.team,
        x: Number(s.x.toFixed(2)),
        y: Number(s.y.toFixed(2)),
        z: Number(s.z.toFixed(2)),
        radius: s.radius,
        remainingSec: Number(s.remainingSec.toFixed(2)),
        maxSec: s.maxSec,
      })),
      pings: visiblePings,
    };
  }

  private broadcastStateSync(): void {
    const redPayload = JSON.stringify({ type: 'state:sync', payload: this.buildStateSync(false, 'red') });
    const bluePayload = JSON.stringify({ type: 'state:sync', payload: this.buildStateSync(false, 'blue') });
    for (const actor of this.actors.values()) {
      if (actor.ws && actor.ws.readyState === 1) {
        actor.ws.send(actor.team === 'red' ? redPayload : bluePayload);
      }
    }
  }

  public buildLobbyInfo(): RoomLobbyInfo {
    return {
      roomId: this.roomId,
      hostId: this.hostId,
      phase: this.phase,
      settings: { ...this.settings },
      players: Array.from(this.actors.values()).map((a) => ({
        id: a.id,
        name: a.name,
        team: a.team,
        isBot: a.isBot,
      })),
    };
  }

  public broadcastLobbyInfo(): void {
    this.broadcast({ type: 'room:updated', payload: this.buildLobbyInfo() });
  }

  private broadcastFeed(event: KillFeedEvent): void {
    this.broadcast({ type: 'combat:feed', payload: event });
  }

  public sendTo(playerId: string, message: unknown): void {
    const actor = this.actors.get(playerId);
    if (actor?.ws && actor.ws.readyState === 1) {
      actor.ws.send(JSON.stringify(message));
    }
  }

  public handleTeamChat(playerId: string, rawText: string): void {
    const actor = this.actors.get(playerId);
    if (!actor || actor.isBot) return;

    const cleaned = rawText.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
    if (!cleaned) return;

    const now = Date.now();
    if (now - actor.lastChatAt < 250) return;
    actor.lastChatAt = now;

    const message: TeamChatMessage = {
      id: `chat-${now}-${eventSeq++}`,
      senderId: actor.id,
      senderName: actor.name,
      team: actor.team,
      text: cleaned,
      createdAt: now,
    };

    this.broadcastToTeam(actor.team, { type: 'chat:message', payload: message });
  }

  public broadcastToTeam(team: TeamId, message: unknown): void {
    const serialized = JSON.stringify(message);
    for (const actor of this.actors.values()) {
      if (actor.team === team && actor.ws && actor.ws.readyState === 1) {
        actor.ws.send(serialized);
      }
    }
  }

  public broadcast(message: unknown): void {
    const serialized = JSON.stringify(message);
    for (const actor of this.actors.values()) {
      if (actor.ws && actor.ws.readyState === 1) {
        actor.ws.send(serialized);
      }
    }
  }
}
