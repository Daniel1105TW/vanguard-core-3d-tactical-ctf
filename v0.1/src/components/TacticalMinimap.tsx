import { useEffect, useRef } from 'react';
import {
  ARENA_BOUNDS,
  CONTROL_ZONE_SPEC,
  FLAG_BASES,
  GAME_MODES,
  MAP_MODES,
  UNDERGROUND_GRID,
} from '../shared/gameConfig.ts';
import type {
  ActorSnapshot,
  MapLayout,
  StateSyncPayload,
  TeamId,
} from '../shared/gameConfig.ts';

interface TacticalMinimapProps {
  state: StateSyncPayload;
  localActor: ActorSnapshot;
  mapLayout: MapLayout;
  digHp?: Uint8Array;
  digVersion?: number;
}

const W = 216;
const H = 124;

function toCanvasX(wx: number): number {
  const span = ARENA_BOUNDS.maxX - ARENA_BOUNDS.minX;
  return ((wx - ARENA_BOUNDS.minX) / span) * W;
}

function toCanvasY(wz: number): number {
  const span = ARENA_BOUNDS.maxZ - ARENA_BOUNDS.minZ;
  return ((wz - ARENA_BOUNDS.minZ) / span) * H;
}

export function TacticalMinimap({
  state,
  localActor,
  mapLayout,
  digHp,
  digVersion = 0,
}: TacticalMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapInfo = MAP_MODES.find((m) => m.id === state.mapMode);
  const modeInfo = GAME_MODES.find((m) => m.id === state.gameMode) ?? GAME_MODES[0];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Arena deck background
    ctx.fillStyle = mapLayout.mode === 'underground' ? '#131d2c' : '#0b1220';
    ctx.fillRect(0, 0, W, H);

    // Subtle tactical grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 27) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += 31) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Team base territory floor tint
    ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
    ctx.fillRect(toCanvasX(-50), toCanvasY(-13), toCanvasX(-37) - toCanvasX(-50), toCanvasY(13) - toCanvasY(-13));

    ctx.fillStyle = 'rgba(6, 182, 212, 0.14)';
    ctx.fillRect(toCanvasX(37), toCanvasY(-13), toCanvasX(50) - toCanvasX(37), toCanvasY(13) - toCanvasY(-13));

    // Center divider line
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.28)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(W / 2, 2);
    ctx.lineTo(W / 2, H - 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Underground soil grid vs carved tunnels
    if (mapLayout.mode === 'underground' && digHp && digHp.length > 0) {
      const { cols, rows, cellSize, originX, originZ } = UNDERGROUND_GRID;
      const cw = (cellSize / (ARENA_BOUNDS.maxX - ARENA_BOUNDS.minX)) * W;
      const ch = (cellSize / (ARENA_BOUNDS.maxZ - ARENA_BOUNDS.minZ)) * H;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const hp = digHp[r * cols + c];
          if (hp > 0) {
            const x = toCanvasX(originX + c * cellSize);
            const y = toCanvasY(originZ + r * cellSize);
            ctx.fillStyle = hp === 1 ? '#573c28' : '#3d2a1c';
            ctx.fillRect(x, y, cw + 0.4, ch + 0.4);
          }
        }
      }
    }

    // 3. Static arena obstacles (colliders & ramps)
    for (const r of mapLayout.ramps) {
      const x = toCanvasX(r.minX);
      const y = toCanvasY(r.minZ);
      const w = toCanvasX(r.maxX) - x;
      const h = toCanvasY(r.maxZ) - y;
      ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
      ctx.fillRect(x, y, w, h);
    }

    for (const box of mapLayout.colliders) {
      if (box.kind === 'wall') continue;
      if (box.maxY <= 0.4) continue; // Low platform floor already drawn
      const x = toCanvasX(box.minX);
      const y = toCanvasY(box.minZ);
      const w = Math.max(2, toCanvasX(box.maxX) - x);
      const h = Math.max(2, toCanvasY(box.maxZ) - y);

      if (box.kind === 'bridge') {
        ctx.fillStyle = 'rgba(100, 116, 139, 0.42)';
      } else if (box.team === 'red') {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.45)';
      } else if (box.team === 'blue') {
        ctx.fillStyle = 'rgba(6, 182, 212, 0.45)';
      } else {
        ctx.fillStyle = box.kind === 'pillar' ? 'rgba(148, 163, 184, 0.65)' : 'rgba(71, 85, 105, 0.72)';
      }
      ctx.fillRect(x, y, w, h);
    }

    // 4. Mode Objective Overlay (CTF Pedestal Rings or DOM Control Zone)
    if (state.gameMode === 'ctf') {
      (['red', 'blue'] as TeamId[]).forEach((team) => {
        const base = FLAG_BASES[team];
        const bx = toCanvasX(base.x);
        const by = toCanvasY(base.z);
        ctx.strokeStyle = team === 'red' ? 'rgba(248, 113, 113, 0.65)' : 'rgba(34, 211, 238, 0.65)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(bx, by, 5, 0, Math.PI * 2);
        ctx.stroke();
      });
    } else if (state.gameMode === 'dom') {
      const cz = state.controlZone;
      const zx = toCanvasX(cz?.x ?? CONTROL_ZONE_SPEC.x);
      const zy = toCanvasY(cz?.z ?? CONTROL_ZONE_SPEC.z);
      const rxScale = W / (ARENA_BOUNDS.maxX - ARENA_BOUNDS.minX);
      const zr = (cz?.radius ?? CONTROL_ZONE_SPEC.radius) * rxScale;

      const owner = cz?.owner ?? 'neutral';
      const contested = Boolean(cz?.contested);
      ctx.fillStyle = contested
        ? 'rgba(245, 158, 11, 0.24)'
        : owner === 'red'
          ? 'rgba(239, 68, 68, 0.22)'
          : owner === 'blue'
            ? 'rgba(6, 182, 212, 0.22)'
            : 'rgba(148, 163, 184, 0.14)';
      ctx.beginPath();
      ctx.arc(zx, zy, zr, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = contested
        ? '#f59e0b'
        : owner === 'red'
          ? '#f87171'
          : owner === 'blue'
            ? '#22d3ee'
            : '#94a3b8';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(zx, zy, zr, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(zx, zy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4.5 Active Smoke Zones
    if (state.smokeZones && state.smokeZones.length > 0) {
      const rxScale = W / (ARENA_BOUNDS.maxX - ARENA_BOUNDS.minX);
      for (const z of state.smokeZones) {
        const sx = toCanvasX(z.x);
        const sy = toCanvasY(z.z);
        const sr = z.radius * rxScale;
        ctx.fillStyle = 'rgba(203, 213, 225, 0.34)';
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.65)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 5. Teammates
    for (const actor of state.actors) {
      if (actor.team !== localActor.team || actor.id === localActor.id || !actor.alive) continue;
      const ax = toCanvasX(actor.x);
      const ay = toCanvasY(actor.z);
      const teamColor = actor.team === 'red' ? '#f87171' : '#38bdf8';

      // Facing tick
      const fdx = -Math.sin(actor.yaw);
      const fdy = -Math.cos(actor.yaw);
      ctx.strokeStyle = teamColor;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + fdx * 6.5, ay + fdy * 6.5);
      ctx.stroke();

      // Teammate dot
      ctx.fillStyle = teamColor;
      ctx.beginPath();
      ctx.arc(ax, ay, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 6. Red & Blue Flags (CTF mode only)
    if (state.gameMode === 'ctf') {
      (['red', 'blue'] as TeamId[]).forEach((team) => {
        const flag = state.flags[team];
        const fx = toCanvasX(flag.x);
        const fy = toCanvasY(flag.z);
        const fill = team === 'red' ? '#ef4444' : '#06b6d4';

        if (flag.status !== 'base') {
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(fx, fy, 7.2, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = fill;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.1;
        ctx.fillRect(-3.6, -3.6, 7.2, 7.2);
        ctx.strokeRect(-3.6, -3.6, 7.2, 7.2);
        ctx.restore();
      });
    }

    // 6.5 Active Tactical Pings (teammates only)
    if (state.pings && state.pings.length > 0) {
      for (const ping of state.pings) {
        const px = toCanvasX(ping.x);
        const py = toCanvasY(ping.z);
        const color =
          ping.kind === 'carrier' ? '#f59e0b' : ping.kind === 'enemy' ? '#f43f5e' : '#22d3ee';

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(px, py, 6.2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = color;
        ctx.fillRect(-2.4, -2.4, 4.8, 4.8);
        ctx.restore();
      }
    }

    // 7. Local Player Vision Cone & Directional Arrow
    const px = toCanvasX(localActor.x);
    const py = toCanvasY(localActor.z);
    const lookX = -Math.sin(localActor.yaw);
    const lookY = -Math.cos(localActor.yaw);
    const angle = Math.atan2(lookY, lookX);

    if (localActor.alive) {
      // Soft FOV cone
      const grad = ctx.createRadialGradient(px, py, 1, px, py, 24);
      grad.addColorStop(0, 'rgba(253, 224, 71, 0.36)');
      grad.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, 24, angle - 0.52, angle + 0.52);
      ctx.closePath();
      ctx.fill();

      // Player directional arrow
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.fillStyle = '#fde047';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(6.5, 0);
      ctx.lineTo(-4.5, -4.2);
      ctx.lineTo(-2.4, 0);
      ctx.lineTo(-4.5, 4.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }, [state, localActor, mapLayout, digHp, digVersion]);

  return (
    <div className="fixed top-3 right-3 w-[234px] rounded-lg bg-[#090d16]/92 border border-slate-700/85 p-2 shadow-xl pointer-events-none">
      <div className="flex items-center justify-between text-[10px] font-semibold mb-1.5 px-0.5">
        <span className="text-cyan-300 tracking-wide">戰術雷達 · {modeInfo.shortLabel}</span>
        <span className="text-slate-300 truncate max-w-[125px]">
          {mapInfo?.name ?? state.mapMode}
        </span>
      </div>

      <div className="rounded overflow-hidden border border-slate-700/80 bg-[#080c14]">
        <canvas
          ref={canvasRef}
          style={{ width: `${W}px`, height: `${H}px` }}
          className="block"
        />
      </div>

      <div className="flex items-center justify-between text-[9px] text-slate-400 mt-1.5 px-0.5">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 bg-yellow-300 rotate-45" />
          本人
        </span>
        <span className="flex items-center gap-1">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              localActor.team === 'red' ? 'bg-red-400' : 'bg-sky-400'
            }`}
          />
          隊友
        </span>
        {state.gameMode === 'ctf' ? (
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 bg-red-500 border border-white/70 rotate-45" />
            <span className="inline-block w-2 h-2 bg-cyan-400 border border-white/70 rotate-45" />
            旗幟
          </span>
        ) : state.gameMode === 'dom' ? (
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full border border-amber-400 bg-amber-400/20" />
            核心據點
          </span>
        ) : (
          <span className="text-amber-300 font-semibold">團隊死鬥</span>
        )}
      </div>
    </div>
  );
}
