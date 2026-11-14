import { useRef, useState } from 'react';
import { Crosshair, Flame, MapPin, Pickaxe, RotateCw, ArrowUp, Shield } from 'lucide-react';
import type { ArenaEngine } from '../three/ArenaEngine.ts';

interface TouchControlsProps {
  engine: ArenaEngine | null;
  isMelee: boolean;
  isUnderground: boolean;
  crouching: boolean;
  aiming: boolean;
  gadgetCount: number;
}

export function TouchControls({
  engine,
  isMelee,
  isUnderground,
  crouching,
  aiming,
  gadgetCount,
}: TouchControlsProps) {
  const joyTouchIdRef = useRef<number | null>(null);
  const joyOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lookTouchIdRef = useRef<number | null>(null);
  const lookPrevRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [joyActive, setJoyActive] = useState(false);

  const maxRadius = 42;

  const handleJoyStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (joyTouchIdRef.current !== null) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const rect = e.currentTarget.getBoundingClientRect();
    joyTouchIdRef.current = t.identifier;
    joyOriginRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    setJoyActive(true);
    updateJoyFromTouch(t.clientX, t.clientY);
  };

  const updateJoyFromTouch = (cx: number, cy: number) => {
    const dx = cx - joyOriginRef.current.x;
    const dy = cy - joyOriginRef.current.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(maxRadius, dist);
    const nx = dist > 1 ? (dx / dist) * (clamped / maxRadius) : 0;
    const ny = dist > 1 ? (dy / dist) * (clamped / maxRadius) : 0;
    setKnobOffset({ x: nx * maxRadius, y: ny * maxRadius });
    const sprint = dist > maxRadius * 0.82 && -ny > 0.45;
    engine?.setTouchMove(nx, -ny, sprint);
  };

  const handleJoyMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (joyTouchIdRef.current === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === joyTouchIdRef.current) {
        updateJoyFromTouch(t.clientX, t.clientY);
        break;
      }
    }
  };

  const handleJoyEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (joyTouchIdRef.current === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joyTouchIdRef.current) {
        joyTouchIdRef.current = null;
        setJoyActive(false);
        setKnobOffset({ x: 0, y: 0 });
        engine?.setTouchMove(0, 0, false);
        break;
      }
    }
  };

  const handleLookStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (lookTouchIdRef.current !== null) return;
    const t = e.changedTouches[0];
    if (!t) return;
    lookTouchIdRef.current = t.identifier;
    lookPrevRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleLookMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (lookTouchIdRef.current === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === lookTouchIdRef.current) {
        const dx = t.clientX - lookPrevRef.current.x;
        const dy = t.clientY - lookPrevRef.current.y;
        lookPrevRef.current = { x: t.clientX, y: t.clientY };
        engine?.addTouchLook(dx, dy);
        break;
      }
    }
  };

  const handleLookEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (lookTouchIdRef.current === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === lookTouchIdRef.current) {
        lookTouchIdRef.current = null;
        break;
      }
    }
  };

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none touch-none">
      {/* Right-half invisible swipe-to-aim area */}
      <div
        onTouchStart={handleLookStart}
        onTouchMove={handleLookMove}
        onTouchEnd={handleLookEnd}
        onTouchCancel={handleLookEnd}
        className="fixed inset-y-16 right-0 left-[38%] pointer-events-auto touch-none"
      />

      {/* Left Virtual Movement Joystick */}
      <div
        onTouchStart={handleJoyStart}
        onTouchMove={handleJoyMove}
        onTouchEnd={handleJoyEnd}
        onTouchCancel={handleJoyEnd}
        className={`fixed bottom-24 left-5 w-28 h-28 rounded-full border-2 flex items-center justify-center pointer-events-auto touch-none ${
          joyActive ? 'bg-slate-900/55 border-cyan-400/80' : 'bg-slate-950/45 border-slate-600/60'
        }`}
      >
        <div
          className="w-11 h-11 rounded-full bg-cyan-400/80 border-2 border-white/80 shadow-lg"
          style={{
            transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)`,
          }}
        />
      </div>

      {/* Right Action Buttons */}
      <div className="fixed bottom-24 right-4 flex items-end gap-2.5 pointer-events-auto touch-none">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onTouchStart={(e) => {
              e.stopPropagation();
              engine?.triggerTouchPing();
            }}
            className="w-10 h-10 rounded-full bg-slate-900/80 border border-cyan-400/50 text-cyan-200 flex items-center justify-center active:scale-95"
            title="標記"
          >
            <MapPin className="w-4 h-4" />
          </button>

          {isUnderground && (
            <button
              type="button"
              onTouchStart={(e) => {
                e.stopPropagation();
                engine?.triggerTouchDig();
              }}
              className="w-10 h-10 rounded-full bg-amber-950/80 border border-amber-400/60 text-amber-200 flex items-center justify-center active:scale-95"
              title="挖掘"
            >
              <Pickaxe className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onTouchStart={(e) => {
              e.stopPropagation();
              engine?.triggerTouchGadget();
            }}
            disabled={gadgetCount <= 0}
            className="relative w-11 h-11 rounded-full bg-slate-900/80 border border-amber-400/60 text-amber-300 flex items-center justify-center disabled:opacity-35 active:scale-95"
          >
            <Flame className="w-4 h-4" />
            <span className="absolute -top-1 -right-1 text-[9px] font-mono-num px-1 rounded-full bg-amber-500 text-slate-950 font-bold">
              {gadgetCount}
            </span>
          </button>

          <button
            type="button"
            onTouchStart={(e) => {
              e.stopPropagation();
              engine?.triggerTouchCrouch();
            }}
            className={`w-11 h-11 rounded-full border flex items-center justify-center active:scale-95 ${
              crouching
                ? 'bg-cyan-500/35 border-cyan-300 text-cyan-200'
                : 'bg-slate-900/80 border-slate-600 text-slate-200'
            }`}
          >
            <Shield className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-2">
          {!isMelee && (
            <div className="flex gap-2">
              <button
                type="button"
                onTouchStart={(e) => {
                  e.stopPropagation();
                  engine?.triggerTouchReload();
                }}
                className="w-11 h-11 rounded-full bg-slate-900/80 border border-slate-500 text-slate-100 flex items-center justify-center active:scale-95"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onTouchStart={(e) => {
                  e.stopPropagation();
                  engine?.setTouchAim(!aiming);
                }}
                className={`w-11 h-11 rounded-full border flex items-center justify-center active:scale-95 ${
                  aiming
                    ? 'bg-cyan-500/40 border-cyan-300 text-white'
                    : 'bg-slate-900/80 border-slate-500 text-slate-200'
                }`}
              >
                <Crosshair className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <button
              type="button"
              onTouchStart={(e) => {
                e.stopPropagation();
                engine?.triggerTouchJump();
              }}
              className="w-12 h-12 rounded-full bg-slate-900/85 border border-slate-500 text-white flex items-center justify-center active:scale-95"
            >
              <ArrowUp className="w-5 h-5" />
            </button>

            <button
              type="button"
              onTouchStart={(e) => {
                e.stopPropagation();
                engine?.setTouchFire(true);
              }}
              onTouchEnd={(e) => {
                e.stopPropagation();
                engine?.setTouchFire(false);
              }}
              onTouchCancel={(e) => {
                e.stopPropagation();
                engine?.setTouchFire(false);
              }}
              className="w-16 h-16 rounded-full bg-rose-600/85 active:bg-rose-500 border-2 border-rose-200 text-white font-bold text-xs flex items-center justify-center shadow-lg"
            >
              {isMelee ? '揮砍' : '射擊'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
