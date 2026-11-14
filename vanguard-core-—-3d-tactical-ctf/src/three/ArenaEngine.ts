import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  DEFAULT_MAP_LAYOUT,
  FLAG_BASES,
  GADGET_ORDER,
  WEAPONS,
  WEAPON_ORDER,
  createInitialUndergroundHp,
  generateMapLayout,
  getEffectiveWeaponStats,
  getGroundHeightAt,
  getUndergroundCellBounds,
  raycastDigGrid,
  resolveHorizontalCollision,
} from '../shared/gameConfig.ts';
import type {
  ActorSnapshot,
  GadgetFxEvent,
  GadgetId,
  MapLayout,
  MapMode,
  StateSyncPayload,
  TeamId,
  TracerEvent,
  WeaponId,
} from '../shared/gameConfig.ts';
import { soundEngine } from '../audio/soundEngine.ts';
import { createProceduralTextures } from './proceduralTextures.ts';
import {
  buildArenaEnvironment,
  createFlagMesh,
  createGrenadeMesh,
  createSmokeCloudGroup,
  createTrooperRig,
  createWeaponViewmodel,
} from './models.ts';
import type { ArenaWorldController, TrooperRig, WeaponViewRig } from './models.ts';

export interface HudProjection {
  enemyFlagScreen: { x: number; y: number; visible: boolean; dist: number; label: string } | null;
  homeBaseScreen: { x: number; y: number; visible: boolean; dist: number } | null;
}

export interface ArenaPoseState {
  crouching: boolean;
  aiming: boolean;
  weaponId: WeaponId;
  scopeType: 'iron' | 'holo' | 'sniper';
}

export interface ArenaCallbacks {
  onPointerLockChange: (locked: boolean) => void;
  onShoot: (
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    aiming: boolean,
  ) => void;
  onDig?: (
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
  ) => void;
  onReload: () => void;
  onSwitchWeapon: (weaponId: WeaponId) => void;
  onThrowGadget?: (
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
  ) => void;
  onSwitchGadget?: (gadgetId: GadgetId) => void;
  onSmokeStateChange?: (insideSmoke: boolean) => void;
  onStateReport: (pos: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    crouching: boolean;
  }) => void;
  onOpenShopKey: () => void;
  onScoreboardKey: (open: boolean) => void;
  onEscapeKey?: () => void;
  onPoseChange?: (pose: ArenaPoseState) => void;
  onHudProject?: (proj: HudProjection) => void;
}

interface RemoteActorEntry {
  rig: TrooperRig;
  targetPos: THREE.Vector3;
  targetYaw: number;
  targetPitch: number;
  crouching: boolean;
  team: TeamId;
  name: string;
}

interface ActiveTracer {
  mesh: THREE.Mesh;
  coreMesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

interface ActiveSpark {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
}

interface ActiveRing {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  endScale: number;
}

// Pre-allocated math helpers (Zero GC in render loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

export class ArenaEngine {
  private container: HTMLElement;
  private callbacks: ArenaCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private textures: ReturnType<typeof createProceduralTextures>;

  private viewmodelAnchor = new THREE.Group();
  private viewmodels = new Map<WeaponId, WeaponViewRig>();
  private currentViewWeapon: WeaponId = 'pistol';
  private localTeam: TeamId = 'blue';
  private localPlayerId: string | null = null;
  private muzzleLight: THREE.PointLight;
  private headlamp: THREE.PointLight;

  private mapLayout: MapLayout = DEFAULT_MAP_LAYOUT;
  private digHp: Uint8Array = new Uint8Array(0);
  private arenaWorld: ArenaWorldController;

  private flagMeshes: Record<TeamId, THREE.Group>;
  private remoteActors = new Map<string, RemoteActorEntry>();
  private projectileMeshes = new Map<
    string,
    { mesh: THREE.Group; targetPos: THREE.Vector3; vel: THREE.Vector3 }
  >();
  private smokeMeshes = new Map<
    string,
    {
      group: THREE.Group;
      materials: THREE.MeshStandardMaterial[];
      x: number;
      y: number;
      z: number;
      radius: number;
      remainingSec: number;
      maxSec: number;
    }
  >();
  private tracers: ActiveTracer[] = [];
  private sparks: ActiveSpark[] = [];
  private rings: ActiveRing[] = [];

  private keys: Record<string, boolean> = {};
  private mouseDown = false;
  private aiming = false;
  private crouching = false;
  private eyeHeight = 1.58;
  private pointerLocked = false;
  private isPlaying = false;
  private shopOpen = false;
  private paused = false;
  private disposed = false;

  // User camera/aim settings
  private baseSensitivity = 0.0021;
  private baseFov = 76;

  // Local player physics state
  private pos = new THREE.Vector3(46, 0.35, 0);
  private vy = 0;
  private yaw = Math.PI / 2;
  private pitch = 0;
  private grounded = true;
  private alive = true;
  private carryingEnemyFlag = false;
  private localAmmo = 14;
  private localReloading = false;
  private localSlowed = false;
  private localActiveGadget: GadgetId = 'frag';
  private localGadgets: Partial<Record<GadgetId, number>> = {};
  private insideSmoke = false;
  private ownedWeaponsList: WeaponId[] = ['pistol'];
  private activeWeaponStats = getEffectiveWeaponStats('pistol');

  // Viewmodel recoil, camera punch, trauma shake & footsteps
  private recoilOffset = 0;
  private flashTimer = 0;
  private walkBobPhase = 0;
  private stepDistAccum = 0;
  private punchPitch = 0;
  private punchYaw = 0;
  private cameraShake = 0;
  private fovPunch = 0;
  private gatlingSpinVel = 0;
  private lastPoseKey = '';
  private lastLocalShotTime = 0;
  private lastGadgetThrowTime = 0;
  private lastDigTime = 0;
  private lastReportTime = 0;
  private lastHudProjTime = 0;

  private clock = new THREE.Clock();
  private frameId = 0;
  private elapsed = 0;

  // Shared geometries for FX
  private tracerGeo = new THREE.CylinderGeometry(0.036, 0.036, 1, 6);
  private tracerCoreGeo = new THREE.CylinderGeometry(0.014, 0.014, 1, 6);
  private sparkGeo = new THREE.BoxGeometry(0.075, 0.075, 0.14);
  private ringGeo = new THREE.RingGeometry(0.18, 0.32, 20);

  constructor(container: HTMLElement, callbacks: ArenaCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    // 1. Software WebGL Detection
    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Renderer Setup
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // 3. Scene, Camera & Fog
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090d16);
    this.scene.fog = new THREE.FogExp2(0x090d16, 0.0105);

    this.camera = new THREE.PerspectiveCamera(
      76,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
      0.08,
      280,
    );
    this.scene.add(this.camera);

