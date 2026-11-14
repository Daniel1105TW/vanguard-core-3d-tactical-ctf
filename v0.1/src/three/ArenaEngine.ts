import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CONTROL_ZONE_SPEC,
  DEFAULT_MAP_LAYOUT,
  FLAG_BASES,
  GADGETS,
  GADGET_ORDER,
  WEAPONS,
  WEAPON_ORDER,
  createInitialUndergroundHp,
  generateMapLayout,
  getEffectiveWeaponStats,
  getGroundHeightAt,
  getUndergroundCellBounds,
  rayIntersectsAABB,
  rayIntersectsArenaObstacle,
  raycastDigGrid,
  resolveHorizontalCollision,
} from '../shared/gameConfig.ts';
import type {
  ActorSnapshot,
  ControlZoneSnapshot,
  GadgetFxEvent,
  GadgetId,
  GameMode,
  MapLayout,
  MapMode,
  PingKind,
  StateSyncPayload,
  TacticalPing,
  TeamId,
  TracerEvent,
  Vec3,
  WeaponId,
} from '../shared/gameConfig.ts';
import { soundEngine } from '../audio/soundEngine.ts';
import { createProceduralTextures } from './proceduralTextures.ts';
import {
  buildArenaEnvironment,
  createControlZoneMesh,
  createFlagMesh,
  createGrenadeMesh,
  createSmokeCloudGroup,
  createTrooperRig,
  createWeaponViewmodel,
} from './models.ts';
import type {
  ArenaWorldController,
  ControlZoneVisual,
  TrooperRig,
  WeaponViewRig,
} from './models.ts';

export interface ProjectedPing {
  id: string;
  kind: PingKind;
  creatorName: string;
  targetName?: string;
  x: number;
  y: number;
  inFront: boolean;
  dist: number;
  remainingRatio: number;
  remainingSec: number;
}

export interface SpectateInfo {
  targetId: string | null;
  targetName: string;
  hp: number;
  maxHp: number;
  weaponName: string;
  isBot: boolean;
  aliveTeammateCount: number;
}

export interface HudProjection {
  enemyFlagScreen: { x: number; y: number; visible: boolean; dist: number; label: string } | null;
  homeBaseScreen: { x: number; y: number; visible: boolean; dist: number } | null;
  controlZoneScreen: {
    x: number;
    y: number;
    dist: number;
    label: string;
    owner: TeamId | 'neutral';
    contested: boolean;
  } | null;
  pingsScreen: ProjectedPing[];
}

export interface ArenaPoseState {
  crouching: boolean;
  aiming: boolean;
  weaponId: WeaponId;
  scopeType: 'iron' | 'holo' | 'sniper';
}

export interface VitalsState {
  stamina: number;
  maxStamina: number;
  sprinting: boolean;
  exhausted: boolean;
  crosshairSpread: number;
  hoverEnemy: boolean;
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
  onPing?: (
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
  onOpenChatKey?: () => void;
  onScoreboardKey: (open: boolean) => void;
  onEscapeKey?: () => void;
  onToggleDevMode?: () => void;
  onPoseChange?: (pose: ArenaPoseState) => void;
  onHudProject?: (proj: HudProjection) => void;
  onVitalsUpdate?: (vitals: VitalsState) => void;
  onSpectateChange?: (info: SpectateInfo | null) => void;
}

interface RemoteActorEntry {
  rig: TrooperRig;
  targetPos: THREE.Vector3;
  targetYaw: number;
  targetPitch: number;
  crouching: boolean;
  team: TeamId;
  name: string;
  isBot: boolean;
  alive: boolean;
  hp: number;
  maxHp: number;
  activeWeapon: WeaponId;
  stepDistAccum: number;
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

interface ActiveSlashArc {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  spinDir: number;
}

interface ActivePingVisual {
  data: TacticalPing;
  group: THREE.Group;
  diamond: THREE.Mesh;
  ring: THREE.Mesh;
  beam: THREE.Mesh;
  materials: THREE.MeshBasicMaterial[];
  localRemainSec: number;
}

// Pre-allocated math helpers (Zero GC in render loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _toSrc = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _hoverHeadBox = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
const _hoverBodyBox = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

export class ArenaEngine {
  private container: HTMLElement;
  private callbacks: ArenaCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private audioListener: THREE.AudioListener;
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
  private currentGameMode: GameMode = 'ctf';
  private controlZoneVisual: ControlZoneVisual;
  private latestControlZone: ControlZoneSnapshot | null = null;
  private spectateTargetId: string | null = null;
  private spectateSmoothPos = new THREE.Vector3();
  private spectateSmoothLook = new THREE.Vector3();
  private spectateInitialized = false;
  private lastSpectateKey = '';

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
  private slashArcs: ActiveSlashArc[] = [];
  private pingVisuals = new Map<string, ActivePingVisual>();

  private keys: Record<string, boolean> = {};
  private mouseDown = false;
  private aiming = false;
  private crouching = false;
  private eyeHeight = 1.58;
  private pointerLocked = false;
  private touchControlActive = false;
  private touchMoveX = 0;
  private touchMoveY = 0;
  private touchSprint = false;
  private isPlaying = false;
  private shopOpen = false;
  private paused = false;
  private chatOpen = false;
  private disposed = false;

  private isControlActive(): boolean {
    return this.pointerLocked || this.touchControlActive;
  }

  // User camera/aim settings
  private baseSensitivity = 0.0021;
  private baseFov = 76;

  // Local player physics & stamina state
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
  private localBoosted = false;
  private stamina = 100;
  private maxStamina = 100;
  private sprintExhausted = false;
  private sprintingNow = false;
  private crosshairSpread = 0;
  private hoveringEnemy = false;
  private lastSprintDrainTime = -10;
  private localActiveGadget: GadgetId = 'frag';
  private localGadgets: Partial<Record<GadgetId, number>> = {};
  private insideSmoke = false;
  private ownedWeaponsList: WeaponId[] = ['pistol'];
  private activeWeaponStats = getEffectiveWeaponStats('pistol');

  // Viewmodel recoil, melee swing, camera punch, trauma shake & footsteps
  private recoilOffset = 0;
  private meleeSwingTimer = 0;
  private meleeSwingDuration = 0.22;
  private meleeSwingDir = 1;
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
  private lastPingTime = 0;
  private lastReportTime = 0;
  private lastHudProjTime = 0;
  private lastVitalsTime = 0;

  private clock = new THREE.Clock();
  private frameId = 0;
  private elapsed = 0;

  // Shared geometries for FX
  private tracerGeo = new THREE.CylinderGeometry(0.036, 0.036, 1, 6);
  private tracerCoreGeo = new THREE.CylinderGeometry(0.014, 0.014, 1, 6);
  private sparkGeo = new THREE.BoxGeometry(0.075, 0.075, 0.14);
  private ringGeo = new THREE.RingGeometry(0.18, 0.32, 20);
  private slashGeo = new THREE.TorusGeometry(0.95, 0.048, 6, 20, Math.PI * 0.85);
  private pingDiamondGeo = new THREE.OctahedronGeometry(0.24, 0);
  private pingRingGeo = new THREE.RingGeometry(0.32, 0.44, 24);
  private pingBeamGeo = new THREE.CylinderGeometry(0.025, 0.06, 2.2, 8);

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
    this.audioListener = new THREE.AudioListener();
    this.camera.add(this.audioListener);
    soundEngine.attachListener(this.audioListener);
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

