import type { WebSocket } from 'ws';
import {
  ARENA_BOUNDS,
  ArenaNavGrid,
  ECONOMY,
  FLAG_BASES,
  GADGETS,
  GADGET_ORDER,
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
  DigUpdateEvent,
  FlagSnapshot,
  GadgetFxEvent,
  GadgetId,
  KillFeedEvent,
  MapLayout,
  MapMode,
  MatchEndSummary,
  MatchPhase,
  ProjectileSnapshot,
  RoomLobbyInfo,
  RoomSettings,
  SmokeZoneSnapshot,
  StateSyncPayload,
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
  stunnedUntil: number;
  reloadFinishAt: number;
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
  private projectiles: InternalProjectile[] = [];
  private smokeZones: InternalSmokeZone[] = [];
  private projCounter = 1;
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
    this.settings = {
      teamSize: settings?.teamSize === 4 ? 4 : 3,
      durationSec: settings?.durationSec ?? 300,
      scoreLimit: settings?.scoreLimit ?? 5,
      mapMode,
    };
    this.timeRemaining = this.settings.durationSec;
    this.flags = this.createInitialFlags();
    this.layout = generateMapLayout(this.settings.mapMode, this.mapSeed);
    this.navGrid = new ArenaNavGrid(this.layout);
    this.digHp = createInitialUndergroundHp(this.layout);
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
      captures: 0,
      returns: 0,
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
      stunnedUntil: 0,
      reloadFinishAt: 0,
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
    if (typeof next.scoreLimit === 'number' && [3, 5, 7].includes(next.scoreLimit)) {
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
    this.mapSeed = Math.floor(Math.random() * 1_000_000_000);
    this.layout = generateMapLayout(this.settings.mapMode, this.mapSeed);
    this.navGrid = new ArenaNavGrid(this.layout);
    this.digHp = createInitialUndergroundHp(this.layout);
    this.digVersion = 1;
    this.projectiles = [];
    this.smokeZones = [];

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
      actor.captures = 0;
      actor.returns = 0;
      actor.activeWeapon = 'pistol';
      actor.ammo = pistolStats.magSize;
      actor.maxAmmo = pistolStats.magSize;
      actor.reloading = false;
      actor.crouching = false;
      actor.stunnedUntil = 0;
      actor.ownedWeapons = {
        pistol: { damageLevel: 1, fireRateLevel: 1, magLevel: 1 },
      };
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
          captures: 0,
          returns: 0,
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
          stunnedUntil: 0,
          reloadFinishAt: 0,
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
    this.broadcast({ type: 'state:sync', payload: this.buildStateSync() });
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
        actor.ammo = stats.magSize;
        actor.maxAmmo = stats.magSize;
        actor.reloading = false;
      }

      if (actor.isBot) {
        this.updateBot(actor, dt, now);
      }
    }

    // Update projectiles & smoke clouds
    this.updateProjectiles(dt, now);
    this.updateSmokeZones(dt);

    // Update flag state machine
    this.updateFlags(dt);

    // Broadcast authoritative state snapshot
    this.broadcast({
      type: 'state:sync',
      payload: this.buildStateSync(),
    });
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
      redScore: this.redScore,
      blueScore: this.blueScore,
      victoryBonus: ECONOMY.VICTORY_TEAM_BONUS,
      actors: Array.from(this.actors.values()).map((a) => this.toSnapshot(a)),
    };

    this.broadcast({ type: 'match:ended', payload: summary });
    this.broadcastLobbyInfo();
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

    if (actor.reloading) return;
    if (actor.ammo <= 0) {
      this.startReload(actor, now);
      return;
    }
    if (now - actor.lastShotAt < stats.fireInterval * 1000 * 0.85) return;

    actor.lastShotAt = now;
    actor.ammo -= 1;

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
    this.executeWeaponFire(actor, ox, oy, oz, baseDx, baseDy, baseDz, effectiveStats);

    if (actor.ammo <= 0) {
      this.startReload(actor, now);
    }
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
  ): void {
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
        dmg = isHeadshot ? Math.round(stats.damage * 1.5) : stats.damage;
        hitTarget.hp = Math.max(0, hitTarget.hp - dmg);
        killed = hitTarget.hp <= 0;
      } else if (this.layout.mode === 'underground' && !shooter.isBot) {
        // Bullets hitting soil blocks carve tunnels too!
        const digHit = raycastDigGrid(ox, oy, oz, ndx, ndy, ndz, wallDist + 0.08, this.digHp);
        if (digHit && digHit.dist <= wallDist + 0.05) {
          this.damageDigCell(digHit.index, stats.damage >= 35 ? 2 : 1, shooter.team);
        }
      }

      const tracer: TracerEvent = {
        shooterId: shooter.id,
        team: shooter.team,
        weaponId: shooter.activeWeapon,
        from: { x: ox, y: oy - 0.08, z: oz },
        to: { x: ox + ndx * bestDist, y: oy + ndy * bestDist, z: oz + ndz * bestDist },
        hitActorId: hitTarget?.id,
        headshot: isHeadshot,
        damage: dmg || undefined,
        killed: killed || undefined,
      };
      this.broadcast({ type: 'combat:tracer', payload: tracer });

      if (hitTarget && killed) {
        this.handleKill(shooter, hitTarget, isHeadshot);
      }
    }
  }

  private handleKill(
    killer: InternalActor,
    victim: InternalActor,
    headshot: boolean,
    gadgetId?: GadgetId,
  ): void {
    if (!victim.alive) return;
    victim.alive = false;
    victim.respawnTimer = 3.5;
    victim.deaths += 1;

    const wasCarrier =
      this.flags.red.carrierId === victim.id || this.flags.blue.carrierId === victim.id;

    if (this.flags.red.carrierId === victim.id) this.dropFlag('red', victim);
    if (this.flags.blue.carrierId === victim.id) this.dropFlag('blue', victim);

    if (killer.id !== victim.id) {
      killer.kills += 1;
      let reward = ECONOMY.KILL_REWARD;
      if (headshot) reward += ECONOMY.HEADSHOT_BONUS;
      if (wasCarrier) reward += ECONOMY.FLAG_CARRIER_KILL_BONUS;
      killer.money += reward;
    }

    this.broadcastFeed({
      id: `ev-${eventSeq++}`,
      timestamp: Date.now(),
      type: 'kill',
      actorName: killer.name,
      actorTeam: killer.team,
      targetName: victim.name,
      targetTeam: victim.team,
      weaponId: gadgetId ? undefined : killer.activeWeapon,
      gadgetId,
      headshot,
    });
  }

  public handleReload(playerId: string): void {
    const actor = this.actors.get(playerId);
    if (!actor || !actor.alive || actor.reloading) return;
    const stats = getEffectiveWeaponStats(actor.activeWeapon, actor.ownedWeapons[actor.activeWeapon]);
    if (actor.ammo >= stats.magSize) return;
    this.startReload(actor, Date.now());
  }

  private startReload(actor: InternalActor, now: number): void {
    const stats = getEffectiveWeaponStats(actor.activeWeapon, actor.ownedWeapons[actor.activeWeapon]);
    actor.reloading = true;
    actor.reloadFinishAt = now + stats.reloadTime * 1000;
  }

  public handleSwitchWeapon(playerId: string, weaponId: WeaponId): void {
    const actor = this.actors.get(playerId);
    if (!actor || !actor.ownedWeapons[weaponId]) return;
    actor.activeWeapon = weaponId;
    actor.reloading = false;
    const stats = getEffectiveWeaponStats(weaponId, actor.ownedWeapons[weaponId]);
    actor.ammo = stats.magSize;
    actor.maxAmmo = stats.magSize;
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

    if (actor.activeWeapon === weaponId) {
      const stats = getEffectiveWeaponStats(weaponId, upg);
      actor.maxAmmo = stats.magSize;
      actor.ammo = Math.min(stats.magSize, actor.ammo + 4);
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

    const spec = GADGETS[gId];
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

        target.hp = Math.max(0, target.hp - rawDmg);
        if (target.hp <= 0) {
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
        if (!target.alive || target.team === proj.team) continue;
        const dist = Math.hypot(target.x - proj.x, target.y + 1.0 - (proj.y + 0.25), target.z - proj.z);
        if (dist > spec.radius) continue;

        target.stunnedUntil = Math.max(target.stunnedUntil, now + 2800);
        const dmg = Math.round(25 * Math.max(0.4, 1 - dist / (spec.radius + 1)));
        target.hp = Math.max(0, target.hp - dmg);
        if (target.hp <= 0) {
          this.handleKill(shooter ?? target, target, false, 'emp');
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

    // 3. Determine CTF navigation objective
    const enemyTeam: TeamId = bot.team === 'red' ? 'blue' : 'red';
    const myFlag = this.flags[bot.team];
    const enemyFlag = this.flags[enemyTeam];
    const carryingEnemyFlag = enemyFlag.carrierId === bot.id;

    let targetX = FLAG_BASES[enemyTeam].x;
    let targetY = FLAG_BASES[enemyTeam].y;
    let targetZ = FLAG_BASES[enemyTeam].z;

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
    const moveSpeed = (carryingEnemyFlag ? 5.4 : 6.0) * stats.moveSpeedMult * stunMult;

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
        ? ['shotgun', 'gatling', 'rifle', 'smg']
        : ['smg', 'rifle', 'burst', 'gatling', 'sniper'];

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
      captures: a.captures,
      returns: a.returns,
      activeWeapon: a.activeWeapon,
      ammo: a.ammo,
      maxAmmo: a.maxAmmo,
      reloading: a.reloading,
      crouching: Boolean(a.crouching),
      slowed: Date.now() < a.stunnedUntil,
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

  public buildStateSync(includeDugCells = false): StateSyncPayload {
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
      mapMode: this.layout.mode,
      mapSeed: this.mapSeed,
      digVersion: this.layout.mode === 'underground' ? this.digVersion : undefined,
      dugCells: includeDugCells ? this.getDugCellsList() : undefined,
      flags: {
        red: { ...this.flags.red },
        blue: { ...this.flags.blue },
      },
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
    };
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

  public broadcast(message: unknown): void {
    const serialized = JSON.stringify(message);
    for (const actor of this.actors.values()) {
      if (actor.ws && actor.ws.readyState === 1) {
        actor.ws.send(serialized);
      }
    }
  }
}