    // 4. Mandatory Studio Environment Reflection
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // 5. Three-Point Warm/Cool Lighting Rig
    const hemi = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.85);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff1d6, 1.85);
    keyLight.position.set(28, 48, 22);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 5;
    keyLight.shadow.camera.far = 140;
    keyLight.shadow.camera.left = -62;
    keyLight.shadow.camera.right = 62;
    keyLight.shadow.camera.top = 42;
    keyLight.shadow.camera.bottom = -42;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.75);
    rimLight.position.set(-35, 22, -28);
    this.scene.add(rimLight);

    // Subtle Base Point Lights
    const redBaseLight = new THREE.PointLight(0xef4444, 18, 28, 1.5);
    redBaseLight.position.set(FLAG_BASES.red.x, 4.5, 0);
    this.scene.add(redBaseLight);

    const blueBaseLight = new THREE.PointLight(0x06b6d4, 18, 28, 1.5);
    blueBaseLight.position.set(FLAG_BASES.blue.x, 4.5, 0);
    this.scene.add(blueBaseLight);

    // 6. Procedural Textures & Sci-Fi Arena
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAniso);
    this.arenaWorld = buildArenaEnvironment(this.textures, this.mapLayout, this.digHp);
    this.scene.add(this.arenaWorld.root);

    // 7. World Flag Meshes
    this.flagMeshes = {
      red: createFlagMesh('red'),
      blue: createFlagMesh('blue'),
    };
    this.flagMeshes.red.position.set(FLAG_BASES.red.x, FLAG_BASES.red.y, FLAG_BASES.red.z);
    this.flagMeshes.blue.position.set(FLAG_BASES.blue.x, FLAG_BASES.blue.y, FLAG_BASES.blue.z);
    this.scene.add(this.flagMeshes.red, this.flagMeshes.blue);

    // 8. First-Person Viewmodel Anchor, Muzzle Light & Underground Headlamp attached to Camera
    this.viewmodelAnchor.position.set(0.27, -0.24, -0.44);
    this.camera.add(this.viewmodelAnchor);
    this.rebuildViewmodels('blue');
    this.viewmodelAnchor.visible = false;

    this.muzzleLight = new THREE.PointLight(0x38bdf8, 0, 12, 1.8);
    this.muzzleLight.position.set(0.22, -0.1, -0.85);
    this.camera.add(this.muzzleLight);

    this.headlamp = new THREE.PointLight(0xffe7c2, 0, 24, 1.4);
    this.headlamp.position.set(0, 0.1, -0.2);
    this.camera.add(this.headlamp);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.startLoop();
  }

  public setMapLayout(mode: MapMode, seed: number, dugCells?: number[]): void {
    this.mapLayout = generateMapLayout(mode, seed);
    this.digHp = createInitialUndergroundHp(this.mapLayout);
    if (dugCells && mode === 'underground') {
      for (const idx of dugCells) {
        if (idx >= 0 && idx < this.digHp.length) {
          this.digHp[idx] = 0;
        }
      }
    }

    this.scene.remove(this.arenaWorld.root);
    this.arenaWorld.dispose();
    this.arenaWorld = buildArenaEnvironment(this.textures, this.mapLayout, this.digHp);
    this.scene.add(this.arenaWorld.root);

    this.headlamp.intensity = mode === 'underground' ? 4.4 : 0;
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = mode === 'underground' ? 0.017 : 0.0105;
    }
  }

  public applyDigUpdate(index: number, hp: number, pos?: { x: number; z: number }): void {
    if (this.mapLayout.mode !== 'underground') return;
    if (index >= 0 && index < this.digHp.length) {
      this.digHp[index] = hp;
    }
    this.arenaWorld.updateDigCell(index, hp);

    const bounds = getUndergroundCellBounds(index);
    const cx = pos?.x ?? (bounds.minX + bounds.maxX) * 0.5;
    const cz = pos?.z ?? (bounds.minZ + bounds.maxZ) * 0.5;
    this.spawnSparkBurst(_v1.set(cx, 1.5, cz), 0xa16207, hp <= 0 ? 10 : 5, 6.2, 0.34, 18);

    const dist = Math.hypot(cx - this.pos.x, cz - this.pos.z);
    if (dist < 24) {
      soundEngine.playImpact(Math.max(0.12, 1 - dist / 24) * 0.55);
    }
  }

  public getDigHpSnapshot(): Uint8Array {
    return this.digHp;
  }

  private rebuildViewmodels(team: TeamId): void {
    for (const rig of this.viewmodels.values()) {
      this.viewmodelAnchor.remove(rig.root);
    }
    this.viewmodels.clear();
    for (const id of WEAPON_ORDER) {
      const rig = createWeaponViewmodel(id, team);
      rig.root.visible = id === this.currentViewWeapon;
      this.viewmodelAnchor.add(rig.root);
      this.viewmodels.set(id, rig);
    }
  }

  private emitPose(): void {
    const scopeType = this.activeWeaponStats.scopeType;
    const key = `${this.crouching}|${this.aiming}|${this.currentViewWeapon}|${scopeType}`;
    if (key !== this.lastPoseKey) {
      this.lastPoseKey = key;
      this.callbacks.onPoseChange?.({
        crouching: this.crouching,
        aiming: this.aiming,
        weaponId: this.currentViewWeapon,
        scopeType,
      });
    }
  }

  public applySettings(settings: { sensitivityScale: number; baseFov: number }): void {
    this.baseSensitivity = 0.0021 * THREE.MathUtils.clamp(settings.sensitivityScale, 0.3, 3.0);
    this.baseFov = THREE.MathUtils.clamp(settings.baseFov, 60, 100);
    if (!this.aiming) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
  }

  public setPlayingMode(playing: boolean, playerId: string | null, team: TeamId): void {
    this.isPlaying = playing;
    this.localPlayerId = playerId;
    if (this.localTeam !== team) {
      this.localTeam = team;
      this.rebuildViewmodels(team);
    }
    this.viewmodelAnchor.visible = playing;
    if (!playing) {
      this.unlockPointer();
      this.alive = false;
      this.crouching = false;
      this.aiming = false;
      this.paused = false;
      this.mouseDown = false;
      this.emitPose();
      // Clear remote actors, projectiles, and smoke clouds when returning to lobby
      for (const entry of this.remoteActors.values()) {
        this.scene.remove(entry.rig.root);
      }
      this.remoteActors.clear();
      this.clearGadgetMeshes();
    }
  }

  private clearGadgetMeshes(): void {
    for (const entry of this.projectileMeshes.values()) {
      this.scene.remove(entry.mesh);
    }
    this.projectileMeshes.clear();
    for (const entry of this.smokeMeshes.values()) {
      this.scene.remove(entry.group);
    }
    this.smokeMeshes.clear();
    if (this.insideSmoke) {
      this.insideSmoke = false;
      this.callbacks.onSmokeStateChange?.(false);
    }
  }

  public snapToActor(actor: ActorSnapshot): void {
    this.pos.set(actor.x, actor.y, actor.z);
    this.yaw = actor.yaw;
    this.pitch = actor.pitch;
    this.vy = 0;
    this.alive = actor.alive;
    this.crouching = Boolean(actor.crouching);
    this.eyeHeight = this.crouching ? 0.98 : 1.58;
    this.aiming = false;
    this.emitPose();
  }

  public setShopOpen(open: boolean): void {
    this.shopOpen = open;
    if (open) {
      this.mouseDown = false;
      this.aiming = false;
      this.emitPose();
      this.unlockPointer();
    }
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.mouseDown = false;
      this.aiming = false;
      this.keys = {};
      this.emitPose();
      this.unlockPointer();
    }
  }

  public requestPointerLock(): void {
    if (!this.isPlaying || this.shopOpen || this.paused) return;
    soundEngine.unlock();
    this.renderer.domElement.requestPointerLock?.();
  }

  public unlockPointer(): void {
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }
  }

  public applyServerSync(state: StateSyncPayload): void {
    if (!this.isPlaying) return;

    const seenIds = new Set<string>();
    const enemyTeam: TeamId = this.localTeam === 'red' ? 'blue' : 'red';
    const enemyFlag = state.flags[enemyTeam];
    this.carryingEnemyFlag = enemyFlag.carrierId === this.localPlayerId;

    for (const actor of state.actors) {
      if (actor.id === this.localPlayerId) {
        // Sync authoritative health, alive/respawn snap, weapon stats
        const wasAlive = this.alive;
        this.alive = actor.alive;
        this.localAmmo = actor.ammo;
        this.localReloading = actor.reloading;
        this.localSlowed = Boolean(actor.slowed);
        this.localActiveGadget = actor.activeGadget ?? 'frag';
        this.localGadgets = actor.gadgets ?? {};
        this.ownedWeaponsList = Object.keys(actor.ownedWeapons) as WeaponId[];

        if (this.localTeam !== actor.team) {
          this.localTeam = actor.team;
          this.rebuildViewmodels(actor.team);
        }

        if (this.currentViewWeapon !== actor.activeWeapon) {
          this.currentViewWeapon = actor.activeWeapon;
          for (const [wid, rig] of this.viewmodels.entries()) {
            rig.root.visible = wid === actor.activeWeapon;
          }
        }
        this.activeWeaponStats = getEffectiveWeaponStats(
          actor.activeWeapon,
          actor.ownedWeapons[actor.activeWeapon],
        );

        if (!wasAlive && actor.alive) {
          this.pos.set(actor.x, actor.y, actor.z);
          this.yaw = actor.yaw;
          this.pitch = actor.pitch;
          this.vy = 0;
          this.crouching = false;
          this.eyeHeight = 1.58;
        }
        if (!actor.alive) {
          this.aiming = false;
          this.crouching = false;
          this.mouseDown = false;
        }
        this.emitPose();
        continue;
      }

      seenIds.add(actor.id);
      let entry = this.remoteActors.get(actor.id);
      if (!entry) {
        const rig = createTrooperRig(actor.team, actor.name, actor.isBot, this.textures.contactShadow);
        rig.root.position.set(actor.x, actor.y, actor.z);
        this.scene.add(rig.root);
        entry = {
          rig,
          targetPos: new THREE.Vector3(actor.x, actor.y, actor.z),
          targetYaw: actor.yaw,
          targetPitch: actor.pitch,
          crouching: Boolean(actor.crouching),
          team: actor.team,
          name: actor.name,
        };
        this.remoteActors.set(actor.id, entry);
      } else if (entry.team !== actor.team) {
        this.scene.remove(entry.rig.root);
        const rig = createTrooperRig(actor.team, actor.name, actor.isBot, this.textures.contactShadow);
        rig.root.position.set(actor.x, actor.y, actor.z);
        this.scene.add(rig.root);
        entry.rig = rig;
        entry.team = actor.team;
      }

      entry.rig.root.visible = actor.alive;
      entry.targetPos.set(actor.x, actor.y, actor.z);
      entry.targetYaw = actor.yaw;
      entry.targetPitch = actor.pitch;
      entry.crouching = Boolean(actor.crouching);
      entry.rig.updateHealth(actor.hp, actor.maxHp);

      const carryingRed = state.flags.red.carrierId === actor.id;
      const carryingBlue = state.flags.blue.carrierId === actor.id;
      entry.rig.setCarriedFlag(carryingRed ? 'red' : carryingBlue ? 'blue' : null);
    }

    // Remove disconnected actors
    for (const [id, entry] of this.remoteActors.entries()) {
      if (!seenIds.has(id)) {
        this.scene.remove(entry.rig.root);
        this.remoteActors.delete(id);
      }
    }

    // Update World Flag Meshes
    (['red', 'blue'] as TeamId[]).forEach((team) => {
      const flagState = state.flags[team];
      const mesh = this.flagMeshes[team];
      // Hide world flag when carried (carrier rig shows it on back, or local HUD shows it)
      if (flagState.status === 'carried') {
        mesh.visible = false;
      } else {
        mesh.visible = true;
        mesh.position.set(flagState.x, flagState.y, flagState.z);
      }
    });

    // Sync Projectiles
    const seenProj = new Set<string>();
    for (const p of state.projectiles ?? []) {
      seenProj.add(p.id);
      let entry = this.projectileMeshes.get(p.id);
      if (!entry) {
        const mesh = createGrenadeMesh(p.type);
        mesh.position.set(p.x, p.y, p.z);
        this.scene.add(mesh);
        entry = {
          mesh,
          targetPos: new THREE.Vector3(p.x, p.y, p.z),
          vel: new THREE.Vector3(p.vx, p.vy, p.vz),
        };
        this.projectileMeshes.set(p.id, entry);
      } else {
        entry.targetPos.set(p.x, p.y, p.z);
        entry.vel.set(p.vx, p.vy, p.vz);
      }
    }
    for (const [id, entry] of this.projectileMeshes.entries()) {
      if (!seenProj.has(id)) {
        this.scene.remove(entry.mesh);
        this.projectileMeshes.delete(id);
      }
    }

    // Sync Smoke Zones
    const seenSmoke = new Set<string>();
    for (const z of state.smokeZones ?? []) {
      seenSmoke.add(z.id);
      let entry = this.smokeMeshes.get(z.id);
      if (!entry) {
        const cloud = createSmokeCloudGroup(z.radius);
        cloud.group.position.set(z.x, z.y, z.z);
        this.scene.add(cloud.group);
        entry = {
          group: cloud.group,
          materials: cloud.materials,
          x: z.x,
          y: z.y,
          z: z.z,
          radius: z.radius,
          remainingSec: z.remainingSec,
          maxSec: z.maxSec,
        };
        this.smokeMeshes.set(z.id, entry);
      } else {
        entry.remainingSec = z.remainingSec;
        entry.maxSec = z.maxSec;
      }
    }
    for (const [id, entry] of this.smokeMeshes.entries()) {
      if (!seenSmoke.has(id)) {
        this.scene.remove(entry.group);
        this.smokeMeshes.delete(id);
      }
    }
  }

  public triggerGadgetFx(ev: GadgetFxEvent): void {
    const pos = _v1.set(ev.x, ev.y, ev.z);
    const dist = pos.distanceTo(this.pos);

    if (ev.kind === 'throw') {
      if (ev.shooterId !== this.localPlayerId && dist < 32) {
        soundEngine.playThrow(Math.max(0.15, 1 - dist / 32) * 0.75);
      }
      return;
    }

    const atten = Math.max(0.12, 1 - dist / 48);
    if (ev.type === 'frag') {
      if (dist < 48) soundEngine.playExplosion(atten);
      this.spawnSparkBurst(pos, 0xf97316, 22, 13.5, 0.5, 18);
      this.spawnSparkBurst(pos, 0xfbbf24, 14, 9.5, 0.38, 12);
      this.spawnShockwaveRing(pos, 0xf97316, 11.5, 0.36);
      this.spawnShockwaveRing(pos, 0xfef08a, 7.0, 0.25);
      if (dist < 18) {
        const shake = Math.max(0, 1 - dist / 18) * 0.08;
        this.cameraShake = Math.max(this.cameraShake, shake);
        this.fovPunch = Math.max(this.fovPunch, shake * 40);
      }
    } else if (ev.type === 'smoke') {
      if (dist < 42) soundEngine.playSmokeDeploy(atten);
      this.spawnSparkBurst(pos, 0xcbd5e1, 14, 5.5, 0.55, 4);
      this.spawnShockwaveRing(pos, 0xe2e8f0, 8.5, 0.38);
    } else if (ev.type === 'emp') {
      if (dist < 46) soundEngine.playEmpBlast(atten);
      this.spawnSparkBurst(pos, 0xa855f7, 20, 11.5, 0.44, 8);
      this.spawnSparkBurst(pos, 0x38bdf8, 12, 9.0, 0.38, 6);
      this.spawnShockwaveRing(pos, 0xa855f7, 13.0, 0.34);
      this.spawnShockwaveRing(pos, 0x38bdf8, 9.2, 0.24);
      if (dist < 16) {
        this.cameraShake = Math.max(this.cameraShake, (1 - dist / 16) * 0.045);
      }
    }
  }

  public triggerHitConfirmFeedback(headshot: boolean, killed: boolean): void {
    if (killed) {
      this.cameraShake = Math.max(this.cameraShake, 0.024);
      this.fovPunch = Math.max(this.fovPunch, 2.2);
    } else if (headshot) {
      this.cameraShake = Math.max(this.cameraShake, 0.014);
      this.fovPunch = Math.max(this.fovPunch, 1.1);
    }
  }

  public triggerDamageFeedback(headshot = false): void {
    soundEngine.playDamageTaken(headshot);
    this.cameraShake = Math.max(this.cameraShake, headshot ? 0.048 : 0.03);
    this.punchPitch += headshot ? 0.032 : 0.018;
    this.punchYaw += (Math.random() - 0.5) * (headshot ? 0.045 : 0.026);
    this.fovPunch = Math.max(this.fovPunch, 1.6);
  }

  private spawnShockwaveRing(
    pos: THREE.Vector3,
    colorHex: string | number,
    endScale: number,
    duration = 0.24,
  ): void {
    if (this.rings.length >= 28) return;
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.copy(pos);
    mesh.lookAt(this.camera.position);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: duration, maxLife: duration, endScale });
  }

  private spawnSparkBurst(
    pos: THREE.Vector3,
    colorHex: string | number,
    count: number,
    speed = 7.5,
    life = 0.3,
    gravity = 18,
  ): void {
    const budget = Math.max(0, 150 - this.sparks.length);
    const n = Math.min(count, budget);
    for (let i = 0; i < n; i++) {
      const sMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sMesh = new THREE.Mesh(this.sparkGeo, sMat);
      sMesh.position.copy(pos);
      const vx = (Math.random() - 0.5) * speed * 1.6;
      const vy = Math.random() * speed * 0.9 + 1.2;
      const vz = (Math.random() - 0.5) * speed * 1.6;
      sMesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      this.scene.add(sMesh);
      this.sparks.push({
        mesh: sMesh,
        vel: new THREE.Vector3(vx, vy, vz),
        life,
        maxLife: life,
        gravity,
      });
    }
  }

  public spawnTracer(ev: TracerEvent): void {
    const start = _v1.set(ev.from.x, ev.from.y, ev.from.z);
    const end = _v2.set(ev.to.x, ev.to.y, ev.to.z);

    // If local player shot, originate visually from muzzleNode only when target is well ahead of muzzle
    if (ev.shooterId === this.localPlayerId) {
      const camDist = start.distanceTo(end);
      const rig = this.viewmodels.get(this.currentViewWeapon);
      if (rig && camDist > 1.6) {
        rig.muzzleNode.getWorldPosition(start);
      }
    }

    const diff = _v3.subVectors(end, start);
    const dist = diff.length();
    if (dist < 0.05) return;

    const colorHex = WEAPONS[ev.weaponId]?.tracerColor ?? '#38bdf8';
    const isSniper = ev.weaponId === 'sniper';
    const isPlasma = ev.weaponId === 'plasma';
    const life = isSniper ? 0.22 : isPlasma ? 0.2 : ev.weaponId === 'burst' ? 0.16 : 0.12;
    const widthScale = isPlasma
      ? 2.35
      : isSniper
        ? 2.2
        : ev.weaponId === 'shotgun'
          ? 0.85
          : ev.weaponId === 'gatling'
            ? 0.95
            : 1.15;

    const quat = new THREE.Quaternion().setFromUnitVectors(_up, diff.normalize());

    // Outer additive energy beam
    const outerMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.tracerGeo, outerMat);
    mesh.position.copy(start).addScaledVector(diff, dist * 0.5);
    mesh.scale.set(widthScale, dist, widthScale);
    mesh.quaternion.copy(quat);
    this.scene.add(mesh);

    // Inner bright core
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreMesh = new THREE.Mesh(this.tracerCoreGeo, coreMat);
    coreMesh.position.copy(mesh.position);
    coreMesh.scale.set(widthScale, dist, widthScale);
    coreMesh.quaternion.copy(quat);
    this.scene.add(coreMesh);

    this.tracers.push({ mesh, coreMesh, life, maxLife: life });

    // Impact VFX
    if (ev.hitActorId) {
      const hitEntry = this.remoteActors.get(ev.hitActorId);
      if (hitEntry) {
        hitEntry.rig.flashHit(Boolean(ev.headshot));
      }

      if (ev.killed) {
        const teamColor = ev.team === 'red' ? 0x06b6d4 : 0xef4444;
        this.spawnSparkBurst(end, 0xfbbf24, 12, 9.5, 0.42, 14);
        this.spawnSparkBurst(end, teamColor, 10, 8.0, 0.48, 10);
        this.spawnShockwaveRing(end, 0xfbbf24, 5.2, 0.32);
        this.spawnShockwaveRing(end, teamColor, 3.6, 0.24);
      } else {
        const sparkCount = ev.headshot ? 11 : 6;
        const sparkColor = ev.headshot ? 0xf43f5e : 0xfbbf24;
        this.spawnSparkBurst(end, sparkColor, sparkCount, 6.8, 0.28, 18);
        this.spawnShockwaveRing(end, sparkColor, ev.headshot ? 2.4 : 1.4, 0.16);
      }
    } else {
      // Wall/obstacle impact sparks & ring
      this.spawnSparkBurst(end, colorHex, 4, 5.2, 0.24, 20);
      this.spawnShockwaveRing(end, colorHex, isSniper ? 2.0 : 1.0, 0.15);
      const impactDist = end.distanceTo(this.pos);
      if (impactDist < 20 && Math.random() < 0.55) {
        soundEngine.playImpact(Math.max(0.08, 1 - impactDist / 20) * 0.45);
      }
    }

    // Spatial gunshot sound for remote actors
    if (ev.shooterId !== this.localPlayerId) {
      const d = start.distanceTo(this.pos);
      if (d < 45) {
        soundEngine.playShoot(ev.weaponId, Math.max(0.1, 1 - d / 45) * 0.55);
      }
    }
  }

  private tryFireLocal(): void {
    if (!this.isPlaying || !this.alive || !this.pointerLocked || this.shopOpen || this.paused) return;
    if (this.localReloading || this.localAmmo <= 0) {
      if (!this.localReloading && this.localAmmo <= 0) {
        this.callbacks.onReload();
        soundEngine.playReload();
      }
      return;
    }

    const now = performance.now();
    if (now - this.lastLocalShotTime < this.activeWeaponStats.fireInterval * 1000) return;

    this.lastLocalShotTime = now;
    const wid = this.activeWeaponStats.id;
    const heavy = wid === 'sniper' || wid === 'shotgun' || wid === 'plasma';
    const recoilScale = this.aiming ? 0.68 : 1.0;
    this.recoilOffset = (heavy ? 0.15 : wid === 'rifle' || wid === 'burst' ? 0.085 : wid === 'gatling' ? 0.045 : 0.065) * recoilScale;
    this.flashTimer = 0.06;

    // Camera recoil punch & muzzle dynamic lighting
    const basePitch =
      wid === 'sniper'
        ? 0.036
        : wid === 'plasma'
          ? 0.03
          : wid === 'shotgun'
            ? 0.032
            : wid === 'burst'
              ? 0.016
              : wid === 'rifle'
                ? 0.014
                : wid === 'gatling'
                  ? 0.0085
                  : 0.009;
    this.punchPitch += basePitch * recoilScale;
    this.punchYaw += (Math.random() - 0.5) * (heavy ? 0.018 : 0.008) * recoilScale;
    this.cameraShake = Math.max(this.cameraShake, heavy ? 0.022 : wid === 'gatling' ? 0.01 : 0.007);
    this.fovPunch = Math.max(this.fovPunch, wid === 'sniper' || wid === 'plasma' ? 2.2 : wid === 'shotgun' ? 1.8 : 0.42);
    this.muzzleLight.color.set(this.activeWeaponStats.tracerColor);
    this.muzzleLight.intensity = this.isSoftwareGl ? 0 : heavy ? 9 : 6;

    soundEngine.playShoot(wid, 1);

    const origin = {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
    };
    this.camera.getWorldDirection(_v1);
    this.callbacks.onShoot(origin, { x: _v1.x, y: _v1.y, z: _v1.z }, this.aiming);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys[e.code] = true;

    if (!this.isPlaying) return;

    if (e.code === 'Escape') {
      e.preventDefault();
      this.callbacks.onEscapeKey?.();
      return;
    }

    if (e.code === 'KeyB' && !this.paused) {
      e.preventDefault();
      this.callbacks.onOpenShopKey();
      return;
    }
    if (e.code === 'Tab' && !this.paused) {
      e.preventDefault();
      this.callbacks.onScoreboardKey(true);
      return;
    }

    if (this.shopOpen || this.paused) return;

    if (e.code === 'KeyC' && !e.repeat && this.alive && this.pointerLocked) {
      this.crouching = !this.crouching;
      this.emitPose();
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      if (this.grounded && this.alive && this.pointerLocked) {
        if (this.crouching) {
          this.crouching = false;
          this.emitPose();
        }
        this.vy = 8.4;
        this.grounded = false;
        soundEngine.playJump();
      }
      return;
    }

    if (e.code === 'KeyE' && this.alive && this.pointerLocked) {
      this.tryDigLocal();
      return;
    }

    if (e.code === 'KeyG' && !e.repeat && this.alive && this.pointerLocked) {
      const activeCount = this.localGadgets[this.localActiveGadget] ?? 0;
      if (activeCount > 0) {
        const now = performance.now();
        if (now - this.lastGadgetThrowTime >= 450) {
          this.lastGadgetThrowTime = now;
          this.camera.getWorldDirection(_v1);
          soundEngine.playThrow(1);
          this.recoilOffset = Math.max(this.recoilOffset, 0.08);
          this.callbacks.onThrowGadget?.(
            {
              x: this.camera.position.x,
              y: this.camera.position.y,
              z: this.camera.position.z,
            },
            { x: _v1.x, y: _v1.y, z: _v1.z },
          );
        }
      }
      return;
    }

    if (e.code === 'KeyQ' && !e.repeat && this.alive && this.pointerLocked) {
      const owned = GADGET_ORDER.filter((g) => (this.localGadgets[g] ?? 0) > 0);
      const pool = owned.length > 0 ? owned : GADGET_ORDER;
      const curIdx = pool.indexOf(this.localActiveGadget);
      const next = pool[(curIdx + 1) % pool.length];
      if (next && next !== this.localActiveGadget) {
        this.localActiveGadget = next;
        this.callbacks.onSwitchGadget?.(next);
      }
      return;
    }

    if (e.code === 'KeyR' && this.alive) {
      this.aiming = false;
      this.emitPose();
      this.callbacks.onReload();
      soundEngine.playReload();
    }

    const digitIndexMap: Record<string, number> = {
      Digit1: 0,
      Digit2: 1,
      Digit3: 2,
      Digit4: 3,
      Digit5: 4,
      Digit6: 5,
      Digit7: 6,
      Digit8: 7,
    };
    const slotIdx = digitIndexMap[e.code];
    if (slotIdx !== undefined) {
      const w = WEAPON_ORDER[slotIdx];
      if (w && this.ownedWeaponsList.includes(w)) {
        this.aiming = false;
        this.emitPose();
        this.callbacks.onSwitchWeapon(w);
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false;
    if (e.code === 'Tab') {
      this.callbacks.onScoreboardKey(false);
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked || !this.isPlaying || this.shopOpen || this.paused || !this.alive) return;
    const zoomScale = this.camera.fov / Math.max(40, this.baseFov);
    const sens = this.baseSensitivity * zoomScale;
    this.yaw -= e.movementX * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * sens, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.isPlaying || this.shopOpen || this.paused) return;
    if (e.button === 2) {
      if (this.pointerLocked && this.alive && !this.localReloading) {
        this.aiming = true;
        this.emitPose();
      }
      return;
    }
    if (e.button !== 0) return;
    if (!this.pointerLocked) {
      if (e.target === this.renderer.domElement) {
        this.requestPointerLock();
      }
      return;
    }
    this.mouseDown = true;
    this.tryFireLocal();
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
    if (e.button === 2) {
      if (this.aiming) {
        this.aiming = false;
        this.emitPose();
      }
    }
  };

  private onContextMenu = (e: MouseEvent) => {
    if (this.isPlaying && !this.shopOpen && !this.paused) {
      e.preventDefault();
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.isPlaying || !this.pointerLocked || this.shopOpen || this.paused || this.ownedWeaponsList.length <= 1) return;
    const idx = this.ownedWeaponsList.indexOf(this.currentViewWeapon);
    const nextIdx = (idx + (e.deltaY > 0 ? 1 : -1) + this.ownedWeaponsList.length) % this.ownedWeaponsList.length;
    this.aiming = false;
    this.emitPose();
    this.callbacks.onSwitchWeapon(this.ownedWeaponsList[nextIdx]);
  };

  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    if (!this.pointerLocked) {
      this.mouseDown = false;
      this.aiming = false;
      this.keys = {};
      this.emitPose();
    }
    this.callbacks.onPointerLockChange(this.pointerLocked);
  };

  private onWindowBlur = () => {
    this.mouseDown = false;
    this.aiming = false;
    this.keys = {};
    this.emitPose();
  };

  private onResize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
  };

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('resize', this.onResize);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
  }

  private startLoop(): void {
    const afterDraw = (cb: () => void) => {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (this.disposed) return;
      const dt = Math.min(0.05, this.clock.getDelta());
      this.elapsed += dt;

      this.update(dt);
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      afterDraw(tick);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  private update(dt: number): void {
    if (this.paused && this.isPlaying) {
      return;
    }

    // Rotate Flag Meshes gently
    this.flagMeshes.red.rotation.y += dt * 1.4;
    this.flagMeshes.blue.rotation.y -= dt * 1.4;

    if (!this.isPlaying) {
      // Smooth Lobby Flyover Camera
      const angle = this.elapsed * 0.14;
      this.camera.position.set(Math.cos(angle) * 44, 19 + Math.sin(angle * 0.7) * 3, Math.sin(angle) * 34);
      this.camera.lookAt(0, 2, 0);
      return;
    }

    // Automatic firing when holding mouse
    if (this.mouseDown && this.activeWeaponStats.automatic) {
      this.tryFireLocal();
    }
    if (this.keys['KeyE'] && this.mapLayout.mode === 'underground') {
      this.tryDigLocal();
    }

    let sprintingMoving = false;

    // Local Player Movement
    if (this.alive && this.pointerLocked && !this.shopOpen) {
      const forwardX = -Math.sin(this.yaw);
      const forwardZ = -Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);

      let moveX = 0;
      let moveZ = 0;
      if (this.keys['KeyW']) {
        moveX += forwardX;
        moveZ += forwardZ;
      }
      if (this.keys['KeyS']) {
        moveX -= forwardX;
        moveZ -= forwardZ;
      }
      if (this.keys['KeyD']) {
        moveX += rightX;
        moveZ += rightZ;
      }
      if (this.keys['KeyA']) {
        moveX -= rightX;
        moveZ -= rightZ;
      }

      const len = Math.hypot(moveX, moveZ);
      const sprinting = Boolean(this.keys['ShiftLeft'] || this.keys['ShiftRight']) && !this.crouching && !this.aiming;
      sprintingMoving = sprinting && len > 0.001;
      if (len > 0.001) {
        moveX /= len;
        moveZ /= len;
        const baseSpeed = sprinting ? 8.2 : 6.0;
        const flagMult = this.carryingEnemyFlag ? 0.9 : 1.0;
        const crouchMult = this.crouching ? 0.62 : 1.0;
        const adsMult = this.aiming ? 0.72 : 1.0;
        const empMult = this.localSlowed ? 0.6 : 1.0;
        const speed = baseSpeed * this.activeWeaponStats.moveSpeedMult * flagMult * crouchMult * adsMult * empMult;

        const prevX = this.pos.x;
        const prevZ = this.pos.z;
        const nextX = this.pos.x + moveX * speed * dt;
        const nextZ = this.pos.z + moveZ * speed * dt;
        const resolved = resolveHorizontalCollision(nextX, this.pos.y, nextZ, 0.48, this.mapLayout, this.digHp);
        this.pos.x = resolved.x;
        this.pos.z = resolved.z;

        if (this.grounded) {
          this.walkBobPhase += dt * (sprinting ? 11 : this.crouching ? 6.5 : 8.5);
          this.stepDistAccum += Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
          const stepStride = sprinting ? 2.1 : 2.5;
          if (this.stepDistAccum >= stepStride && !this.crouching) {
            this.stepDistAccum = 0;
            soundEngine.playFootstep(sprinting);
          }
        }
      }
    }

    // Smooth crouch eye height & ADS / Sprint FOV
    const targetEye = this.crouching ? 0.98 : 1.58;
    this.eyeHeight = THREE.MathUtils.damp(this.eyeHeight, targetEye, 15, dt);

    if (this.alive) {
      const targetBaseFov = this.aiming
        ? this.activeWeaponStats.adsFov
        : sprintingMoving
          ? this.baseFov + 5
          : this.baseFov;
      const targetFov = targetBaseFov + this.fovPunch;
      if (Math.abs(this.camera.fov - targetFov) > 0.04) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, this.aiming ? 18 : 14, dt);
        this.camera.updateProjectionMatrix();
      }
    }

    // Gravity & Ground Collision
    const wasGrounded = this.grounded;
    const prevVy = this.vy;
    this.vy -= 22 * dt;
    this.pos.y += this.vy * dt;
    const groundY = getGroundHeightAt(this.pos.x, this.pos.z, this.pos.y, this.mapLayout);
    if (this.pos.y <= groundY) {
      this.pos.y = groundY;
      this.vy = 0;
      this.grounded = true;
      if (!wasGrounded && prevVy < -4.5 && this.alive) {
        soundEngine.playLand();
        this.cameraShake = Math.max(this.cameraShake, 0.012);
        this.spawnSparkBurst(_v1.set(this.pos.x, this.pos.y + 0.08, this.pos.z), 0x94a3b8, 4, 3.2, 0.22, 16);
      }
    } else {
      this.grounded = false;
    }

    // Continuous jump while holding Spacebar (simultaneous with WASD movement)
    if (this.keys['Space'] && this.grounded && this.alive && this.pointerLocked && !this.shopOpen && !this.paused) {
      if (this.crouching) {
        this.crouching = false;
        this.emitPose();
      }
      this.vy = 8.4;
      this.grounded = false;
      soundEngine.playJump();
    }

    // Always resolve horizontal bounds & obstacle sliding
    if (this.alive) {
      const clamped = resolveHorizontalCollision(this.pos.x, this.pos.y, this.pos.z, 0.48, this.mapLayout, this.digHp);
      this.pos.x = clamped.x;
      this.pos.z = clamped.z;
    }

    // Decay camera recoil, shake & FOV punch
    this.punchPitch = THREE.MathUtils.damp(this.punchPitch, 0, 14, dt);
    this.punchYaw = THREE.MathUtils.damp(this.punchYaw, 0, 14, dt);
    this.cameraShake = THREE.MathUtils.damp(this.cameraShake, 0, 18, dt);
    this.fovPunch = THREE.MathUtils.damp(this.fovPunch, 0, 16, dt);
    this.muzzleLight.intensity = THREE.MathUtils.damp(this.muzzleLight.intensity, 0, 45, dt);

    // Update Camera Transform
    const bobScale = this.aiming ? 0.18 : this.crouching ? 0.55 : 1.0;
    const bobY = this.grounded ? Math.sin(this.walkBobPhase) * 0.035 * bobScale : 0;
    const bobX = this.grounded ? Math.cos(this.walkBobPhase * 0.5) * 0.02 * bobScale : 0;
    const shakeX = (Math.random() - 0.5) * this.cameraShake;
    const shakeY = (Math.random() - 0.5) * this.cameraShake;
    if (this.alive) {
      this.camera.position.set(this.pos.x + shakeX, this.pos.y + this.eyeHeight + bobY + shakeY, this.pos.z);
      _euler.set(
        THREE.MathUtils.clamp(this.pitch + this.punchPitch, -Math.PI / 2 + 0.03, Math.PI / 2 - 0.03),
        this.yaw + this.punchYaw,
        0,
        'YXZ',
      );
      this.camera.quaternion.setFromEuler(_euler);
    } else {
      // Elevated death spectate angle
      this.camera.position.set(this.pos.x, this.pos.y + 5.5, this.pos.z + 4);
      this.camera.lookAt(this.pos.x, this.pos.y + 1, this.pos.z);
    }

    // Viewmodel Recoil, ADS Centering, Reload Tilt, Gatling Spin & Muzzle Flash
    this.recoilOffset = THREE.MathUtils.damp(this.recoilOffset, 0, 18, dt);
    const hideForScope = this.aiming && this.activeWeaponStats.scopeType === 'sniper' && !this.localReloading;
    this.viewmodelAnchor.visible = this.alive && !hideForScope;

    const reloadTilt = this.localReloading ? -0.55 : 0;
    const targetVmX = this.aiming && !this.localReloading ? 0 : 0.27;
    const targetVmY = this.aiming && !this.localReloading ? -0.155 : -0.24;
    const targetVmZ = this.aiming && !this.localReloading ? -0.34 : -0.44;
    this.viewmodelAnchor.position.set(
      THREE.MathUtils.damp(this.viewmodelAnchor.position.x, targetVmX + bobX * 0.4, 18, dt),
      THREE.MathUtils.damp(
        this.viewmodelAnchor.position.y,
        targetVmY + bobY * 0.35 - (this.localReloading ? 0.08 : 0),
        18,
        dt,
      ),
      THREE.MathUtils.damp(this.viewmodelAnchor.position.z, targetVmZ + this.recoilOffset, 18, dt),
    );
    this.viewmodelAnchor.rotation.x = THREE.MathUtils.damp(
      this.viewmodelAnchor.rotation.x,
      this.recoilOffset * 2.1 + reloadTilt,
      16,
      dt,
    );

    const activeRig = this.viewmodels.get(this.currentViewWeapon);
    if (activeRig) {
      if (activeRig.spinnerNode) {
        const spinning =
          this.mouseDown &&
          !this.localReloading &&
          this.localAmmo > 0 &&
          this.pointerLocked &&
          !this.shopOpen &&
          !this.paused;
        this.gatlingSpinVel = THREE.MathUtils.damp(this.gatlingSpinVel, spinning ? 26 : 0, spinning ? 14 : 4, dt);
        activeRig.spinnerNode.rotation.z += this.gatlingSpinVel * dt;
      }

      if (this.flashTimer > 0) {
        this.flashTimer -= dt;
        const mat = activeRig.muzzleFlash.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.95;
        activeRig.muzzleFlash.scale.setScalar(0.9 + Math.random() * 0.5);
        activeRig.muzzleFlash.rotation.z += dt * 45;
      } else {
        (activeRig.muzzleFlash.material as THREE.MeshBasicMaterial).opacity = 0;
      }
    }

    // Report local state to server at ~20Hz
    const now = performance.now();
    if (now - this.lastReportTime >= 45 && this.alive) {
      this.lastReportTime = now;
      this.callbacks.onStateReport({
        x: this.pos.x,
        y: this.pos.y,
        z: this.pos.z,
        yaw: this.yaw,
        pitch: this.pitch,
        crouching: this.crouching,
      });
    }

    // Interpolate Remote Actors
    for (const entry of this.remoteActors.values()) {
      const prevX = entry.rig.root.position.x;
      const prevZ = entry.rig.root.position.z;
      entry.rig.root.position.x = THREE.MathUtils.damp(entry.rig.root.position.x, entry.targetPos.x, 14, dt);
      entry.rig.root.position.y = THREE.MathUtils.damp(entry.rig.root.position.y, entry.targetPos.y, 16, dt);
      entry.rig.root.position.z = THREE.MathUtils.damp(entry.rig.root.position.z, entry.targetPos.z, 14, dt);

      // Shortest-angle yaw damping
      let diff = entry.targetYaw - entry.rig.bodyGroup.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      entry.rig.bodyGroup.rotation.y += diff * Math.min(1, dt * 14);

      const moveDist = Math.hypot(entry.rig.root.position.x - prevX, entry.rig.root.position.z - prevZ);
      entry.rig.animateWalk(moveDist / Math.max(0.001, dt), this.elapsed, entry.targetPitch, entry.crouching);
      entry.rig.updateFlash(dt);

      // Billboard HP bar to camera
      entry.rig.hpFillMesh.lookAt(this.camera.position);
      const hpBg = entry.rig.root.children[entry.rig.root.children.length - 2];
      hpBg?.lookAt(this.camera.position);
    }

    // Update Tracers, Sparks & Shockwave Rings
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        this.scene.remove(t.coreMesh);
        (t.mesh.material as THREE.Material).dispose();
        (t.coreMesh.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      } else {
        const alpha = t.life / t.maxLife;
        (t.mesh.material as THREE.MeshBasicMaterial).opacity = alpha * 0.85;
        (t.coreMesh.material as THREE.MeshBasicMaterial).opacity = alpha;
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        (s.mesh.material as THREE.Material).dispose();
        this.sparks.splice(i, 1);
      } else {
        s.vel.y -= s.gravity * dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        s.mesh.rotation.x += dt * 12;
        s.mesh.rotation.y += dt * 9;
        const alpha = s.life / s.maxLife;
        s.mesh.scale.setScalar(0.5 + alpha * 0.7);
        (s.mesh.material as THREE.MeshBasicMaterial).opacity = alpha;
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      } else {
        const progress = 1 - r.life / r.maxLife;
        const sc = 0.5 + progress * r.endScale;
        r.mesh.scale.setScalar(sc);
        r.mesh.lookAt(this.camera.position);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.85;
      }
    }

    // Update Projectiles & Smoke Clouds
    for (const p of this.projectileMeshes.values()) {
      p.targetPos.addScaledVector(p.vel, dt * 0.65);
      p.mesh.position.x = THREE.MathUtils.damp(p.mesh.position.x, p.targetPos.x, 20, dt);
      p.mesh.position.y = THREE.MathUtils.damp(p.mesh.position.y, p.targetPos.y, 20, dt);
      p.mesh.position.z = THREE.MathUtils.damp(p.mesh.position.z, p.targetPos.z, 20, dt);
      p.mesh.rotation.x += dt * 9;
      p.mesh.rotation.z += dt * 7;
    }

    let nowInSmoke = false;
    for (const s of this.smokeMeshes.values()) {
      s.remainingSec = Math.max(0, s.remainingSec - dt);
      s.group.rotation.y += dt * 0.16;
      const elapsed = Math.max(0, s.maxSec - s.remainingSec);
      const fadeIn = Math.min(1, elapsed / 0.65);
      const fadeOut = Math.min(1, s.remainingSec / 1.4);
      const targetOpacity = fadeIn * fadeOut * 0.62;
      for (const m of s.materials) {
        m.opacity = targetOpacity;
      }

      if (this.alive && s.remainingSec > 0.25) {
        const d = Math.hypot(
          this.camera.position.x - s.x,
          this.camera.position.z - s.z,
        );
        if (d <= s.radius * 0.85 && Math.abs(this.camera.position.y - s.y) < 3.6) {
          nowInSmoke = true;
        }
      }
    }
    if (nowInSmoke !== this.insideSmoke) {
      this.insideSmoke = nowInSmoke;
      this.callbacks.onSmokeStateChange?.(nowInSmoke);
    }

    // Throttled 2D Screen Projections for Flag Waypoints (~20Hz)
    if (this.callbacks.onHudProject && now - this.lastHudProjTime >= 50) {
      this.lastHudProjTime = now;
      const enemyTeam: TeamId = this.localTeam === 'red' ? 'blue' : 'red';
      const enemyFlagWorld = _v1.copy(this.flagMeshes[enemyTeam].position).add(_v2.set(0, 2.4, 0));
      const homeBaseWorld = _v3.set(
        FLAG_BASES[this.localTeam].x,
        FLAG_BASES[this.localTeam].y + 2.4,
        FLAG_BASES[this.localTeam].z,
      );

      this.callbacks.onHudProject({
        enemyFlagScreen: this.carryingEnemyFlag
          ? null
          : this.projectToScreen(enemyFlagWorld, '敵方旗幟'),
        homeBaseScreen: this.projectToScreen(homeBaseWorld),
      });
    }
  }

  private projectToScreen(
    worldPos: THREE.Vector3,
    label?: string,
  ): { x: number; y: number; visible: boolean; dist: number; label: string } {
    const dist = Math.round(worldPos.distanceTo(this.camera.position));
    const camDir = _v2;
    this.camera.getWorldDirection(camDir);
    const toTarget = _v1.copy(worldPos).sub(this.camera.position);
    const inFront = toTarget.dot(camDir) > 0;

    const proj = worldPos.clone().project(this.camera);
    let x = (proj.x * 0.5 + 0.5) * 100;
    let y = (-proj.y * 0.5 + 0.5) * 100;

    if (!inFront) {
      x = 100 - x;
      y = 92;
    }
    x = THREE.MathUtils.clamp(x, 6, 94);
    y = THREE.MathUtils.clamp(y, 12, 88);

    return { x, y, visible: true, dist, label: label ?? '' };
  }

  private tryDigLocal(): void {
    if (this.mapLayout.mode !== 'underground') return;
    if (!this.isPlaying || !this.alive || !this.pointerLocked || this.shopOpen || this.paused) return;

    const now = performance.now();
    if (now - this.lastDigTime < 240) return;

    this.camera.getWorldDirection(_v1);
    const hit = raycastDigGrid(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      _v1.x,
      _v1.y,
      _v1.z,
      4.6,
      this.digHp,
    );
    if (!hit) return;

    this.lastDigTime = now;
    this.recoilOffset = Math.max(this.recoilOffset, 0.07);
    this.cameraShake = Math.max(this.cameraShake, 0.009);
    soundEngine.playImpact(0.65);

    this.callbacks.onDig?.(
      {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      },
      { x: _v1.x, y: _v1.y, z: _v1.z },
    );
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.unlockPointer();

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('resize', this.onResize);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);

    this.clearGadgetMeshes();
    this.arenaWorld.dispose();
    this.textures.dispose();
    this.tracerGeo.dispose();
    this.tracerCoreGeo.dispose();
    this.sparkGeo.dispose();
    this.ringGeo.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