    // 7. World Flag Meshes & Control Zone Beacon
    this.flagMeshes = {
      red: createFlagMesh('red'),
      blue: createFlagMesh('blue'),
    };
    this.flagMeshes.red.position.set(FLAG_BASES.red.x, FLAG_BASES.red.y, FLAG_BASES.red.z);
    this.flagMeshes.blue.position.set(FLAG_BASES.blue.x, FLAG_BASES.blue.y, FLAG_BASES.blue.z);
    this.scene.add(this.flagMeshes.red, this.flagMeshes.blue);

    this.controlZoneVisual = createControlZoneMesh(CONTROL_ZONE_SPEC.radius);
    this.controlZoneVisual.group.position.set(CONTROL_ZONE_SPEC.x, 0, CONTROL_ZONE_SPEC.z);
    this.controlZoneVisual.group.visible = false;
    this.scene.add(this.controlZoneVisual.group);

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

    soundEngine.playImpact({
      sourcePos: { x: cx, y: 1.5, z: cz },
      refDistance: 3,
      maxDistance: 26,
      rolloffFactor: 1.0,
      volumeScale: 0.6,
    });
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
      this.chatOpen = false;
      this.mouseDown = false;
      this.spectateTargetId = null;
      this.spectateInitialized = false;
      this.lastSpectateKey = '';
      this.latestControlZone = null;
      this.controlZoneVisual.group.visible = false;
      this.flagMeshes.red.visible = true;
      this.flagMeshes.blue.visible = true;
      this.callbacks.onSpectateChange?.(null);
      this.emitPose();
      // Clear remote actors, projectiles, and smoke clouds when returning to lobby
      for (const entry of this.remoteActors.values()) {
        this.scene.remove(entry.rig.root);
      }
      this.remoteActors.clear();
      this.clearGadgetMeshes();
      this.clearPingVisuals();
    }
  }

  private clearPingVisuals(): void {
    for (const entry of this.pingVisuals.values()) {
      this.scene.remove(entry.group);
      for (const m of entry.materials) m.dispose();
    }
    this.pingVisuals.clear();
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

  public setChatOpen(open: boolean): void {
    this.chatOpen = open;
    if (open) {
      this.mouseDown = false;
      this.aiming = false;
      this.keys = {};
      this.emitPose();
      this.unlockPointer();
    }
  }

  public requestPointerLock(): void {
    if (!this.isPlaying || this.shopOpen || this.paused || this.chatOpen) return;
    soundEngine.unlock();
    if (this.touchControlActive) return;
    try {
      const maybePromise = this.renderer.domElement.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
      }
    } catch {
      // Ignore on unsupported touch browsers
    }
  }

  public setTouchMode(active: boolean): void {
    this.touchControlActive = active;
    if (!active) {
      this.touchMoveX = 0;
      this.touchMoveY = 0;
      this.touchSprint = false;
      this.mouseDown = false;
      this.aiming = false;
      this.emitPose();
    }
  }

  public setTouchMove(x: number, y: number, sprint = false): void {
    this.touchMoveX = THREE.MathUtils.clamp(x, -1, 1);
    this.touchMoveY = THREE.MathUtils.clamp(y, -1, 1);
    this.touchSprint = sprint;
  }

  public addTouchLook(dx: number, dy: number): void {
    if (!this.isPlaying || this.shopOpen || this.paused || !this.alive) return;
    const zoomScale = this.camera.fov / Math.max(40, this.baseFov);
    const sens = this.baseSensitivity * 1.45 * zoomScale;
    this.yaw -= dx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  }

  public setTouchFire(firing: boolean): void {
    if (!this.touchControlActive) this.touchControlActive = true;
    soundEngine.unlock();
    this.mouseDown = firing;
    if (firing) this.tryFireLocal();
  }

  public setTouchAim(aim: boolean): void {
    if (!this.isPlaying || !this.alive || this.shopOpen || this.paused || this.activeWeaponStats.isMelee) {
      if (this.aiming) {
        this.aiming = false;
        this.emitPose();
      }
      return;
    }
    this.aiming = aim;
    this.emitPose();
  }

  public triggerTouchJump(): void {
    if (!this.isPlaying || !this.alive || this.shopOpen || this.paused) return;
    soundEngine.unlock();
    if (this.grounded) {
      if (this.crouching) {
        this.crouching = false;
        this.emitPose();
      }
      this.vy = 8.4;
      this.grounded = false;
      soundEngine.playJump();
    }
  }

  public triggerTouchCrouch(): void {
    if (!this.isPlaying || !this.alive || this.shopOpen || this.paused) return;
    this.crouching = !this.crouching;
    this.emitPose();
  }

  public triggerTouchReload(): void {
    if (!this.isPlaying || !this.alive || this.shopOpen || this.paused || this.activeWeaponStats.isMelee) return;
    this.aiming = false;
    this.emitPose();
    this.callbacks.onReload();
    soundEngine.playReload();
  }

  public triggerTouchGadget(): void {
    if (!this.isPlaying || !this.alive || this.shopOpen || this.paused) return;
    const activeCount = this.localGadgets[this.localActiveGadget] ?? 0;
    if (activeCount <= 0) return;
    const now = performance.now();
    if (now - this.lastGadgetThrowTime < 450) return;
    this.lastGadgetThrowTime = now;
    this.camera.getWorldDirection(_v1);
    const gSpec = GADGETS[this.localActiveGadget];
    if (!gSpec?.instantUse) soundEngine.playThrow(1);
    this.recoilOffset = Math.max(this.recoilOffset, 0.08);
    this.callbacks.onThrowGadget?.(
      { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      { x: _v1.x, y: _v1.y, z: _v1.z },
    );
  }

  public triggerTouchPing(): void {
    this.tryPingLocal();
  }

  public triggerTouchDig(): void {
    this.tryDigLocal();
  }

  public unlockPointer(): void {
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }
  }

  public computeStereoPan(source: THREE.Vector3): number {
    return soundEngine.computeSpatialMix({ x: source.x, y: source.y, z: source.z }).pan;
  }

  public computeDamageAngleDeg(sourcePos: Vec3): number {
    this.camera.getWorldDirection(_camFwd);
    _camFwd.y = 0;
    if (_camFwd.lengthSq() < 0.0001) _camFwd.set(0, 0, -1);
    else _camFwd.normalize();

    _camRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    _camRight.y = 0;
    if (_camRight.lengthSq() < 0.0001) _camRight.set(1, 0, 0);
    else _camRight.normalize();

    _toSrc.set(sourcePos.x - this.pos.x, 0, sourcePos.z - this.pos.z);
    if (_toSrc.lengthSq() < 0.01) return 0;
    _toSrc.normalize();

    const fwdDot = _camFwd.dot(_toSrc);
    const rightDot = _camRight.dot(_toSrc);
    return (Math.atan2(rightDot, fwdDot) * 180) / Math.PI;
  }

  private getAliveTeammateEntries(): Array<[string, RemoteActorEntry]> {
    const list: Array<[string, RemoteActorEntry]> = [];
    for (const [id, entry] of this.remoteActors.entries()) {
      if (entry.team === this.localTeam && entry.alive) {
        list.push([id, entry]);
      }
    }
    list.sort((a, b) => a[0].localeCompare(b[0]));
    return list;
  }

