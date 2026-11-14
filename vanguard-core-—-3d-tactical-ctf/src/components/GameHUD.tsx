import { Flag, ShoppingBag, Coins, Volume2, VolumeX, Pause, Heart, Flame, Cloud, Zap } from 'lucide-react';
import { GADGETS, GADGET_ORDER, WEAPONS, WEAPON_ORDER } from '../shared/gameConfig.ts';
import type {
  ActorSnapshot,
  FlagStatus,
  GadgetId,
  KillFeedEvent,
  MapLayout,
  StateSyncPayload,
  WeaponId,
} from '../shared/gameConfig.ts';
import type { ArenaPoseState, HudProjection } from '../three/ArenaEngine.ts';
import { TacticalMinimap } from './TacticalMinimap.tsx';

interface GameHUDProps {
  state: StateSyncPayload;
  localActor: ActorSnapshot;
  pointerLocked: boolean;
  shopOpen: boolean;
  pauseOpen: boolean;
  pose: ArenaPoseState;
  insideSmoke: boolean;
  hitmarker: 'none' | 'body' | 'head' | 'kill';
  hitBadge: { text: string; tone: 'body' | 'head' | 'kill' } | null;
  damageFlash: boolean;
  feed: KillFeedEvent[];
  projection: HudProjection;
  mapLayout: MapLayout;
  digHp?: Uint8Array;
  digVersion?: number;
  muted: boolean;
  onToggleMute: () => void;
  onOpenShop: () => void;
  onOpenMenu: () => void;
  onSwitchWeapon: (wid: WeaponId) => void;
  onSwitchGadget: (gid: GadgetId) => void;
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
    case 'plasma':
      return (
        <svg viewBox="0 0 36 24" className="w-8 h-5">
          <rect x="4" y="7" width="19" height="8" rx="1.5" fill={stroke} />
          <rect x="23" y="7.5" width="10" height="2.5" fill={accent} />
          <rect x="23" y="12" width="10" height="2.5" fill={accent} />
          <circle cx="13" cy="11" r="2.2" fill={accent} />
        </svg>
      );
  }
}

