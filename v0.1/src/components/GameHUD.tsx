import { useEffect, useRef, useState } from 'react';
import {
  Flag,
  ShoppingBag,
  Coins,
  Volume2,
  VolumeX,
  Pause,
  Heart,
  Flame,
  Cloud,
  Zap,
  Crosshair,
  MapPin,
  Snowflake,
  HeartPulse,
  Gauge,
  Swords,
  Wind,
  ShieldCheck,
  MessageSquare,
  Send,
  Eye,
  ChevronRight,
} from 'lucide-react';
import { GADGETS, GADGET_ORDER, GAME_MODES, WEAPONS, WEAPON_ORDER } from '../shared/gameConfig.ts';
import type {
  ActorSnapshot,
  CrosshairColor,
  CrosshairSettings,
  FlagStatus,
  GadgetId,
  KillFeedEvent,
  MapLayout,
  StateSyncPayload,
  TeamChatMessage,
  WeaponId,
} from '../shared/gameConfig.ts';
import type {
  ArenaEngine,
  ArenaPoseState,
  HudProjection,
  SpectateInfo,
  VitalsState,
} from '../three/ArenaEngine.ts';
import { TacticalMinimap } from './TacticalMinimap.tsx';
import { TouchControls } from './TouchControls.tsx';

interface GameHUDProps {
  state: StateSyncPayload;
  localActor: ActorSnapshot;
  pointerLocked: boolean;
  touchMode: boolean;
  engine: ArenaEngine | null;
  shopOpen: boolean;
  pauseOpen: boolean;
  pose: ArenaPoseState;
  vitals: VitalsState;
  crosshairSettings: CrosshairSettings;
  insideSmoke: boolean;
  hitmarker: 'none' | 'body' | 'head' | 'kill';
  hitBadge: { text: string; tone: 'body' | 'head' | 'kill' } | null;
  damageFlash: boolean;
  feed: KillFeedEvent[];
  chatMessages: TeamChatMessage[];
  chatOpen: boolean;
  projection: HudProjection;
  spectateInfo: SpectateInfo | null;
  damageIndicators: Array<{ id: string; angleDeg: number; ratio: number }>;
  streakBanner: { label: string; count: number } | null;
  mapLayout: MapLayout;
  digHp?: Uint8Array;
  digVersion?: number;
  muted: boolean;
  onToggleMute: () => void;
  onOpenShop: () => void;
  onOpenMenu: () => void;
  onOpenChat: () => void;
  onCloseChat: (relockPointer?: boolean) => void;
  onSendChat: (text: string) => void;
  onSwitchWeapon: (wid: WeaponId) => void;
  onSwitchGadget: (gid: GadgetId) => void;
  onCycleSpectate: () => void;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function flagStatusLabel(status: FlagStatus): string {
  if (status === 'base') return '安全';
  if (status === 'carried') return '奪取中';
  return '掉落';
}

function WeaponSilhouette({ id, active, owned }: { id: WeaponId; active: boolean; owned: boolean }) {
  const stroke = active ? '#67e8f9' : owned ? '#e2e8f0' : '#475569';
  const accent = active ? WEAPONS[id].tracerColor : owned ? '#94a3b8' : '#334155';

  switch (id) {
    case 'pistol':
      return (
        <svg viewBox="0 0 36 24" className="w-7 h-5">
          <rect x="8" y="6" width="18" height="5" rx="1" fill={stroke} />
          <rect x="26" y="7" width="4" height="3" fill={accent} />
          <path d="M10 11 L15 11 L13 19 L8 19 Z" fill={stroke} />
        </svg>
      );
    case 'smg':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <rect x="6" y="7" width="20" height="5.5" rx="1" fill={stroke} />
          <rect x="26" y="8.5" width="6" height="2.5" fill={accent} />
          <rect x="17" y="12.5" width="3.5" height="7" fill={accent} />
          <rect x="8" y="12.5" width="4" height="6" fill={stroke} />
        </svg>
      );
    case 'vector':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <rect x="6" y="7" width="18" height="6" rx="1" fill={stroke} />
          <rect x="24" y="8.5" width="7" height="2.5" fill={accent} />
          <path d="M16 13 L20 13 L17 20 L13 20 Z" fill={accent} />
          <rect x="8" y="13" width="4" height="5.5" fill={stroke} />
        </svg>
      );
    case 'shotgun':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <rect x="3" y="8" width="28" height="4" rx="1" fill={stroke} />
          <rect x="15" y="12" width="10" height="3" fill={accent} />
          <path d="M4 12 L10 12 L7 17 L2 17 Z" fill={stroke} />
        </svg>
      );
    case 'rifle':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <rect x="3" y="8" width="24" height="4.5" rx="1" fill={stroke} />
          <rect x="27" y="9" width="7" height="2.2" fill={accent} />
          <rect x="13" y="5" width="7" height="2.5" fill={accent} />
          <path d="M17 12.5 L20.5 12.5 L22 19 L18.5 19 Z" fill={stroke} />
          <rect x="6" y="12.5" width="4" height="5.5" fill={stroke} />
        </svg>
      );
    case 'burst':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <rect x="4" y="8.5" width="24" height="4" rx="1" fill={stroke} />
          <rect x="28" y="9.5" width="6" height="2" fill={accent} />
          <rect x="11" y="4.5" width="11" height="3" rx="0.8" fill={accent} />
          <rect x="17" y="12.5" width="3" height="6" fill={stroke} />
          <rect x="7" y="12.5" width="4" height="5" fill={stroke} />
        </svg>
      );
    case 'freezer':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <rect x="4" y="8.5" width="22" height="5" rx="1" fill={stroke} />
          <rect x="11" y="5" width="10" height="3" rx="1.2" fill={accent} />
          <rect x="26" y="9" width="7" height="3.5" fill={accent} />
          <rect x="8" y="13.5" width="4" height="5.5" fill={stroke} />
        </svg>
      );
    case 'laser':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <rect x="4" y="8" width="20" height="5" rx="1" fill={stroke} />
          <rect x="24" y="8.2" width="10" height="1.8" fill={accent} />
          <rect x="24" y="11" width="10" height="1.8" fill={stroke} />
          <rect x="13" y="13" width="6" height="4" fill={accent} />
        </svg>
      );
    case 'sniper':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <rect x="2" y="9" width="21" height="4" rx="1" fill={stroke} />
          <rect x="23" y="10" width="12" height="1.8" fill={accent} />
          <rect x="9" y="4.5" width="12" height="3" rx="1" fill={accent} />
          <path d="M5 13 L10 13 L8 18 L3 18 Z" fill={stroke} />
        </svg>
      );
    case 'gatling':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <rect x="4" y="7" width="13" height="9" rx="1.5" fill={stroke} />
          <rect x="17" y="7.5" width="16" height="2" fill={accent} />
          <rect x="17" y="10.5" width="16" height="2" fill={stroke} />
          <rect x="17" y="13.5" width="16" height="2" fill={accent} />
          <rect x="7" y="4" width="6" height="2.5" fill={stroke} />
        </svg>
      );
    case 'autocannon':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <rect x="3" y="7.5" width="18" height="7" rx="1.2" fill={stroke} />
          <rect x="21" y="9" width="11" height="4" fill={stroke} />
          <rect x="30" y="8" width="4" height="6" rx="0.6" fill={accent} />
          <rect x="10" y="14.5" width="6" height="4.5" fill={accent} />
        </svg>
      );
    case 'plasma':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <rect x="4" y="7" width="19" height="8" rx="1.5" fill={stroke} />
          <rect x="23" y="7.5" width="10" height="2.5" fill={accent} />
          <rect x="23" y="12" width="10" height="2.5" fill={accent} />
          <circle cx="13" cy="11" r="2.2" fill={accent} />
        </svg>
      );
    case 'katana':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <path d="M5 17 L12 13 L31 4 L29 8 L13 16 Z" fill={accent} />
          <rect x="10" y="11" width="3" height="6" rx="0.8" transform="rotate(-28 11.5 14)" fill={stroke} />
          <rect x="4" y="16" width="7" height="2.4" rx="0.6" transform="rotate(-28 7.5 17)" fill={stroke} />
        </svg>
      );
    case 'twinblades':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <path d="M4 17 L24 5 L22 9 L6 19 Z" fill={accent} />
          <path d="M12 19 L32 7 L30 11 L14 21 Z" fill={stroke} />
        </svg>
      );
    case 'greatsword':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <path d="M11 13 L29 3 L32 6 L15 17 Z" fill={stroke} />
          <path d="M13 14 L29 5 L30 6.5 L14 15.5 Z" fill={accent} />
          <rect x="9" y="11" width="3" height="8" rx="0.8" transform="rotate(-32 10.5 15)" fill={stroke} />
          <rect x="4" y="16" width="7" height="3" rx="0.6" transform="rotate(-32 7.5 17.5)" fill={accent} />
        </svg>
      );
    case 'plasma_saber':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <rect x="4" y="14" width="9" height="3.2" rx="1" transform="rotate(-25 8 15.5)" fill={stroke} />
          <path d="M12 13 L32 4 L33 6.5 L13 15.5 Z" fill={accent} />
          <path d="M13 13.8 L31.5 5.2" stroke="#ffffff" strokeWidth="1.2" />
        </svg>
      );
  }
}