  private syncSpectateTargetAndEmit(): void {
    if (this.alive || !this.isPlaying) {
      if (this.lastSpectateKey !== '' || this.spectateTargetId !== null) {
        this.spectateTargetId = null;
        this.spectateInitialized = false;
        this.lastSpectateKey = '';
        this.callbacks.onSpectateChange?.(null);
      }
      return;
    }

    const mates = this.getAliveTeammateEntries();
    if (mates.length === 0) {
      this.spectateTargetId = null;
      const key = 'none';
      if (key !== this.lastSpectateKey) {
        this.lastSpectateKey = key;
        this.callbacks.onSpectateChange?.({
          targetId: null,
          targetName: '',
          hp: 0,
          maxHp: 100,
          weaponName: '',
          isBot: false,
          aliveTeammateCount: 0,
        });
      }
      return;
    }

    let found = mates.find(([id]) => id === this.spectateTargetId);
    if (!found) {
      found = mates[0];
      this.spectateTargetId = found[0];
      this.spectateInitialized = false;
    }

    const [tid, entry] = found;
    const weaponName = WEAPONS[entry.activeWeapon]?.name ?? entry.activeWeapon;
    const key = `${tid}|${entry.hp}|${entry.activeWeapon}|${mates.length}`;
    if (key !== this.lastSpectateKey) {
      this.lastSpectateKey = key;
      this.callbacks.onSpectateChange?.({
        targetId: tid,
        targetName: entry.name,
        hp: entry.hp,
        maxHp: entry.maxHp,
        weaponName,
        isBot: entry.isBot,
        aliveTeammateCount: mates.length,
      });
    }
  }

  public cycleSpectateTarget(dir: 1 | -1 = 1): void {
    if (!this.isPlaying || this.alive) return;
    const mates = this.getAliveTeammateEntries();
    if (mates.length === 0) return;
    const curIdx = mates.findIndex(([id]) => id === this.spectateTargetId);
    const nextIdx =
      curIdx === -1 ? 0 : (curIdx + dir + mates.length) % mates.length;
    this.spectateTargetId = mates[nextIdx][0];
    this.spectateInitialized = false;
    this.syncSpectateTargetAndEmit();
  }

  public applyServerSync(state: StateSyncPayload): void {
    if (!this.isPlaying) return;

    this.currentGameMode = state.gameMode;
    this.latestControlZone = state.controlZone ?? null;

    const seenIds = new Set<string>();
    const enemyTeam: TeamId = this.localTeam === 'red' ? 'blue' : 'red';
    const enemyFlag = state.flags[enemyTeam];
    this.carryingEnemyFlag = state.gameMode === 'ctf' && enemyFlag.carrierId === this.localPlayerId;

    for (const actor of state.actors) {
      if (actor.id === this.localPlayerId) {
        // Sync authoritative health, alive/respawn snap, weapon stats
        const wasAlive = this.alive;
        this.alive = actor.alive;
        this.localAmmo = actor.ammo;
        this.localReloading = actor.reloading;
        this.localSlowed = Boolean(actor.slowed);
        this.localBoosted = Boolean(actor.boosted);
        this.localActiveGadget = actor.activeGadget ?? 'frag';
        this.localGadgets = actor.gadgets ?? {};
        this.ownedWeaponsList = WEAPON_ORDER.filter((wid) => Boolean(actor.ownedWeapons[wid]));

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
          this.stamina = this.maxStamina;
          this.sprintExhausted = false;
        }
        if (!actor.alive) {
          this.aiming = false;
          this.crouching = false;
          this.mouseDown = false;
          this.sprintingNow = false;
        }
        this.emitPose();
        continue;
      }

      seenIds.add(actor.id);
      let entry = this.remoteActors.get(actor.id);
      if (!entry) {
        const rig = createTrooperRig(actor.team, actor.name, actor.isBot, this.textures.contactShadow);
        rig.root.position.set(actor.x, actor.y, actor.z);
        rig.setActiveWeapon(actor.activeWeapon);
        this.scene.add(rig.root);
        entry = {
          rig,
          targetPos: new THREE.Vector3(actor.x, actor.y, actor.z),
          targetYaw: actor.yaw,
          targetPitch: actor.pitch,
          crouching: Boolean(actor.crouching),
          team: actor.team,
          name: actor.name,
          isBot: actor.isBot,
          alive: actor.alive,
          hp: actor.hp,
          maxHp: actor.maxHp,
          activeWeapon: actor.activeWeapon,
          stepDistAccum: 0,
        };
        this.remoteActors.set(actor.id, entry);
      } else if (entry.team !== actor.team) {
        this.scene.remove(entry.rig.root);
        const rig = createTrooperRig(actor.team, actor.name, actor.isBot, this.textures.contactShadow);
        rig.root.position.set(actor.x, actor.y, actor.z);
        rig.setActiveWeapon(actor.activeWeapon);
        this.scene.add(rig.root);
        entry.rig = rig;
        entry.team = actor.team;
      }

      entry.rig.root.visible = actor.alive;
      entry.targetPos.set(actor.x, actor.y, actor.z);
      entry.targetYaw = actor.yaw;
      entry.targetPitch = actor.pitch;
      entry.crouching = Boolean(actor.crouching);
      entry.alive = actor.alive;
      entry.hp = actor.hp;
      entry.maxHp = actor.maxHp;
      entry.activeWeapon = actor.activeWeapon;
      entry.rig.setActiveWeapon(actor.activeWeapon);
      entry.rig.updateHealth(actor.hp, actor.maxHp);

      if (state.gameMode === 'ctf') {
        const carryingRed = state.flags.red.carrierId === actor.id;
        const carryingBlue = state.flags.blue.carrierId === actor.id;
        entry.rig.setCarriedFlag(carryingRed ? 'red' : carryingBlue ? 'blue' : null);
      } else {
        entry.rig.setCarriedFlag(null);
      }
    }

    // Remove disconnected actors
    for (const [id, entry] of this.remoteActors.entries()) {
      if (!seenIds.has(id)) {
        this.scene.remove(entry.rig.root);
        this.remoteActors.delete(id);
      }
    }

    // Update World Flag Meshes (CTF only)
    (['red', 'blue'] as TeamId[]).forEach((team) => {
      const flagState = state.flags[team];
      const mesh = this.flagMeshes[team];
      if (state.gameMode !== 'ctf' || flagState.status === 'carried') {
        mesh.visible = false;
      } else {
        mesh.visible = true;
        mesh.position.set(flagState.x, flagState.y, flagState.z);
      }
    });

    // Update 3D Control Zone beacon visibility
    this.controlZoneVisual.group.visible =
      state.gameMode === 'dom' && Boolean(state.controlZone);

    // Sync Spectate target state
    this.syncSpectateTargetAndEmit();

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