export function GameHUD({
  state,
  localActor,
  pointerLocked,
  shopOpen,
  pauseOpen,
  pose,
  insideSmoke,
  hitmarker,
  hitBadge,
  damageFlash,
  feed,
  projection,
  mapLayout,
  digHp,
  digVersion,
  muted,
  onToggleMute,
  onOpenShop,
  onOpenMenu,
  onSwitchWeapon,
  onSwitchGadget,
}: GameHUDProps) {
  const enemyTeam = localActor.team === 'red' ? 'blue' : 'red';
  const carryingEnemyFlag = state.flags[enemyTeam].carrierId === localActor.id;
  const activeSpec = WEAPONS[localActor.activeWeapon];
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

  const showSniperScope =
    localActor.alive && pointerLocked && !shopOpen && !pauseOpen && pose.aiming && pose.scopeType === 'sniper';
  const showHoloSight =
    localActor.alive && pointerLocked && !shopOpen && !pauseOpen && pose.aiming && pose.scopeType === 'holo';

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
            <div className="w-1.5 h-1.5 rounded-full bg-rose-400 shadow-[0_0_8px_#fb7185]" />
            <span className="absolute bottom-6 font-mono-num text-[11px] font-bold text-cyan-300/85">
              {pose.weaponId === 'sniper' ? 'OPTIC 4.0×' : 'OPTIC 2.0×'}
            </span>
          </div>
        </div>
      )}

      {/* 3D Projected Objective Waypoints */}
      {localActor.alive && projection.enemyFlagScreen && (
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

      {localActor.alive && carryingEnemyFlag && projection.homeBaseScreen && (
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

      {/* Top-Center Scoreboard & Match Timer */}
      <div className="fixed top-3 left-1/2 -translate-x-1/2 flex items-center gap-4 px-5 py-2 rounded-lg bg-[#090d16]/88 border border-slate-700/80">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold text-red-400">紅隊</span>
          <span className="font-mono-num text-2xl font-bold text-white">{state.redScore}</span>
        </div>

        <div className="px-4 border-x border-slate-700/80 text-center min-w-[106px]">
          <div className="font-mono-num text-xl font-bold text-white leading-none">
            {formatTime(state.timeRemaining)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {state.paused ? '已暫停' : state.overtime ? '延長賽搶先得分' : `目標 ${state.scoreLimit} 旗 · ${state.roomId}`}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="font-mono-num text-2xl font-bold text-white">{state.blueScore}</span>
          <span className="text-xs font-semibold text-cyan-400">藍隊</span>
        </div>
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

      {/* Top-Right Kill & Flag Event Feed (positioned cleanly below Mini-Map) */}
      <div className="fixed top-[188px] right-3 flex flex-col items-end gap-1.5 w-72">
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

      {/* Center Crosshair & Hitmarker */}
      {localActor.alive && pointerLocked && !shopOpen && !pauseOpen && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          {!showSniperScope && (
            <div className="relative w-8 h-8 flex items-center justify-center">
              <div className={`w-1 h-1 rounded-full ${showHoloSight ? 'bg-cyan-300' : 'bg-white'}`} />
              {showHoloSight ? (
                <div className="w-6 h-6 border border-cyan-400/75 rounded-sm" />
              ) : (
                <>
                  <div
                    className={`absolute left-1/2 -translate-x-1/2 w-[2px] h-1.5 bg-white/85 transition-all ${
                      pose.crouching || pose.aiming ? 'top-1.5' : 'top-0.5'
                    }`}
                  />
                  <div
                    className={`absolute left-1/2 -translate-x-1/2 w-[2px] h-1.5 bg-white/85 transition-all ${
                      pose.crouching || pose.aiming ? 'bottom-1.5' : 'bottom-0.5'
                    }`}
                  />
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 h-[2px] w-1.5 bg-white/85 transition-all ${
                      pose.crouching || pose.aiming ? 'left-1.5' : 'left-0.5'
                    }`}
                  />
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 h-[2px] w-1.5 bg-white/85 transition-all ${
                      pose.crouching || pose.aiming ? 'right-1.5' : 'right-0.5'
                    }`}
                  />
                </>
              )}
            </div>
          )}

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

      {/* Respawn Overlay */}
      {!localActor.alive && (
        <div className="fixed inset-0 flex items-center justify-center bg-red-950/35">
          <div className="px-8 py-6 rounded-xl bg-[#090d16]/94 border border-red-500/50 text-center space-y-2">
            <p className="font-display text-2xl font-bold text-red-400">已陣亡</p>
            <p className="text-sm text-slate-300">
              正在基地重整裝備，倒數{' '}
              <span className="font-mono-num text-white font-bold">{localActor.respawnTimer.toFixed(1)}s</span>
            </p>
          </div>
        </div>
      )}

      {/* Bottom-Center Minecraft-Style HUD: Health & Money above Weapon Hotbar */}
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 max-w-[96vw] pointer-events-auto">
        {/* Compact Tactical Info Row */}
        <div className="w-full flex items-center justify-between gap-3 px-2.5 py-1 rounded bg-[#090d16]/82 border border-slate-800/90 text-[11px]">
          <div className="flex items-center gap-2">
            <span className={localActor.team === 'red' ? 'text-red-400 font-bold' : 'text-cyan-400 font-bold'}>
              {localActor.team === 'red' ? '紅隊' : '藍隊'}
            </span>
            <span className="font-mono-num text-slate-400">
              殺 {localActor.kills} · 奪 {localActor.captures}
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
            {localActor.slowed && (
              <span className="px-1.5 py-0.5 rounded bg-purple-950/90 border border-purple-400/60 text-purple-200 font-semibold text-[10px]">
                電磁減速
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
          </div>

          <div className="flex items-center gap-3">
            <span className="text-slate-400 hidden sm:inline">
              紅旗:<span className="text-red-300 ml-0.5">{flagStatusLabel(state.flags.red.status)}</span>{' '}
              藍旗:<span className="text-cyan-300 ml-0.5">{flagStatusLabel(state.flags.blue.status)}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-200 font-semibold">{activeSpec.name}</span>
              {localActor.reloading ? (
                <span className="font-mono-num text-amber-400 font-bold">換彈中...</span>
              ) : (
                <span className="font-mono-num text-white font-bold">
                  {localActor.ammo}
                  <span className="text-slate-500">/{localActor.maxAmmo}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Minecraft-Style Segmented Health Bar (Left) + Money (Right) directly above Hotbar */}
        <div className="w-full flex items-center justify-between gap-4 px-2.5 py-1.5 rounded bg-[#090d16]/88 border border-slate-700/80">
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
                    className={`w-3.5 sm:w-4 h-3 rounded-[2px] border transition-colors ${
                      filled ? colorClass : 'bg-slate-900 border-slate-700/80'
                    }`}
                  />
                );
              })}
            </div>
            <span className="font-mono-num text-sm font-bold text-white ml-1">
              {localActor.hp}
              <span className="text-[11px] text-slate-500 font-normal">/{localActor.maxHp}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 font-mono-num text-base font-bold text-amber-300">
            <Coins className="w-4 h-4 text-amber-400" />${localActor.money.toLocaleString()}
          </div>
        </div>

        {/* Minecraft-Style Bottom Hotbar (Slots 1-8 + Armory Slot) */}
        <div className="flex items-center gap-1 p-1 rounded-md bg-[#090d16]/94 border-2 border-slate-700/90 shadow-2xl">
          {WEAPON_ORDER.map((wid, idx) => {
            const spec = WEAPONS[wid];
            const owned = Boolean(localActor.ownedWeapons[wid]);
            const active = localActor.activeWeapon === wid;
            return (
              <button
                key={wid}
                type="button"
                disabled={!owned}
                onClick={() => owned && onSwitchWeapon(wid)}
                title={`${idx + 1}. ${spec.name} (${owned ? '已擁有' : `$${spec.cost}`})`}
                className={`relative w-11 h-11 sm:w-13 sm:h-13 rounded-[3px] border-2 flex flex-col items-center justify-center transition-colors ${
                  active
                    ? 'bg-cyan-950/70 border-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.3)]'
                    : owned
                      ? 'bg-[#0f172a] border-slate-600/85 hover:border-slate-400'
                      : 'bg-[#070b12] border-slate-800/80 opacity-60 cursor-not-allowed'
                }`}
              >
                <span className="absolute top-0.5 left-1 font-mono-num text-[9px] font-bold text-slate-400 leading-none">
                  {idx + 1}
                </span>
                <WeaponSilhouette id={wid} active={active} owned={owned} />
                <span className="font-mono-num text-[9px] leading-none mt-0.5 truncate max-w-[92%]">
                  {owned ? (
                    <span className={active ? 'text-cyan-200 font-bold' : 'text-slate-300'}>
                      {spec.name.slice(0, 2)}
                    </span>
                  ) : (
                    <span className="text-amber-400/90">${spec.cost}</span>
                  )}
                </span>
              </button>
            );
          })}

          {/* Tactical Equipment Slot (G to throw, Q or click to cycle) */}
          <button
            type="button"
            onClick={cycleNextGadget}
            title={`${activeGadgetSpec.name} · [G] 投擲 / [Q] 切換 (總庫存 ${totalGadgets})`}
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
              {activeGadgetId === 'frag' ? (
                <Flame className="w-4 h-4" />
              ) : activeGadgetId === 'smoke' ? (
                <Cloud className="w-4 h-4" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
            </div>
            <span className="font-mono-num text-[9px] leading-none mt-0.5 truncate max-w-[92%]">
              {activeGadgetSpec.name.slice(0, 3)}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenShop}
            title="軍械庫商店 [B]"
            className="w-11 h-11 sm:w-13 sm:h-13 rounded-[3px] border-2 border-amber-500/60 bg-amber-950/40 hover:bg-amber-900/50 flex flex-col items-center justify-center gap-0.5 text-amber-300 transition-colors"
          >
            <ShoppingBag className="w-4 h-4" />
            <span className="font-mono-num text-[9px] font-bold leading-none">[B] 商店</span>
          </button>
        </div>
      </div>
    </div>
  );
}