function GadgetBadgeIcon({ id, className }: { id: GadgetId; className?: string }) {
  if (id === 'frag') return <Flame className={className} />;
  if (id === 'smoke') return <Cloud className={className} />;
  if (id === 'cryo') return <Snowflake className={className} />;
  if (id === 'medkit') return <HeartPulse className={className} />;
  if (id === 'stim') return <Gauge className={className} />;
  return <Zap className={className} />;
}

export function GameHUD({
  state,
  localActor,
  pointerLocked,
  touchMode,
  engine,
  shopOpen,
  pauseOpen,
  pose,
  vitals,
  crosshairSettings,
  insideSmoke,
  hitmarker,
  hitBadge,
  damageFlash,
  feed,
  chatMessages,
  chatOpen,
  projection,
  spectateInfo,
  damageIndicators,
  streakBanner,
  mapLayout,
  digHp,
  digVersion,
  muted,
  onToggleMute,
  onOpenShop,
  onOpenMenu,
  onOpenChat,
  onCloseChat,
  onSendChat,
  onSwitchWeapon,
  onSwitchGadget,
  onCycleSpectate,
}: GameHUDProps) {
  const [chatDraft, setChatDraft] = useState('');
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (chatOpen) {
      setChatDraft('');
      const raf = requestAnimationFrame(() => {
        chatInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [chatOpen]);

  const submitChat = () => {
    const trimmed = chatDraft.trim();
    if (trimmed) {
      onSendChat(trimmed);
    }
    setChatDraft('');
    onCloseChat(true);
  };

  const modeInfo = GAME_MODES.find((m) => m.id === state.gameMode) ?? GAME_MODES[0];
  const enemyTeam = localActor.team === 'red' ? 'blue' : 'red';
  const carryingEnemyFlag = state.gameMode === 'ctf' && state.flags[enemyTeam].carrierId === localActor.id;
  const activeSpec = WEAPONS[localActor.activeWeapon];
  const isMelee = Boolean(activeSpec.isMelee);
  const ownedWeapons = WEAPON_ORDER.filter((wid) => Boolean(localActor.ownedWeapons[wid]));
  const activeGadgetId = localActor.activeGadget ?? 'frag';
  const activeGadgetSpec = GADGETS[activeGadgetId];
  const activeGadgetCount = localActor.gadgets?.[activeGadgetId] ?? 0;
  const totalGadgets = GADGET_ORDER.reduce((sum, gid) => sum + (localActor.gadgets?.[gid] ?? 0), 0);

  const cycleNextGadget = () => {
    const owned = GADGET_ORDER.filter((g) => (localActor.gadgets?.[g] ?? 0) > 0);
    const pool = owned.length > 0 ? owned : GADGET_ORDER;
    const idx = pool.indexOf(activeGadgetId);
    const next = pool[(idx + 1) % pool.length];
    if (next) onSwitchGadget(next);
  };

  const hpSegments = 10;
  const hpRatio = Math.max(0, Math.min(1, localActor.hp / Math.max(1, localActor.maxHp)));
  const filledSegments = Math.ceil(hpRatio * hpSegments);

  const controlActive = pointerLocked || touchMode;
  const showSniperScope =
    localActor.alive && controlActive && !shopOpen && !pauseOpen && !chatOpen && pose.aiming && pose.scopeType === 'sniper';
  const showHoloSight =
    localActor.alive && controlActive && !shopOpen && !pauseOpen && !chatOpen && pose.aiming && pose.scopeType === 'holo';

  const chColorClass = (color: CrosshairColor, hoverEnemy: boolean) => {
    if (hoverEnemy) return 'text-rose-500 drop-shadow-[0_0_6px_rgba(244,63,94,0.85)]';
    if (color === 'cyan') return 'text-cyan-300';
    if (color === 'emerald') return 'text-emerald-400';
    if (color === 'amber') return 'text-amber-300';
    return 'text-white';
  };

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none">
      {/* Smoke Cloud First-Person Haze Overlay */}
      {insideSmoke && localActor.alive && (
        <div
          className="fixed inset-0 pointer-events-none transition-opacity duration-300"
          style={{
            background:
              'radial-gradient(circle at center, rgba(148, 163, 184, 0.54) 0%, rgba(100, 116, 139, 0.72) 100%)',
          }}
        />
      )}

      {/* Subtle Damage Screen Vignette */}
      {damageFlash && (
        <div
          className="fixed inset-0 pointer-events-none transition-opacity duration-150"
          style={{
            boxShadow: 'inset 0 0 90px 28px rgba(239, 68, 68, 0.52)',
          }}
        />
      )}

      {/* Tactical Sniper / 2x Scope Overlay */}
      {showSniperScope && (
        <div className="fixed inset-0 pointer-events-none flex items-center justify-center">
          <div
            className="fixed inset-0"
            style={{
              background:
                'radial-gradient(circle at center, transparent 29%, rgba(5, 8, 15, 0.88) 32%, rgba(5, 8, 15, 0.98) 52%)',
            }}
          />
          <div className="relative w-[60vmin] h-[60vmin] rounded-full border-2 border-cyan-400/60 flex items-center justify-center">
            <div className="absolute inset-x-4 h-[1px] bg-cyan-300/60" />
            <div className="absolute inset-y-4 w-[1px] bg-cyan-300/60" />
            {/* Rangefinder mil ticks */}
            <div className="absolute left-1/2 -translate-x-1/2 top-[38%] w-3 h-[1px] bg-cyan-300/80" />
            <div className="absolute left-1/2 -translate-x-1/2 bottom-[38%] w-3 h-[1px] bg-cyan-300/80" />
            <div className="absolute top-1/2 -translate-y-1/2 left-[38%] h-3 w-[1px] bg-cyan-300/80" />
            <div className="absolute top-1/2 -translate-y-1/2 right-[38%] h-3 w-[1px] bg-cyan-300/80" />
            <div
              className={`w-1.5 h-1.5 rounded-full transition-all duration-75 ${
                vitals.hoverEnemy
                  ? 'bg-rose-500 scale-150 shadow-[0_0_12px_#f43f5e]'
                  : 'bg-cyan-300 shadow-[0_0_8px_#67e8f9]'
              }`}
            />
            <span className="absolute bottom-6 font-mono-num text-[11px] font-bold text-cyan-300/85">
              {pose.weaponId === 'sniper' ? 'OPTIC 4.0×' : 'OPTIC 2.0×'}
            </span>
          </div>
        </div>
      )}

      {/* 3D Projected Objective Waypoints */}
      {localActor.alive && state.gameMode === 'ctf' && projection.enemyFlagScreen && (
        <div
          className="fixed -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 pointer-events-none"
          style={{
            left: `${projection.enemyFlagScreen.x}%`,
            top: `${projection.enemyFlagScreen.y}%`,
          }}
        >
          <div
            className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
              enemyTeam === 'red'
                ? 'bg-red-950/85 border-red-400 text-red-200'
                : 'bg-cyan-950/85 border-cyan-400 text-cyan-200'
            }`}
          >
            敵方旗幟 · <span className="font-mono-num">{projection.enemyFlagScreen.dist}m</span>
          </div>
        </div>
      )}

      {localActor.alive && state.gameMode === 'ctf' && carryingEnemyFlag && projection.homeBaseScreen && (
        <div
          className="fixed -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 pointer-events-none"
          style={{
            left: `${projection.homeBaseScreen.x}%`,
            top: `${projection.homeBaseScreen.y}%`,
          }}
        >
          <div className="px-2.5 py-1 rounded text-xs font-bold bg-amber-500/90 border border-amber-200 text-slate-950">
            帶回我方基地得分 · <span className="font-mono-num">{projection.homeBaseScreen.dist}m</span>
          </div>
        </div>
      )}

      {localActor.alive && state.gameMode === 'dom' && projection.controlZoneScreen && (
        <div
          className="fixed -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 pointer-events-none"
          style={{
            left: `${projection.controlZoneScreen.x}%`,
            top: `${projection.controlZoneScreen.y}%`,
          }}
        >
          <div
            className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
              projection.controlZoneScreen.contested
                ? 'bg-amber-950/90 border-amber-400 text-amber-200'
                : projection.controlZoneScreen.owner === localActor.team
                  ? 'bg-emerald-950/88 border-emerald-400 text-emerald-200'
                  : projection.controlZoneScreen.owner === 'neutral'
                    ? 'bg-slate-900/88 border-slate-400 text-slate-200'
                    : 'bg-rose-950/88 border-rose-400 text-rose-200'
            }`}
          >
            {projection.controlZoneScreen.label} ·{' '}
            <span className="font-mono-num">{projection.controlZoneScreen.dist}m</span>
          </div>
        </div>
      )}

      {/* 3D Projected Teammate Tactical Pings */}
      {localActor.alive &&
        projection.pingsScreen.map((ping) => {
          const isCarrier = ping.kind === 'carrier';
          const isEnemy = ping.kind === 'enemy';
          const badgeStyle = isCarrier
            ? 'bg-amber-950/92 border-amber-400 text-amber-200 shadow-[0_0_14px_rgba(245,158,11,0.35)]'
            : isEnemy
              ? 'bg-rose-950/92 border-rose-400 text-rose-100 shadow-[0_0_14px_rgba(244,63,94,0.35)]'
              : 'bg-cyan-950/90 border-cyan-400 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.28)]';
          const barColor = isCarrier
            ? 'bg-amber-400'
            : isEnemy
              ? 'bg-rose-400'
              : 'bg-cyan-400';
          const title = isCarrier
            ? `旗手 ${ping.targetName ?? ''}`
            : isEnemy
              ? `敵軍 ${ping.targetName ?? ''}`
              : '戰術標記';

          return (
            <div
              key={ping.id}
              className="fixed -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 pointer-events-none"
              style={{
                left: `${ping.x}%`,
                top: `${ping.y}%`,
              }}
            >
              <div className={`px-2 py-1 rounded border text-[11px] font-bold flex items-center gap-1.5 ${badgeStyle}`}>
                {isCarrier ? (
                  <Flag className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                ) : isEnemy ? (
                  <Crosshair className="w-3.5 h-3.5 text-rose-300 shrink-0" />
                ) : (
                  <MapPin className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                )}
                <span className="whitespace-nowrap">{title}</span>
                <span className="font-mono-num text-[10px] opacity-90">{ping.dist}m</span>
                {!ping.inFront && (
                  <span className="text-[9px] px-1 rounded bg-black/45 text-slate-200">後方</span>
                )}
              </div>
              <div className="w-full max-w-[96px] h-[2px] rounded-full bg-slate-900/90 overflow-hidden">
                <div
                  className={`h-full ${barColor}`}
                  style={{ width: `${Math.round(ping.remainingRatio * 100)}%` }}
                />
              </div>
              <span className="text-[9px] text-slate-300/90 bg-[#090d16]/75 px-1.5 rounded">
                {ping.creatorName}
              </span>
            </div>
          );
        })}

      {/* Top-Center Scoreboard, Match Timer & DOM Zone Bar */}
      <div className="fixed top-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-4 px-5 py-2 rounded-lg bg-[#090d16]/88 border border-slate-700/80">
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-semibold text-red-400">紅隊</span>
            <span className="font-mono-num text-2xl font-bold text-white">{state.redScore}</span>
          </div>

          <div className="px-4 border-x border-slate-700/80 text-center min-w-[126px]">
            <div className="font-mono-num text-xl font-bold text-white leading-none">
              {formatTime(state.timeRemaining)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {state.paused
                ? '已暫停'
                : state.overtime
                  ? '延長賽決勝'
                  : `${modeInfo.shortLabel} · 目標 ${state.scoreLimit} ${modeInfo.scoreUnit} · ${state.roomId}`}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="font-mono-num text-2xl font-bold text-white">{state.blueScore}</span>
            <span className="text-xs font-semibold text-cyan-400">藍隊</span>
          </div>
        </div>

        {state.gameMode === 'dom' && state.controlZone && (
          <div className="flex items-center gap-2.5 px-3 py-1 rounded-md bg-[#090d16]/90 border border-slate-700/80 text-[11px]">
            <span
              className={`font-bold ${
                state.controlZone.contested
                  ? 'text-amber-300'
                  : state.controlZone.owner === localActor.team
                    ? 'text-emerald-300'
                    : state.controlZone.owner === 'neutral'
                      ? 'text-slate-300'
                      : 'text-rose-400'
              }`}
            >
              {state.controlZone.contested
                ? '據點爭奪中'
                : state.controlZone.owner === localActor.team
                  ? '己方控制據點'
                  : state.controlZone.owner === 'neutral'
                    ? '中立核心據點'
                    : '敵方控制據點'}
            </span>
            <div className="w-28 h-2 rounded bg-slate-900 border border-slate-700 overflow-hidden">
              <div
                className={`h-full transition-all duration-100 ${
                  state.controlZone.captureTeam === 'red'
                    ? 'bg-red-500'
                    : state.controlZone.captureTeam === 'blue'
                      ? 'bg-cyan-400'
                      : 'bg-slate-500'
                }`}
                style={{ width: `${Math.round(state.controlZone.progress * 100)}%` }}
              />
            </div>
            <span className="font-mono-num text-slate-300 w-9 text-right">
              {Math.round(state.controlZone.progress * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Top-Left Quick Action Buttons */}
      <div className="fixed top-3 left-3 flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          onClick={onOpenMenu}
          className="px-3 py-2 rounded-lg bg-[#090d16]/88 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <Pause className="w-3.5 h-3.5 text-cyan-400" />
          選單 [ESC]
        </button>
        <button
          type="button"
          onClick={onOpenShop}
          className="px-3 py-2 rounded-lg bg-[#090d16]/88 hover:bg-slate-800 border border-amber-500/50 text-amber-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          軍械庫 [B]
        </button>
        <button
          type="button"
          onClick={onOpenChat}
          className="px-2.5 py-2 rounded-lg bg-[#090d16]/88 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          title="隊伍聊天 [Enter]"
        >
          <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden sm:inline">隊伍</span> [Enter]
        </button>
        <button
          type="button"
          onClick={onToggleMute}
          className="p-2 rounded-lg bg-[#090d16]/88 hover:bg-slate-800 border border-slate-700 text-slate-300"
          title={muted ? '開啟音效' : '靜音'}
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>

      {/* Top-Right Tactical Mini-Map */}
      <TacticalMinimap
        state={state}
        localActor={localActor}
        mapLayout={mapLayout}
        digHp={digHp}
        digVersion={digVersion}
      />

      {/* Top-Right Team Chat (briefly above Feed) + Kill & Flag Event Feed */}
      <div className="fixed top-[188px] right-3 flex flex-col items-end gap-1.5 w-72 sm:w-80">
        {/* Ephemeral Team Chat Messages */}
        {(chatMessages.length > 0 || chatOpen) && (
          <div className="w-full flex flex-col items-end gap-1 mb-0.5">
            {chatMessages.map((msg) => {
              const isRed = msg.team === 'red';
              return (
                <div
                  key={msg.id}
                  className={`max-w-full px-2.5 py-1.5 rounded bg-[#090d16]/92 border border-slate-700/80 border-l-2 text-xs text-slate-100 shadow-lg ${
                    isRed ? 'border-l-red-400' : 'border-l-cyan-400'
                  }`}
                >
                  <span
                    className={`inline-block text-[10px] font-bold px-1 py-0.2 rounded mr-1.5 ${
                      isRed ? 'bg-red-500/20 text-red-300' : 'bg-cyan-500/20 text-cyan-300'
                    }`}
                  >
                    隊伍
                  </span>
                  <span className={`font-semibold mr-1 ${isRed ? 'text-red-300' : 'text-cyan-300'}`}>
                    {msg.senderName}:
                  </span>
                  <span className="break-words text-slate-100">{msg.text}</span>
                </div>
              );
            })}

            {chatOpen && (
              <div className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#090d16]/96 border border-cyan-400/70 shadow-xl pointer-events-auto">
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                    localActor.team === 'red'
                      ? 'bg-red-500/25 text-red-300'
                      : 'bg-cyan-500/25 text-cyan-300'
                  }`}
                >
                  隊伍
                </span>
                <input
                  ref={chatInputRef}
                  type="text"
                  maxLength={120}
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitChat();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setChatDraft('');
                      onCloseChat(true);
                    }
                  }}
                  placeholder="輸入隊伍訊息，Enter 傳送 / Esc 取消"
                  className="flex-1 min-w-0 bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={submitChat}
                  className="p-1 rounded bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-300 transition-colors shrink-0"
                  title="傳送訊息"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {feed.slice(0, 4).map((ev) => (
          <div
            key={ev.id}
            className="px-3 py-1.5 rounded bg-[#090d16]/85 border border-slate-800 text-xs text-slate-200 flex items-center gap-1.5"
          >
            <span className={ev.actorTeam === 'red' ? 'text-red-400 font-semibold' : 'text-cyan-400 font-semibold'}>
              {ev.actorName}
            </span>
            {ev.type === 'kill' && (
              <>
                <span className="text-slate-400">
                  {ev.gadgetId === 'frag'
                    ? '手榴彈炸死'
                    : ev.gadgetId === 'emp'
                      ? '震撼彈擊殺'
                      : ev.gadgetId === 'cryo'
                        ? '冷凍雷擊殺'
                        : ev.headshot
                          ? '爆頭擊殺'
                          : '擊殺'}
                </span>
                <span className={ev.targetTeam === 'red' ? 'text-red-400 font-semibold' : 'text-cyan-400 font-semibold'}>
                  {ev.targetName}
                </span>
              </>
            )}
            {ev.type === 'pickup' && <span className="text-amber-300">奪取了旗幟</span>}
            {ev.type === 'capture' && <span className="text-emerald-300 font-bold">成功搶旗得分！</span>}
            {ev.type === 'return' && <span className="text-sky-300">護送旗幟歸位</span>}
            {ev.type === 'drop' && <span className="text-slate-400">掉落了旗幟</span>}
            {ev.type === 'zone_capture' && <span className="text-emerald-300 font-bold">佔領了中央據點！</span>}
          </div>
        ))}
      </div>

      {/* Flag Carrier Alert Banner */}
      {carryingEnemyFlag && localActor.alive && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 px-5 py-2 rounded-lg bg-amber-500/92 border border-amber-200 text-slate-950 font-bold text-sm flex items-center gap-2">
          <Flag className="w-4 h-4" />
          您正在攜帶敵方旗幟！請返回我方基地底座得分！
        </div>
      )}

      {/* Kill-Streak Banner */}
      {streakBanner && localActor.alive && (
        <div
          className={`fixed left-1/2 -translate-x-1/2 px-5 py-1.5 rounded-lg bg-[#090d16]/92 border border-amber-400/75 text-center shadow-[0_0_24px_rgba(251,191,36,0.28)] pointer-events-none ${
            carryingEnemyFlag ? 'top-32' : state.gameMode === 'dom' ? 'top-26' : 'top-20'
          }`}
        >
          <div className="font-display text-base font-bold tracking-wider text-amber-300">
            {streakBanner.label}
          </div>
        </div>
      )}

      {/* Directional Damage Indicator Ring */}
      {localActor.alive && damageIndicators.length > 0 && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-52 h-52 pointer-events-none">
          {damageIndicators.map((ind) => (
            <div
              key={ind.id}
              className="absolute inset-0 flex justify-center items-start"
              style={{
                transform: `rotate(${ind.angleDeg}deg)`,
                opacity: Math.max(0.15, ind.ratio),
              }}
            >
              <div className="w-12 h-3 flex flex-col items-center">
                <div className="w-0 h-0 border-l-[10px] border-r-[10px] border-b-[11px] border-l-transparent border-r-transparent border-b-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.95)]" />
                <div className="w-9 h-1 rounded-full bg-rose-500/90 mt-0.5" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Center Crosshair & Hitmarker */}
      {localActor.alive && controlActive && !shopOpen && !pauseOpen && !chatOpen && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          {!showSniperScope &&
            (() => {
              const hoverEnemy = vitals.hoverEnemy;
              const spread = vitals.crosshairSpread;
              const size = crosshairSettings.size;
              const chStyle = crosshairSettings.style;
              const gap = (4 + spread) * size;
              const tickLen = Math.round(7 * size);
              const circleDiameter = Math.round((18 + spread * 1.9) * size);
              const colorClass = chColorClass(crosshairSettings.color, hoverEnemy);

              return (
                <div className={`relative flex items-center justify-center transition-colors duration-75 ${colorClass}`}>
                  {showHoloSight ? (
                    <>
                      <div
                        className={`rounded-sm border transition-all duration-75 ${
                          hoverEnemy ? 'border-rose-500/90' : 'border-cyan-400/75'
                        }`}
                        style={{
                          width: `${Math.round(24 + spread * 0.7)}px`,
                          height: `${Math.round(24 + spread * 0.7)}px`,
                        }}
                      />
                      <div
                        className={`absolute w-1.5 h-1.5 rounded-full ${
                          hoverEnemy ? 'bg-rose-500' : 'bg-cyan-300'
                        }`}
                      />
                    </>
                  ) : (
                    <>
                      {(chStyle === 'dot' || crosshairSettings.showDot) && (
                        <div
                          className="rounded-full bg-current"
                          style={{
                            width: `${Math.round((chStyle === 'dot' ? 6 : 3.5) * size)}px`,
                            height: `${Math.round((chStyle === 'dot' ? 6 : 3.5) * size)}px`,
                          }}
                        />
                      )}

                      {chStyle === 'dot' && spread > 2 && (
                        <div
                          className="absolute rounded-full border border-current/55 transition-all duration-75"
                          style={{
                            width: `${Math.round((10 + spread * 1.4) * size)}px`,
                            height: `${Math.round((10 + spread * 1.4) * size)}px`,
                          }}
                        />
                      )}

                      {(chStyle === 'circle' || chStyle === 'tactical') && (
                        <div
                          className={`absolute rounded-full border transition-all duration-75 ${
                            chStyle === 'circle' ? 'border-current/85 border-[1.5px]' : 'border-current/45'
                          }`}
                          style={{
                            width: `${circleDiameter}px`,
                            height: `${circleDiameter}px`,
                          }}
                        />
                      )}

                      {(chStyle === 'cross' || chStyle === 'tactical') && (
                        <>
                          <div
                            className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-current rounded-full"
                            style={{
                              height: `${tickLen}px`,
                              bottom: `${gap}px`,
                            }}
                          />
                          <div
                            className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-current rounded-full"
                            style={{
                              height: `${tickLen}px`,
                              top: `${gap}px`,
                            }}
                          />
                          <div
                            className="absolute top-1/2 -translate-y-1/2 h-[2px] bg-current rounded-full"
                            style={{
                              width: `${tickLen}px`,
                              right: `${gap}px`,
                            }}
                          />
                          <div
                            className="absolute top-1/2 -translate-y-1/2 h-[2px] bg-current rounded-full"
                            style={{
                              width: `${tickLen}px`,
                              left: `${gap}px`,
                            }}
                          />
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

          {hitmarker !== 'none' && (
            <div
              className={`absolute inset-0 flex items-center justify-center transition-transform duration-75 ${
                hitmarker === 'kill'
                  ? 'scale-125 text-rose-400'
                  : hitmarker === 'head'
                    ? 'scale-115 text-red-400'
                    : 'scale-100 text-amber-300'
              }`}
            >
              <span className="w-4 h-[2px] bg-current rotate-45 absolute" />
              <span className="w-4 h-[2px] bg-current -rotate-45 absolute" />
              {hitmarker === 'kill' && (
                <span className="w-7 h-7 rounded-full border-2 border-rose-400/90 absolute" />
              )}
            </div>
          )}

          {hitBadge && (
            <div
              className={`absolute top-9 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono-num text-xs font-bold px-2 py-0.5 rounded bg-[#090d16]/85 border ${
                hitBadge.tone === 'kill'
                  ? 'border-rose-400 text-rose-300'
                  : hitBadge.tone === 'head'
                    ? 'border-amber-400 text-amber-300'
                    : 'border-slate-600 text-slate-100'
              }`}
            >
              {hitBadge.text}
            </div>
          )}
        </div>
      )}

      {/* Non-Blocking Teammate Spectator Bar during Respawn */}
      {!localActor.alive && (
        <div className="fixed bottom-40 sm:bottom-44 left-1/2 -translate-x-1/2 max-w-[92vw] pointer-events-none">
          <div className="px-4 py-2.5 rounded-xl bg-[#090d16]/90 border border-slate-700/85 shadow-2xl flex flex-wrap items-center justify-center gap-3 text-xs">
            <span className="px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/50 text-rose-300 font-bold font-mono-num">
              重整復活 {localActor.respawnTimer.toFixed(1)}s
            </span>

            {spectateInfo && spectateInfo.aliveTeammateCount > 0 ? (
              <>
                <div className="flex items-center gap-2 text-slate-200">
                  <Eye className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="text-slate-400">觀戰隊友：</span>
                  <span className="font-bold text-white">{spectateInfo.targetName}</span>
                  <span className="font-mono-num text-emerald-300">
                    HP {spectateInfo.hp}/{spectateInfo.maxHp}
                  </span>
                  <span className="hidden sm:inline text-cyan-300">{spectateInfo.weaponName}</span>
                </div>
                <button
                  type="button"
                  onClick={onCycleSpectate}
                  className="pointer-events-auto px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-100 font-semibold flex items-center gap-1 transition-colors"
                >
                  <span>[空白鍵 / 點擊] 切換隊友 ({spectateInfo.aliveTeammateCount})</span>
                  <ChevronRight className="w-3.5 h-3.5 text-cyan-300" />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-1.5 text-slate-300">
                <Eye className="w-3.5 h-3.5 text-slate-400" />
                <span>全隊陣亡重整中 · 高空戰場視角</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Touch Controls Overlay for Phones & Tablets */}
      {touchMode && localActor.alive && !shopOpen && !pauseOpen && !chatOpen && (
        <TouchControls
          engine={engine}
          isMelee={isMelee}
          isUnderground={state.mapMode === 'underground'}
          crouching={pose.crouching}
          aiming={pose.aiming}
          gadgetCount={activeGadgetCount}
        />
      )}

      {/* Enlarged Bottom-Right Ammo / Blade Bar + Numbers Panel */}
      <div
        className={`fixed right-3 sm:right-4 w-56 sm:w-72 rounded-xl bg-[#090d16]/92 border-2 border-slate-700/85 px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-2xl pointer-events-none ${
          touchMode ? 'top-16 sm:top-auto sm:bottom-4' : 'bottom-3 sm:bottom-4'
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {isMelee && <Swords className="w-4 h-4 shrink-0 text-cyan-300" />}
            <span className="font-display text-sm font-bold text-slate-100 truncate">
              {activeSpec.name}
            </span>
          </div>
          <span className="text-[11px] font-mono-num text-slate-400 shrink-0">
            {isMelee ? `${activeSpec.range}m 斬擊` : '[R] 換彈'}
          </span>
        </div>

        {isMelee ? (
          <>
            <div className="flex items-baseline justify-between">
              <span className="font-mono-num text-3xl sm:text-4xl font-bold text-cyan-300 leading-none">
                ∞ 近戰
              </span>
              <span className="font-mono-num text-xs font-bold text-slate-300">
                傷 {activeSpec.damage} · 速 {Math.round(activeSpec.moveSpeedMult * 100)}%
              </span>
            </div>
            <div className="mt-2.5 h-3 w-full rounded bg-slate-900 border border-slate-700/90 overflow-hidden p-0.5">
              <div
                className="h-full rounded-[2px] w-full"
                style={{ backgroundColor: activeSpec.tracerColor }}
              />
            </div>
          </>
        ) : (
          (() => {
            const maxAmmo = Math.max(1, localActor.maxAmmo);
            const ammoRatio = Math.max(0, Math.min(1, localActor.ammo / maxAmmo));
            const lowAmmo = localActor.ammo <= Math.max(2, Math.ceil(maxAmmo * 0.25));
            return (
              <>
                <div className="flex items-baseline justify-between">
                  {localActor.reloading ? (
                    <span className="font-display text-2xl sm:text-3xl font-bold text-amber-400 leading-none">
                      換彈中...
                    </span>
                  ) : (
                    <div className="flex items-baseline gap-1.5 leading-none">
                      <span
                        className={`font-mono-num text-4xl sm:text-5xl font-bold tracking-tight ${
                          lowAmmo ? 'text-rose-400' : 'text-white'
                        }`}
                      >
                        {localActor.ammo}
                      </span>
                      <span className="font-mono-num text-lg sm:text-xl font-semibold text-slate-400">
                        / {localActor.maxAmmo}
                      </span>
                    </div>
                  )}
                  <span className="font-mono-num text-xs font-semibold text-slate-400">
                    {Math.round(ammoRatio * 100)}%
                  </span>
                </div>

                <div className="mt-2.5 h-3.5 w-full rounded bg-slate-900 border border-slate-700/90 overflow-hidden p-0.5">
                  <div
                    className={`h-full rounded-[2px] transition-all duration-100 ${
                      localActor.reloading
                        ? 'bg-amber-400'
                        : lowAmmo
                          ? 'bg-rose-500'
                          : 'bg-cyan-400'
                    }`}
                    style={{ width: `${localActor.reloading ? 100 : Math.round(ammoRatio * 100)}%` }}
                  />
                </div>
              </>
            );
          })()
        )}
      </div>

      {/* Bottom-Center HUD: Tactical Info, Health + Stamina Bars & Weapon Hotbar */}
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 max-w-[94vw] pointer-events-auto">
        {/* Compact Tactical Info Row */}
        <div className="w-full flex items-center justify-between gap-3 px-2.5 py-1 rounded bg-[#090d16]/82 border border-slate-800/90 text-[11px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={localActor.team === 'red' ? 'text-red-400 font-bold' : 'text-cyan-400 font-bold'}>
              {localActor.team === 'red' ? '紅隊' : '藍隊'}
            </span>
            <span className="font-mono-num text-slate-400">
              殺 {localActor.kills} · 助 {localActor.assists}
              {state.gameMode === 'ctf'
                ? ` · 奪 ${localActor.captures}`
                : state.gameMode === 'dom'
                  ? ` · 據點 ${localActor.zoneScore}`
                  : ''}
            </span>
            {pose.crouching && (
              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-semibold text-[10px]">
                蹲姿
              </span>
            )}
            {pose.aiming && (
              <span className="px-1.5 py-0.5 rounded bg-cyan-950/90 border border-cyan-500/40 text-cyan-200 font-semibold text-[10px]">
                開鏡
              </span>
            )}
            {localActor.boosted && (
              <span className="px-1.5 py-0.5 rounded bg-yellow-950/90 border border-yellow-400/60 text-yellow-200 font-semibold text-[10px]">
                超頻加速
              </span>
            )}
            {localActor.slowed && (
              <span className="px-1.5 py-0.5 rounded bg-purple-950/90 border border-purple-400/60 text-purple-200 font-semibold text-[10px]">
                減速受創
              </span>
            )}
            {insideSmoke && (
              <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-500 text-slate-200 font-semibold text-[10px]">
                煙霧掩護中
              </span>
            )}
            {state.mapMode === 'underground' && (
              <span className="px-1.5 py-0.5 rounded bg-amber-950/90 border border-amber-500/40 text-amber-200 font-semibold text-[10px]">
                [E]/射擊 挖掘隧道
              </span>
            )}
            {localActor.devMode && (
              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400 text-amber-200 font-bold text-[10px] flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-amber-300" />
                DEV 無敵 · 全武器 [F8]
              </span>
            )}
            <span className="px-1.5 py-0.5 rounded bg-slate-800/90 border border-slate-600/80 text-slate-300 font-semibold text-[10px] hidden lg:inline">
              [Shift] 衝刺 · [F] 標記 · [Enter] 隊伍聊天 · [F8] 開發者
            </span>
          </div>

          {state.gameMode === 'ctf' && (
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-slate-400 hidden sm:inline">
                紅旗:<span className="text-red-300 ml-0.5">{flagStatusLabel(state.flags.red.status)}</span>{' '}
                藍旗:<span className="text-cyan-300 ml-0.5">{flagStatusLabel(state.flags.blue.status)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Health Bar + Stamina Bar + Money directly above Hotbar */}
        <div className="w-full flex flex-wrap items-center justify-between gap-3 px-3 py-1.5 rounded bg-[#090d16]/88 border border-slate-700/80">
          <div className="flex items-center gap-2">
            <Heart
              className={`w-4 h-4 shrink-0 ${
                localActor.hp > 50
                  ? 'text-emerald-400 fill-emerald-400'
                  : localActor.hp > 25
                    ? 'text-amber-400 fill-amber-400'
                    : 'text-rose-500 fill-rose-500'
              }`}
            />
            <div className="flex items-center gap-0.5">
              {Array.from({ length: hpSegments }).map((_, idx) => {
                const filled = idx < filledSegments;
                const colorClass =
                  localActor.hp > 50
                    ? 'bg-emerald-400 border-emerald-200/40'
                    : localActor.hp > 25
                      ? 'bg-amber-400 border-amber-200/40'
                      : 'bg-rose-500 border-rose-300/40';
                return (
                  <div
                    key={idx}
                    className={`w-3 sm:w-3.5 h-3 rounded-[2px] border transition-colors ${
                      filled ? colorClass : 'bg-slate-900 border-slate-700/80'
                    }`}
                  />
                );
              })}
            </div>
            <span className="font-mono-num text-sm font-bold text-white ml-0.5">
              {localActor.hp}
              <span className="text-[11px] text-slate-500 font-normal">/{localActor.maxHp}</span>
            </span>
            {localActor.devMode ? (
              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/70 text-amber-200 font-bold text-[10px]">
                免疫傷害
              </span>
            ) : (
              localActor.regenerating && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-400/50 text-emerald-300 font-semibold text-[10px]">
                  +回復中
                </span>
              )
            )}
          </div>

          {/* Stamina Bar */}
          <div className="flex items-center gap-2">
            <Wind
              className={`w-4 h-4 shrink-0 ${
                localActor.boosted
                  ? 'text-yellow-300'
                  : vitals.exhausted
                    ? 'text-rose-400'
                    : 'text-sky-400'
              }`}
            />
            <div className="w-24 sm:w-28 h-2.5 rounded bg-slate-900 border border-slate-700/90 overflow-hidden p-[1px]">
              <div
                className={`h-full rounded-[1px] transition-all duration-75 ${
                  localActor.boosted
                    ? 'bg-yellow-300'
                    : vitals.exhausted
                      ? 'bg-amber-500'
                      : 'bg-sky-400'
                }`}
                style={{
                  width: `${Math.max(0, Math.min(100, Math.round((vitals.stamina / Math.max(1, vitals.maxStamina)) * 100)))}%`,
                }}
              />
            </div>
            <span className="font-mono-num text-xs font-bold text-sky-200 min-w-[3.2rem]">
              {localActor.boosted ? '∞' : vitals.stamina}
              <span className="text-[10px] text-slate-500 font-normal">/{vitals.maxStamina}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 font-mono-num text-base font-bold text-amber-300">
            <Coins className="w-4 h-4 text-amber-400" />${localActor.money.toLocaleString()}
          </div>
        </div>

        {/* Owned-Weapon Hotbar (1..9, 0 + Gadget + Armory) */}
        <div className="flex flex-wrap items-center justify-center gap-1 p-1 rounded-md bg-[#090d16]/94 border-2 border-slate-700/90 shadow-2xl max-w-[90vw]">
          {ownedWeapons.map((wid, idx) => {
            const spec = WEAPONS[wid];
            const active = localActor.activeWeapon === wid;
            const keyLabel = idx < 9 ? String(idx + 1) : idx === 9 ? '0' : '·';
            const compact = ownedWeapons.length > 10;
            return (
              <button
                key={wid}
                type="button"
                onClick={() => onSwitchWeapon(wid)}
                title={`${keyLabel}. ${spec.name}`}
                className={`relative rounded-[3px] border-2 flex flex-col items-center justify-center transition-colors ${
                  compact ? 'w-11 h-10 sm:w-12 sm:h-11' : 'w-12 h-11 sm:w-14 sm:h-13'
                } ${
                  active
                    ? 'bg-cyan-950/70 border-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.3)]'
                    : 'bg-[#0f172a] border-slate-600/85 hover:border-slate-400'
                }`}
              >
                <span className="absolute top-0.5 left-1 font-mono-num text-[9px] font-bold text-slate-400 leading-none">
                  {keyLabel}
                </span>
                <WeaponSilhouette id={wid} active={active} owned={true} />
                <span className="font-mono-num text-[9px] leading-none mt-0.5 truncate max-w-[92%]">
                  <span className={active ? 'text-cyan-200 font-bold' : 'text-slate-300'}>
                    {spec.name.slice(0, 3)}
                  </span>
                </span>
              </button>
            );
          })}

          {/* Tactical Equipment Slot (G to use/throw, Q or click to cycle) */}
          <button
            type="button"
            onClick={cycleNextGadget}
            title={`${activeGadgetSpec.name} · [G] 使用/投擲 · [Q] 切換 (總庫存 ${totalGadgets})`}
            className={`relative w-12 h-11 sm:w-14 sm:h-13 rounded-[3px] border-2 flex flex-col items-center justify-center transition-colors ${
              activeGadgetCount > 0
                ? 'bg-[#12192b] border-amber-400/75 hover:border-amber-300 text-white'
                : 'bg-[#070b12] border-slate-800/80 text-slate-500 hover:border-slate-700'
            }`}
          >
            <span className="absolute top-0.5 left-1 font-mono-num text-[9px] font-bold text-amber-300 leading-none">
              G
            </span>
            <span className="absolute top-0.5 right-1 font-mono-num text-[9px] font-bold text-slate-200 leading-none">
              ×{activeGadgetCount}
            </span>
            <div style={{ color: activeGadgetCount > 0 ? activeGadgetSpec.accentColor : '#64748b' }}>
              <GadgetBadgeIcon id={activeGadgetId} className="w-4 h-4" />
            </div>
            <span className="font-mono-num text-[9px] leading-none mt-0.5 truncate max-w-[92%]">
              {activeGadgetSpec.name.slice(0, 3)}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenShop}
            title="軍械庫商店 [B]"
            className="w-13 h-11 sm:w-15 sm:h-13 rounded-[3px] border-2 border-amber-500/60 bg-amber-950/40 hover:bg-amber-900/50 flex flex-col items-center justify-center gap-0.5 text-amber-300 transition-colors"
          >
            <ShoppingBag className="w-4 h-4" />
            <span className="font-mono-num text-[9px] font-bold leading-none">
              [B] {ownedWeapons.length}/{WEAPON_ORDER.length}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