    // Sync Team Tactical Pings
    const seenPings = new Set<string>();
    for (const ping of state.pings ?? []) {
      seenPings.add(ping.id);
      this.upsertPingVisual(ping);
    }
    for (const [id, entry] of this.pingVisuals.entries()) {
      if (!seenPings.has(id)) {
        this.scene.remove(entry.group);
        for (const m of entry.materials) m.dispose();
        this.pingVisuals.delete(id);
      }
    }
  }

  public addPingInstant(ping: TacticalPing): void {
    if (!this.isPlaying) return;
    this.upsertPingVisual(ping);
  }

  private upsertPingVisual(ping: TacticalPing): void {
    const existing = this.pingVisuals.get(ping.id);
    if (existing) {
      existing.data = ping;
      existing.localRemainSec = Math.min(existing.localRemainSec, ping.remainingSec);
      if (!ping.targetActorId) {
        existing.group.position.set(ping.x, ping.y, ping.z);
      }
      return;
    }

    const colorHex =
      ping.kind === 'carrier' ? 0xf59e0b : ping.kind === 'enemy' ? 0xf43f5e : 0x22d3ee;

    const group = new THREE.Group();
    group.position.set(ping.x, ping.y, ping.z);

    const diamondMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    });
    const diamond = new THREE.Mesh(this.pingDiamondGeo, diamondMat);
    diamond.position.y = ping.targetActorId ? 0.15 : 0.65;
    diamond.renderOrder = 25;
    group.add(diamond);

    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(this.pingRingGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = ping.targetActorId ? -0.35 : 0.04;
    group.add(ring);

    const beamMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: ping.targetActorId ? 0.28 : 0.36,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(this.pingBeamGeo, beamMat);
    beam.position.y = ping.targetActorId ? 0.75 : 1.1;
    group.add(beam);

    this.scene.add(group);
    this.pingVisuals.set(ping.id, {
      data: ping,
      group,
      diamond,
      ring,
      beam,
      materials: [diamondMat, ringMat, beamMat],
      localRemainSec: ping.remainingSec,
    });
  }

  public triggerGadgetFx(ev: GadgetFxEvent): void {
    const pos = _v1.set(ev.x, ev.y, ev.z);
    const dist = pos.distanceTo(this.camera.position);
    const sourcePos = { x: ev.x, y: ev.y, z: ev.z };

    if (ev.kind === 'throw') {
      if (ev.shooterId !== this.localPlayerId) {
        soundEngine.playThrow({ sourcePos, refDistance: 3.5, maxDistance: 32, rolloffFactor: 1.0, volumeScale: 0.78 });
      }
      return;
    }

    if (ev.type === 'frag') {
      soundEngine.playExplosion({ sourcePos, refDistance: 8, maxDistance: 66, rolloffFactor: 0.75, volumeScale: 1 });
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
      soundEngine.playSmokeDeploy({ sourcePos, refDistance: 5, maxDistance: 44, rolloffFactor: 0.9, volumeScale: 1 });
      this.spawnSparkBurst(pos, 0xcbd5e1, 14, 5.5, 0.55, 4);
      this.spawnShockwaveRing(pos, 0xe2e8f0, 8.5, 0.38);
    } else if (ev.type === 'emp') {
      soundEngine.playEmpBlast({ sourcePos, refDistance: 6, maxDistance: 48, rolloffFactor: 0.85, volumeScale: 1 });
      this.spawnSparkBurst(pos, 0xa855f7, 20, 11.5, 0.44, 8);
      this.spawnSparkBurst(pos, 0x38bdf8, 12, 9.0, 0.38, 6);
      this.spawnShockwaveRing(pos, 0xa855f7, 13.0, 0.34);
      this.spawnShockwaveRing(pos, 0x38bdf8, 9.2, 0.24);
      if (dist < 16) {
        this.cameraShake = Math.max(this.cameraShake, (1 - dist / 16) * 0.045);
      }
    } else if (ev.type === 'cryo') {
      soundEngine.playCryoBlast({ sourcePos, refDistance: 6, maxDistance: 48, rolloffFactor: 0.85, volumeScale: 1 });
      this.spawnSparkBurst(pos, 0x38bdf8, 22, 10.5, 0.48, 7);
      this.spawnSparkBurst(pos, 0xe0f2fe, 14, 8.0, 0.42, 4);
      this.spawnShockwaveRing(pos, 0x38bdf8, 13.5, 0.38);
      this.spawnShockwaveRing(pos, 0xe0f2fe, 9.0, 0.28);
      if (dist < 16) {
        this.cameraShake = Math.max(this.cameraShake, (1 - dist / 16) * 0.032);
      }
    } else if (ev.type === 'medkit') {
      soundEngine.playMedkitHeal({ sourcePos, refDistance: 4, maxDistance: 34, rolloffFactor: 0.95, volumeScale: 1 });
      this.spawnSparkBurst(pos, 0x34d399, 16, 6.0, 0.55, -6);
      this.spawnShockwaveRing(pos, 0x34d399, 9.5, 0.35);
    } else if (ev.type === 'stim') {
      soundEngine.playStimBoost({ sourcePos, refDistance: 4, maxDistance: 30, rolloffFactor: 0.95, volumeScale: 1 });
      if (ev.shooterId === this.localPlayerId) {
        this.stamina = this.maxStamina;
        this.sprintExhausted = false;
        this.fovPunch = Math.max(this.fovPunch, 3.2);
      }
      this.spawnSparkBurst(pos, 0xfacc15, 16, 7.5, 0.45, -5);
      this.spawnShockwaveRing(pos, 0xfacc15, 5.5, 0.28);
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

  private spawnMeleeSlashArc(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    colorHex: string | number,
    scale = 1,
    spinDir = 1,
  ): void {
    if (this.slashArcs.length >= 18) return;
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.slashGeo, mat);
    mesh.position.copy(origin).addScaledVector(dir, 0.85 * scale);
    mesh.lookAt(_v4.copy(mesh.position).add(dir));
    mesh.rotateX(Math.PI / 2);
    mesh.rotateZ(spinDir > 0 ? -0.45 : 0.45);
    mesh.scale.setScalar(scale);
    this.scene.add(mesh);
    this.slashArcs.push({ mesh, life: 0.18, maxLife: 0.18, spinDir });
  }

  public spawnTracer(ev: TracerEvent): void {
    const start = _v1.set(ev.from.x, ev.from.y, ev.from.z);
    const end = _v2.set(ev.to.x, ev.to.y, ev.to.z);

    if (ev.shooterId !== this.localPlayerId) {
      const shooterEntry = this.remoteActors.get(ev.shooterId);
      shooterEntry?.rig.triggerAction(Boolean(ev.isMelee));
    }

    if (ev.isMelee) {
      const colorHex = WEAPONS[ev.weaponId]?.tracerColor ?? '#22d3ee';
      const dir = _v3.subVectors(end, start);
      if (dir.lengthSq() < 0.0001) dir.set(0, 0, -1);
      else dir.normalize();

      const scale = ev.weaponId === 'greatsword' ? 1.45 : ev.weaponId === 'plasma_saber' ? 1.35 : 1.05;
      this.spawnMeleeSlashArc(start, dir, colorHex, scale, this.meleeSwingDir);

      if (ev.hitActorId) {
        const hitEntry = this.remoteActors.get(ev.hitActorId);
        if (hitEntry) {
          hitEntry.rig.flashHit(Boolean(ev.headshot));
        }
        if (ev.shooterId === this.localPlayerId) {
          soundEngine.playSwordHit(Boolean(ev.killed));
        }
        if (ev.killed) {
          const teamColor = ev.team === 'red' ? 0x06b6d4 : 0xef4444;
          this.spawnSparkBurst(end, colorHex, 20, 11.5, 0.44, 12);
          this.spawnSparkBurst(end, 0xfbbf24, 12, 9.0, 0.38, 10);
          this.spawnShockwaveRing(end, colorHex, 5.4, 0.3);
          this.spawnShockwaveRing(end, teamColor, 3.8, 0.22);
        } else {
          this.spawnSparkBurst(end, colorHex, 9, 8.5, 0.34, 14);
          this.spawnShockwaveRing(end, colorHex, 2.3, 0.22);
        }
      }

      if (ev.shooterId !== this.localPlayerId) {
        soundEngine.playSwordSwing(ev.weaponId, {
          sourcePos: ev.from,
          refDistance: 3.5,
          maxDistance: 30,
          rolloffFactor: 1.0,
          volumeScale: 0.78,
        });
      }
      return;
    }

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
    const isLaser = ev.weaponId === 'laser';
    const isAutocannon = ev.weaponId === 'autocannon';
    const life = isSniper ? 0.22 : isPlasma || isAutocannon ? 0.2 : isLaser || ev.weaponId === 'burst' ? 0.15 : 0.12;
    const widthScale = isPlasma || isAutocannon
      ? 2.35
      : isSniper
        ? 2.2
        : isLaser
          ? 1.55
          : ev.weaponId === 'shotgun'
            ? 0.85
            : ev.weaponId === 'gatling' || ev.weaponId === 'vector'
              ? 0.92
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
    if (isAutocannon) {
      this.spawnSparkBurst(end, 0xfb7185, 16, 10.5, 0.38, 16);
      this.spawnShockwaveRing(end, 0xf97316, 6.2, 0.28);
    } else if (ev.weaponId === 'freezer') {
      this.spawnSparkBurst(end, 0x7dd3fc, 8, 6.2, 0.3, 10);
    }

    if (ev.hitActorId) {
      const hitEntry = this.remoteActors.get(ev.hitActorId);
      if (hitEntry) {
        hitEntry.rig.flashHit(Boolean(ev.headshot));
      }

      if (ev.killed) {
        const teamColor = ev.team === 'red' ? 0x06b6d4 : 0xef4444;
        this.spawnSparkBurst(end, 0xfbbf24, 18, 11.2, 0.48, 12);
        this.spawnSparkBurst(end, teamColor, 14, 9.2, 0.52, 9);
        this.spawnShockwaveRing(end, 0xfbbf24, 5.8, 0.34);
        this.spawnShockwaveRing(end, teamColor, 4.0, 0.26);
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
      if (Math.random() < 0.55) {
        soundEngine.playImpact({
          sourcePos: ev.to,
          refDistance: 2.5,
          maxDistance: 22,
          rolloffFactor: 1.1,
          volumeScale: 0.45,
        });
      }
    }

    // Spatial 3D gunshot sound for remote actors via AudioListener
    if (ev.shooterId !== this.localPlayerId) {
      soundEngine.playShoot(ev.weaponId, {
        sourcePos: ev.from,
        refDistance: 5.5,
        maxDistance: 54,
        rolloffFactor: 0.9,
        volumeScale: 0.8,
      });
    }
  }

  private tryFireLocal(): void {
    if (!this.isPlaying || !this.alive || !this.isControlActive() || this.shopOpen || this.paused) return;

    const isMelee = Boolean(this.activeWeaponStats.isMelee);
    if (!isMelee && (this.localReloading || this.localAmmo <= 0)) {
      if (!this.localReloading && this.localAmmo <= 0) {
        this.callbacks.onReload();
        soundEngine.playReload();
      }
      return;
    }

    const now = performance.now();
    const rateMult = this.localBoosted ? 0.78 : 1.0;
    if (now - this.lastLocalShotTime < this.activeWeaponStats.fireInterval * 1000 * rateMult) return;

    this.lastLocalShotTime = now;
    const wid = this.activeWeaponStats.id;

    if (isMelee) {
      const swingDur = Math.min(0.28, this.activeWeaponStats.fireInterval * 0.78);
      this.meleeSwingDuration = swingDur;
      this.meleeSwingTimer = swingDur;
      this.meleeSwingDir *= -1;
      this.recoilOffset = 0.08;
      this.cameraShake = Math.max(this.cameraShake, wid === 'greatsword' ? 0.018 : 0.01);
      this.fovPunch = Math.max(this.fovPunch, wid === 'greatsword' ? 1.5 : 0.75);
      soundEngine.playSwordSwing(wid, 1);
    } else {
      const heavy =
        wid === 'sniper' || wid === 'shotgun' || wid === 'plasma' || wid === 'autocannon';
      const recoilScale = this.aiming ? 0.68 : 1.0;
      this.recoilOffset =
        (heavy
          ? 0.15
          : wid === 'rifle' || wid === 'burst' || wid === 'freezer'
            ? 0.085
            : wid === 'gatling' || wid === 'vector'
              ? 0.045
              : 0.065) * recoilScale;
      this.flashTimer = 0.06;

      // Camera recoil punch & muzzle dynamic lighting
      const basePitch =
        wid === 'sniper'
          ? 0.036
          : wid === 'plasma' || wid === 'autocannon'
            ? 0.032
            : wid === 'shotgun'
              ? 0.032
              : wid === 'burst'
                ? 0.016
                : wid === 'rifle' || wid === 'freezer'
                  ? 0.013
                  : wid === 'laser'
                    ? 0.007
                    : wid === 'gatling' || wid === 'vector'
                      ? 0.0085
                      : 0.009;
      this.punchPitch += basePitch * recoilScale;
      this.punchYaw += (Math.random() - 0.5) * (heavy ? 0.018 : 0.008) * recoilScale;
      this.cameraShake = Math.max(
        this.cameraShake,
        heavy ? 0.022 : wid === 'gatling' || wid === 'vector' ? 0.01 : 0.007,
      );
      this.fovPunch = Math.max(
        this.fovPunch,
        wid === 'sniper' || wid === 'plasma' || wid === 'autocannon'
          ? 2.2
          : wid === 'shotgun'
            ? 1.8
            : 0.42,
      );
      this.muzzleLight.color.set(this.activeWeaponStats.tracerColor);
      this.muzzleLight.intensity = this.isSoftwareGl ? 0 : heavy ? 9 : 6;

      soundEngine.playShoot(wid, 1);
    }

    const origin = {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
    };
    this.camera.getWorldDirection(_v1);
    this.callbacks.onShoot(origin, { x: _v1.x, y: _v1.y, z: _v1.z }, this.aiming);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    if (this.chatOpen) {
      if (e.code === 'Escape' && this.isPlaying) {
        e.preventDefault();
        this.callbacks.onEscapeKey?.();
      }
      return;
    }

    this.keys[e.code] = true;

    if (!this.isPlaying) return;

    if (e.code === 'Escape') {
      e.preventDefault();
      this.callbacks.onEscapeKey?.();
      return;
    }

    if (e.code === 'F8' && !e.repeat) {
      e.preventDefault();
      this.callbacks.onToggleDevMode?.();
      return;
    }

    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat && !this.shopOpen && !this.paused) {
      e.preventDefault();
      this.keys[e.code] = false;
      this.callbacks.onOpenChatKey?.();
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
      if (!this.alive && !e.repeat) {
        this.cycleSpectateTarget(1);
        return;
      }
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

    if (e.code === 'KeyF' && !e.repeat && this.alive && this.pointerLocked) {
      this.tryPingLocal();
      return;
    }

    if (e.code === 'KeyG' && !e.repeat && this.alive && this.pointerLocked) {
      const activeCount = this.localGadgets[this.localActiveGadget] ?? 0;
      if (activeCount > 0) {
        const now = performance.now();
        if (now - this.lastGadgetThrowTime >= 450) {
          this.lastGadgetThrowTime = now;
          this.camera.getWorldDirection(_v1);
          const gSpec = GADGETS[this.localActiveGadget];
          if (!gSpec?.instantUse) {
            soundEngine.playThrow(1);
          }
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

    if (e.code === 'KeyR' && this.alive && !this.activeWeaponStats.isMelee) {
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
      Digit9: 8,
      Digit0: 9,
    };
    const slotIdx = digitIndexMap[e.code];
    if (slotIdx !== undefined) {
      const w = this.ownedWeaponsList[slotIdx];
      if (w) {
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
    if (!this.isPlaying || this.shopOpen || this.paused || this.chatOpen) return;
    if (e.button === 1) {
      e.preventDefault();
      if (this.pointerLocked && this.alive) {
        this.tryPingLocal();
      }
      return;
    }
    if (e.button === 2) {
      if (this.pointerLocked && this.alive && !this.localReloading && !this.activeWeaponStats.isMelee) {
        this.aiming = true;
        this.emitPose();
      }
      return;
    }
    if (e.button !== 0) return;
    if (!this.alive) {
      if (e.target === this.renderer.domElement) {
        this.cycleSpectateTarget(1);
      }
      return;
    }
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
    let isMoving = false;

    // Local Player Movement + Stamina Drain
    if (this.alive && this.isControlActive() && !this.shopOpen) {
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
      if (Math.abs(this.touchMoveY) > 0.05 || Math.abs(this.touchMoveX) > 0.05) {
        moveX += forwardX * this.touchMoveY + rightX * this.touchMoveX;
        moveZ += forwardZ * this.touchMoveY + rightZ * this.touchMoveX;
      }

      const len = Math.hypot(moveX, moveZ);
      isMoving = len > 0.001;
      const wantsSprint =
        (Boolean(this.keys['ShiftLeft'] || this.keys['ShiftRight']) || this.touchSprint) &&
        isMoving &&
        !this.crouching &&
        !this.aiming;

      if (this.localBoosted) {
        this.stamina = this.maxStamina;
        this.sprintExhausted = false;
      } else if (wantsSprint && !this.sprintExhausted) {
        this.stamina = Math.max(0, this.stamina - 28 * dt);
        this.lastSprintDrainTime = this.elapsed;
        if (this.stamina <= 0) {
          this.sprintExhausted = true;
        }
      }

      const sprinting = wantsSprint && !this.sprintExhausted;
      this.sprintingNow = sprinting;
      sprintingMoving = sprinting && isMoving;

      if (isMoving) {
        moveX /= len;
        moveZ /= len;
        const baseSpeed = sprinting ? 8.3 : 6.0;
        const flagMult = this.carryingEnemyFlag ? 0.9 : 1.0;
        const crouchMult = this.crouching ? 0.62 : 1.0;
        const adsMult = this.aiming ? 0.72 : 1.0;
        const empMult = this.localSlowed ? 0.6 : 1.0;
        const boostMult = this.localBoosted ? 1.28 : 1.0;
        const speed =
          baseSpeed *
          this.activeWeaponStats.moveSpeedMult *
          flagMult *
          crouchMult *
          adsMult *
          empMult *
          boostMult;

        const prevX = this.pos.x;
        const prevZ = this.pos.z;
        const nextX = this.pos.x + moveX * speed * dt;
        const nextZ = this.pos.z + moveZ * speed * dt;
        const resolved = resolveHorizontalCollision(nextX, this.pos.y, nextZ, 0.48, this.mapLayout, this.digHp);
        this.pos.x = resolved.x;
        this.pos.z = resolved.z;

        if (this.grounded) {
          this.walkBobPhase += dt * (sprinting ? 11.5 : this.crouching ? 6.5 : 8.5);
          this.stepDistAccum += Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
          const stepStride = sprinting ? 2.1 : 2.5;
          if (this.stepDistAccum >= stepStride && !this.crouching) {
            this.stepDistAccum = 0;
            soundEngine.playFootstep(sprinting);
          }
        }
      }
    } else {
      this.sprintingNow = false;
    }

    // Natural Stamina Recovery when not actively sprinting
    if (!this.sprintingNow && !this.localBoosted) {
      if (!this.alive) {
        this.stamina = this.maxStamina;
        this.sprintExhausted = false;
      } else if (this.elapsed - this.lastSprintDrainTime >= 0.55) {
        const regenRate = isMoving ? 20 : 28;
        this.stamina = Math.min(this.maxStamina, this.stamina + regenRate * dt);
        if (this.sprintExhausted && this.stamina >= 18) {
          this.sprintExhausted = false;
        }
      }
    }

    // Update 3D Control Zone beacon animation
    if (this.controlZoneVisual.group.visible && this.latestControlZone) {
      this.controlZoneVisual.update(
        this.latestControlZone.owner,
        this.latestControlZone.captureTeam,
        this.latestControlZone.progress,
        this.latestControlZone.contested,
        this.elapsed,
      );
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
    } else if (Math.abs(this.camera.fov - this.baseFov) > 0.1) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, this.baseFov, 10, dt);
      this.camera.updateProjectionMatrix();
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

    // Update Camera Transform (1st person alive vs 3rd person teammate spectate)
    const bobScale = this.aiming ? 0.18 : this.crouching ? 0.55 : 1.0;
    const bobY = this.grounded ? Math.sin(this.walkBobPhase) * 0.035 * bobScale : 0;
    const bobX = this.grounded ? Math.cos(this.walkBobPhase * 0.5) * 0.02 * bobScale : 0;
    const shakeX = (Math.random() - 0.5) * this.cameraShake;
    const shakeY = (Math.random() - 0.5) * this.cameraShake;
    if (this.alive) {
      this.spectateInitialized = false;
      this.camera.position.set(this.pos.x + shakeX, this.pos.y + this.eyeHeight + bobY + shakeY, this.pos.z);
      _euler.set(
        THREE.MathUtils.clamp(this.pitch + this.punchPitch, -Math.PI / 2 + 0.03, Math.PI / 2 - 0.03),
        this.yaw + this.punchYaw,
        0,
        'YXZ',
      );
      this.camera.quaternion.setFromEuler(_euler);
    } else {
      const mate = this.spectateTargetId ? this.remoteActors.get(this.spectateTargetId) : undefined;
      if (mate && mate.alive && mate.team === this.localTeam) {
        const mPos = mate.rig.root.position;
        const yaw = mate.rig.bodyGroup.rotation.y;
        const cosPitch = Math.cos(mate.targetPitch * 0.55);
        const fx = -Math.sin(yaw) * cosPitch;
        const fy = Math.sin(mate.targetPitch * 0.55);
        const fz = -Math.cos(yaw) * cosPitch;
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);

        const pivotX = mPos.x + rx * 0.48;
        const pivotY = mPos.y + (mate.crouching ? 1.15 : 1.58);
        const pivotZ = mPos.z + rz * 0.48;

        const backX = -fx * 3.1;
        const backY = -fy * 1.4 + 0.65;
        const backZ = -fz * 3.1;
        const backLen = Math.hypot(backX, backY, backZ) || 1;
        const obsDist = rayIntersectsArenaObstacle(
          pivotX,
          pivotY,
          pivotZ,
          backX / backLen,
          backY / backLen,
          backZ / backLen,
          backLen,
          this.mapLayout,
          this.digHp,
        );
        const safeDist = Math.max(0.65, Math.min(backLen, obsDist - 0.38));

        _v1.set(
          pivotX + (backX / backLen) * safeDist,
          Math.max(mPos.y + 0.45, pivotY + (backY / backLen) * safeDist),
          pivotZ + (backZ / backLen) * safeDist,
        );
        _v2.set(pivotX + fx * 12, pivotY + fy * 12, pivotZ + fz * 12);

        if (!this.spectateInitialized) {
          this.spectateSmoothPos.copy(_v1);
          this.spectateSmoothLook.copy(_v2);
          this.spectateInitialized = true;
        } else {
          this.spectateSmoothPos.lerp(_v1, Math.min(1, dt * 12));
          this.spectateSmoothLook.lerp(_v2, Math.min(1, dt * 14));
        }
        this.camera.position.copy(this.spectateSmoothPos);
        this.camera.lookAt(this.spectateSmoothLook);
      } else {
        // Fallback elevated death cam if entire team is down
        this.camera.position.set(this.pos.x, this.pos.y + 5.5, this.pos.z + 4);
        this.camera.lookAt(this.pos.x, this.pos.y + 1, this.pos.z);
      }
    }

    // Viewmodel Recoil, Melee Slash Swing, ADS Centering, Reload Tilt, Gatling Spin & Muzzle Flash
    this.recoilOffset = THREE.MathUtils.damp(this.recoilOffset, 0, 18, dt);
    if (this.meleeSwingTimer > 0) {
      this.meleeSwingTimer = Math.max(0, this.meleeSwingTimer - dt);
    }
    const swingProgress =
      this.meleeSwingTimer > 0 && this.meleeSwingDuration > 0
        ? 1 - this.meleeSwingTimer / this.meleeSwingDuration
        : 0;
    const swingWave = swingProgress > 0 ? Math.sin(swingProgress * Math.PI) : 0;

    const hideForScope = this.aiming && this.activeWeaponStats.scopeType === 'sniper' && !this.localReloading;
    this.viewmodelAnchor.visible = this.isPlaying && this.alive && !hideForScope;

    const reloadTilt = this.localReloading ? -0.55 : 0;
    const targetVmX = this.aiming && !this.localReloading ? 0 : 0.27 - swingWave * 0.28 * this.meleeSwingDir;
    const targetVmY = this.aiming && !this.localReloading ? -0.155 : -0.24 - swingWave * 0.08;
    const targetVmZ = this.aiming && !this.localReloading ? -0.34 : -0.44 - swingWave * 0.14;
    this.viewmodelAnchor.position.set(
      THREE.MathUtils.damp(this.viewmodelAnchor.position.x, targetVmX + bobX * 0.4, 22, dt),
      THREE.MathUtils.damp(
        this.viewmodelAnchor.position.y,
        targetVmY + bobY * 0.35 - (this.localReloading ? 0.08 : 0),
        22,
        dt,
      ),
      THREE.MathUtils.damp(this.viewmodelAnchor.position.z, targetVmZ + this.recoilOffset, 22, dt),
    );
    this.viewmodelAnchor.rotation.set(
      THREE.MathUtils.damp(
        this.viewmodelAnchor.rotation.x,
        this.recoilOffset * 2.1 + reloadTilt - swingWave * 0.95,
        20,
        dt,
      ),
      THREE.MathUtils.damp(this.viewmodelAnchor.rotation.y, swingWave * 0.95 * this.meleeSwingDir, 22, dt),
      THREE.MathUtils.damp(this.viewmodelAnchor.rotation.z, swingWave * 0.85 * this.meleeSwingDir, 22, dt),
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
      const moveSpeed = moveDist / Math.max(0.001, dt);
      entry.rig.animateWalk(moveSpeed, this.elapsed, entry.targetPitch, entry.crouching);
      entry.rig.updateFlash(dt);

      // 3D Spatialized Footsteps for nearby moving remote actors
      if (entry.alive && !entry.crouching && moveSpeed > 1.2) {
        const gy = getGroundHeightAt(
          entry.rig.root.position.x,
          entry.rig.root.position.z,
          entry.rig.root.position.y,
          this.mapLayout,
        );
        if (Math.abs(entry.rig.root.position.y - gy) < 0.25) {
          entry.stepDistAccum += moveDist;
          const isSprinting = moveSpeed > 6.9;
          const stride = isSprinting ? 2.1 : 2.5;
          if (entry.stepDistAccum >= stride) {
            entry.stepDistAccum = 0;
            soundEngine.playFootstep(isSprinting, {
              sourcePos: {
                x: entry.rig.root.position.x,
                y: entry.rig.root.position.y,
                z: entry.rig.root.position.z,
              },
              refDistance: 2.5,
              maxDistance: 24,
              rolloffFactor: 1.05,
              volumeScale: 1.25,
            });
          }
        }
      } else {
        entry.stepDistAccum = 0;
      }

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

    for (let i = this.slashArcs.length - 1; i >= 0; i--) {
      const sa = this.slashArcs[i];
      sa.life -= dt;
      if (sa.life <= 0) {
        this.scene.remove(sa.mesh);
        (sa.mesh.material as THREE.Material).dispose();
        this.slashArcs.splice(i, 1);
      } else {
        const alpha = sa.life / sa.maxLife;
        sa.mesh.rotateZ(sa.spinDir * dt * 14);
        (sa.mesh.material as THREE.MeshBasicMaterial).opacity = alpha * 0.92;
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

    // Animate 3D Tactical Ping Beacons & Track Live Enemy/Carrier Positions
    for (const [id, pv] of this.pingVisuals.entries()) {
      pv.localRemainSec = Math.max(0, pv.localRemainSec - dt);
      if (pv.localRemainSec <= 0) {
        this.scene.remove(pv.group);
        for (const m of pv.materials) m.dispose();
        this.pingVisuals.delete(id);
        continue;
      }

      if (pv.data.targetActorId) {
        const target = this.remoteActors.get(pv.data.targetActorId);
        if (target && target.rig.root.visible) {
          pv.group.position.set(
            target.rig.root.position.x,
            target.rig.root.position.y + (target.crouching ? 1.65 : 2.2),
            target.rig.root.position.z,
          );
        } else {
          pv.group.position.set(pv.data.x, pv.data.y, pv.data.z);
        }
      }

      pv.diamond.rotation.y += dt * 2.8;
      const bob = Math.sin(this.elapsed * 5.2) * 0.1;
      pv.diamond.position.y = (pv.data.targetActorId ? 0.25 : 0.72) + bob;

      const ringPulse = 1 + ((this.elapsed * 1.4) % 1) * 0.85;
      pv.ring.scale.setScalar(ringPulse);

      const fade = Math.min(1, pv.localRemainSec / 1.0);
      pv.materials[0].opacity = 0.92 * fade;
      pv.materials[1].opacity = (1 - ((this.elapsed * 1.4) % 1)) * 0.75 * fade;
      pv.materials[2].opacity = (pv.data.targetActorId ? 0.24 : 0.34) * fade;
    }

    // Throttled 2D Screen Projections for Mode Waypoints & Tactical Pings (~20Hz)
    if (this.callbacks.onHudProject && now - this.lastHudProjTime >= 50) {
      this.lastHudProjTime = now;
      let enemyFlagScreen: HudProjection['enemyFlagScreen'] = null;
      let homeBaseScreen: HudProjection['homeBaseScreen'] = null;
      let controlZoneScreen: HudProjection['controlZoneScreen'] = null;

      if (this.currentGameMode === 'ctf') {
        const enemyTeam: TeamId = this.localTeam === 'red' ? 'blue' : 'red';
        const enemyFlagWorld = _v1.copy(this.flagMeshes[enemyTeam].position).add(_v2.set(0, 2.4, 0));
        enemyFlagScreen = this.carryingEnemyFlag
          ? null
          : this.projectToScreen(enemyFlagWorld, '敵方旗幟');

        const homeBaseWorld = _v3.set(
          FLAG_BASES[this.localTeam].x,
          FLAG_BASES[this.localTeam].y + 2.4,
          FLAG_BASES[this.localTeam].z,
        );
        homeBaseScreen = this.projectToScreen(homeBaseWorld);
      } else if (this.currentGameMode === 'dom' && this.latestControlZone) {
        const cz = this.latestControlZone;
        const zoneWorld = _v1.set(cz.x, 3.3, cz.z);
        const proj = this.projectToScreen(zoneWorld);
        const label = cz.contested
          ? '據點爭奪中'
          : cz.owner === this.localTeam
            ? '守護據點'
            : cz.owner === 'neutral'
              ? '佔領核心據點'
              : '奪取敵方據點';
        controlZoneScreen = {
          x: proj.x,
          y: proj.y,
          dist: proj.dist,
          label,
          owner: cz.owner,
          contested: cz.contested,
        };
      }

      const pingsScreen: ProjectedPing[] = [];
      for (const pv of this.pingVisuals.values()) {
        _v1.copy(pv.group.position);
        _v1.y += pv.data.targetActorId ? 0.45 : 0.95;
        const proj = this.projectToScreen(_v1);
        pingsScreen.push({
          id: pv.data.id,
          kind: pv.data.kind,
          creatorName: pv.data.creatorName,
          targetName: pv.data.targetName,
          x: proj.x,
          y: proj.y,
          inFront: proj.inFront,
          dist: proj.dist,
          remainingRatio: Math.max(0, Math.min(1, pv.localRemainSec / Math.max(0.1, pv.data.ttlSec))),
          remainingSec: Number(pv.localRemainSec.toFixed(1)),
        });
      }

      this.callbacks.onHudProject({
        enemyFlagScreen,
        homeBaseScreen,
        controlZoneScreen,
        pingsScreen,
      });
    }

    // Dynamic Crosshair Spread & Enemy Hover Detection
    let rawSpread = Math.min(4, this.activeWeaponStats.spread * 75);
    if (this.crouching) rawSpread -= 1.5;
    if (isMoving) rawSpread += sprintingMoving ? 10.5 : 5.5;
    if (!this.grounded) rawSpread += 13;
    rawSpread += this.recoilOffset * 70;
    if (this.aiming) rawSpread *= 0.25;
    const targetSpread = Math.max(0, Math.min(24, rawSpread));
    this.crosshairSpread = THREE.MathUtils.damp(this.crosshairSpread, targetSpread, 16, dt);

    let enemyUnderCrosshair = false;
    if (this.alive && this.isControlActive() && !this.shopOpen && !this.paused) {
      this.camera.getWorldDirection(_v2);
      const ox = this.camera.position.x;
      const oy = this.camera.position.y;
      const oz = this.camera.position.z;
      const maxCheckDist = 140;
      let bestDist = rayIntersectsArenaObstacle(
        ox,
        oy,
        oz,
        _v2.x,
        _v2.y,
        _v2.z,
        maxCheckDist,
        this.mapLayout,
        this.digHp,
      );
      for (const entry of this.remoteActors.values()) {
        if (entry.team === this.localTeam || !entry.rig.root.visible) continue;
        const tx = entry.rig.root.position.x;
        const ty = entry.rig.root.position.y;
        const tz = entry.rig.root.position.z;
        const cr = entry.crouching;

        _hoverHeadBox.minX = tx - 0.34;
        _hoverHeadBox.maxX = tx + 0.34;
        _hoverHeadBox.minY = ty + (cr ? 0.85 : 1.38);
        _hoverHeadBox.maxY = ty + (cr ? 1.35 : 1.9);
        _hoverHeadBox.minZ = tz - 0.34;
        _hoverHeadBox.maxZ = tz + 0.34;
        if (rayIntersectsAABB(ox, oy, oz, _v2.x, _v2.y, _v2.z, _hoverHeadBox, bestDist) !== null) {
          enemyUnderCrosshair = true;
          break;
        }

        _hoverBodyBox.minX = tx - 0.54;
        _hoverBodyBox.maxX = tx + 0.54;
        _hoverBodyBox.minY = ty;
        _hoverBodyBox.maxY = ty + (cr ? 0.94 : 1.44);
        _hoverBodyBox.minZ = tz - 0.54;
        _hoverBodyBox.maxZ = tz + 0.54;
        const tBody = rayIntersectsAABB(ox, oy, oz, _v2.x, _v2.y, _v2.z, _hoverBodyBox, bestDist);
        if (tBody !== null && tBody < bestDist) {
          bestDist = tBody;
          enemyUnderCrosshair = true;
          break;
        }
      }
    }
    this.hoveringEnemy = enemyUnderCrosshair;

    // Throttled Stamina/Vitals & Crosshair sync to React HUD (~30Hz)
    if (this.callbacks.onVitalsUpdate && now - this.lastVitalsTime >= 33) {
      this.lastVitalsTime = now;
      this.callbacks.onVitalsUpdate({
        stamina: Math.round(this.stamina),
        maxStamina: this.maxStamina,
        sprinting: this.sprintingNow,
        exhausted: this.sprintExhausted,
        crosshairSpread: Number(this.crosshairSpread.toFixed(1)),
        hoverEnemy: this.hoveringEnemy,
      });
    }
  }

  private projectToScreen(
    worldPos: THREE.Vector3,
    label?: string,
  ): { x: number; y: number; visible: boolean; inFront: boolean; dist: number; label: string } {
    const dist = Math.round(worldPos.distanceTo(this.camera.position));
    const camDir = _v2;
    this.camera.getWorldDirection(camDir);
    const toTarget = _v4.copy(worldPos).sub(this.camera.position);
    const inFront = toTarget.dot(camDir) > 0;

    const proj = _v4.copy(worldPos).project(this.camera);
    let x = (proj.x * 0.5 + 0.5) * 100;
    let y = (-proj.y * 0.5 + 0.5) * 100;

    if (!inFront) {
      x = 100 - x;
      y = 92;
    }
    x = THREE.MathUtils.clamp(x, 6, 94);
    y = THREE.MathUtils.clamp(y, 12, 88);

    return { x, y, visible: true, inFront, dist, label: label ?? '' };
  }

  private tryPingLocal(): void {
    if (!this.isPlaying || !this.alive || !this.isControlActive() || this.shopOpen || this.paused) return;
    const now = performance.now();
    if (now - this.lastPingTime < 420) return;
    this.lastPingTime = now;

    this.camera.getWorldDirection(_v1);
    this.callbacks.onPing?.(
      {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      },
      { x: _v1.x, y: _v1.y, z: _v1.z },
    );
  }

  private tryDigLocal(): void {
    if (this.mapLayout.mode !== 'underground') return;
    if (!this.isPlaying || !this.alive || !this.isControlActive() || this.shopOpen || this.paused) return;

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

    this.camera.remove(this.audioListener);
    soundEngine.detachListener(this.audioListener);

    this.clearGadgetMeshes();
    this.clearPingVisuals();
    for (const sa of this.slashArcs) {
      this.scene.remove(sa.mesh);
      (sa.mesh.material as THREE.Material).dispose();
    }
    this.slashArcs = [];
    this.controlZoneVisual.dispose();
    this.arenaWorld.dispose();
    this.textures.dispose();
    this.tracerGeo.dispose();
    this.tracerCoreGeo.dispose();
    this.sparkGeo.dispose();
    this.ringGeo.dispose();
    this.slashGeo.dispose();
    this.pingDiamondGeo.dispose();
    this.pingRingGeo.dispose();
    this.pingBeamGeo.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
