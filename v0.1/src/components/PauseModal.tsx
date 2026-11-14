import { useState } from 'react';
import { Play, LogOut, ShoppingBag, Volume2, VolumeX, Sliders, Keyboard, Crosshair } from 'lucide-react';
import type { CrosshairColor, CrosshairSettings, CrosshairStyle } from '../shared/gameConfig.ts';

export interface GameSettings {
  sensitivity: number;
  fov: number;
  volume: number;
  crosshair: CrosshairSettings;
}

const CROSSHAIR_STYLE_OPTIONS: Array<{ id: CrosshairStyle; label: string }> = [
  { id: 'cross', label: '動態十字' },
  { id: 'tactical', label: '戰術複合' },
  { id: 'circle', label: '動態圓環' },
  { id: 'dot', label: '極簡準點' },
];

const CROSSHAIR_COLOR_OPTIONS: Array<{ id: CrosshairColor; label: string; swatchClass: string }> = [
  { id: 'white', label: '白', swatchClass: 'bg-white' },
  { id: 'cyan', label: '青', swatchClass: 'bg-cyan-400' },
  { id: 'emerald', label: '綠', swatchClass: 'bg-emerald-400' },
  { id: 'amber', label: '金', swatchClass: 'bg-amber-400' },
];

function previewColorClass(color: CrosshairColor, enemyPreview: boolean): string {
  if (enemyPreview) return 'text-rose-500';
  if (color === 'cyan') return 'text-cyan-300';
  if (color === 'emerald') return 'text-emerald-400';
  if (color === 'amber') return 'text-amber-300';
  return 'text-white';
}

interface PauseModalProps {
  isSolo: boolean;
  serverPaused: boolean;
  settings: GameSettings;
  muted: boolean;
  onUpdateSettings: (next: GameSettings) => void;
  onToggleMute: () => void;
  onResume: () => void;
  onOpenArmory: () => void;
  onExitGame: () => void;
}

export function PauseModal({
  isSolo,
  serverPaused,
  settings,
  muted,
  onUpdateSettings,
  onToggleMute,
  onResume,
  onOpenArmory,
  onExitGame,
}: PauseModalProps) {
  const [previewEnemyHover, setPreviewEnemyHover] = useState(false);
  const ch = settings.crosshair;
  const updateCrosshair = (patch: Partial<CrosshairSettings>) => {
    onUpdateSettings({ ...settings, crosshair: { ...ch, ...patch } });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-[#090d16]/82 pointer-events-auto">
      <div className="w-full max-w-xl bg-[#0d1422] border border-slate-700 rounded-xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 bg-[#090d16] border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-white">
              {serverPaused ? '遊戲已暫停' : '戰術選單與設定'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {isSolo
                ? serverPaused
                  ? '單人模式：戰場時間與 AI 機器人已凍結'
                  : '單人模式：按 ESC 可隨時暫停戰場'
                : '多人連線模式：開啟選單時對戰仍會即時進行'}
            </p>
          </div>
          <span
            className={`px-2.5 py-1 rounded text-[11px] font-semibold border ${
              serverPaused
                ? 'bg-amber-500/15 border-amber-400/50 text-amber-300'
                : 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300'
            }`}
          >
            {serverPaused ? '已凍結' : '連線戰場'}
          </span>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Primary Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onResume}
              className="py-3 px-4 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <Play className="w-4 h-4 fill-current" />
              繼續戰鬥 [ESC]
            </button>
            <button
              type="button"
              onClick={onOpenArmory}
              className="py-3 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 border border-amber-500/40 text-amber-300 font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <ShoppingBag className="w-4 h-4" />
              軍械庫商店 [B]
            </button>
          </div>

          {/* Settings Panel */}
          <div className="rounded-xl bg-[#090d16] border border-slate-800 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Sliders className="w-4 h-4 text-cyan-400" />
                控制與畫面設定
              </div>
              <button
                type="button"
                onClick={onToggleMute}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5"
              >
                {muted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 text-cyan-400" />}
                {muted ? '已靜音' : '音效開啟'}
              </button>
            </div>

            {/* Mouse Sensitivity */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">滑鼠靈敏度 (開鏡會依倍率自動微調)</span>
                <span className="font-mono-num font-bold text-cyan-300">{settings.sensitivity.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min={0.4}
                max={2.4}
                step={0.1}
                value={settings.sensitivity}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, sensitivity: Number(e.target.value) })
                }
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            {/* Base FOV */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">視野角度 (FOV)</span>
                <span className="font-mono-num font-bold text-cyan-300">{settings.fov}°</span>
              </div>
              <input
                type="range"
                min={65}
                max={95}
                step={1}
                value={settings.fov}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, fov: Number(e.target.value) })
                }
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            {/* Volume */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">主音量</span>
                <span className="font-mono-num font-bold text-cyan-300">
                  {muted ? '靜音' : `${Math.round(settings.volume * 100)}%`}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.volume}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, volume: Number(e.target.value) })
                }
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>
          </div>

          {/* Crosshair Customization Panel */}
          <div className="rounded-xl bg-[#090d16] border border-slate-800 p-4 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Crosshair className="w-4 h-4 text-cyan-400" />
                動態準星樣式設定
              </div>
              <button
                type="button"
                onClick={() => setPreviewEnemyHover((v) => !v)}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${
                  previewEnemyHover
                    ? 'bg-rose-950/80 border-rose-400/70 text-rose-200'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                {previewEnemyHover ? '預覽：瞄準敵人(變紅)' : '點擊預覽瞄準敵人'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_112px] gap-3 items-center">
              <div className="space-y-3">
                {/* Style Selector */}
                <div className="grid grid-cols-4 gap-1.5">
                  {CROSSHAIR_STYLE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => updateCrosshair({ style: opt.id })}
                      className={`py-1.5 px-1 rounded text-[11px] font-semibold border transition-colors ${
                        ch.style === opt.id
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                          : 'bg-slate-900 border-slate-700/80 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Color & Dot Toggle */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 mr-1">顏色</span>
                    {CROSSHAIR_COLOR_OPTIONS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => updateCrosshair({ color: c.id })}
                        title={c.label}
                        className={`w-6 h-6 rounded border flex items-center justify-center transition-all ${
                          ch.color === c.id
                            ? 'border-cyan-300 scale-105 bg-slate-800'
                            : 'border-slate-700 bg-slate-900 hover:border-slate-500'
                        }`}
                      >
                        <span className={`w-3 h-3 rounded-full ${c.swatchClass}`} />
                      </button>
                    ))}
                  </div>

                  {ch.style !== 'dot' && (
                    <button
                      type="button"
                      onClick={() => updateCrosshair({ showDot: !ch.showDot })}
                      className={`px-2 py-1 rounded text-[11px] font-semibold border transition-colors ${
                        ch.showDot
                          ? 'bg-cyan-500/15 border-cyan-400/60 text-cyan-200'
                          : 'bg-slate-900 border-slate-700 text-slate-400'
                      }`}
                    >
                      中心點：{ch.showDot ? '開' : '關'}
                    </button>
                  )}
                </div>

                {/* Crosshair Size */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">準星縮放大小</span>
                    <span className="font-mono-num font-bold text-cyan-300">{ch.size.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.7}
                    max={1.6}
                    step={0.1}
                    value={ch.size}
                    onChange={(e) => updateCrosshair({ size: Number(e.target.value) })}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>
              </div>

              {/* Live Crosshair Preview Box */}
              <div
                className={`h-24 rounded-lg bg-[#05080f] border border-slate-700/90 flex items-center justify-center relative overflow-hidden ${previewColorClass(
                  ch.color,
                  previewEnemyHover,
                )}`}
              >
                <div
                  className="relative flex items-center justify-center"
                  style={{ transform: `scale(${ch.size})` }}
                >
                  {(ch.style === 'dot' || ch.showDot) && (
                    <span
                      className={`rounded-full bg-current ${
                        ch.style === 'dot' ? 'w-2 h-2' : 'w-1 h-1'
                      }`}
                    />
                  )}
                  {(ch.style === 'circle' || ch.style === 'tactical') && (
                    <span
                      className={`rounded-full border border-current/80 absolute ${
                        ch.style === 'circle' ? 'w-6 h-6' : 'w-7 h-7 border-opacity-50'
                      }`}
                    />
                  )}
                  {(ch.style === 'cross' || ch.style === 'tactical') && (
                    <>
                      <span className="w-[2px] h-2 bg-current absolute -top-3.5 left-1/2 -translate-x-1/2" />
                      <span className="w-[2px] h-2 bg-current absolute -bottom-3.5 left-1/2 -translate-x-1/2" />
                      <span className="h-[2px] w-2 bg-current absolute -left-3.5 top-1/2 -translate-y-1/2" />
                      <span className="h-[2px] w-2 bg-current absolute -right-3.5 top-1/2 -translate-y-1/2" />
                    </>
                  )}
                </div>
                <span className="absolute bottom-1 right-1.5 text-[9px] text-slate-500">
                  移動/跳躍擴散
                </span>
              </div>
            </div>
          </div>

          {/* Keybinds Reference */}
          <div className="rounded-xl bg-[#090d16] border border-slate-800 p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <Keyboard className="w-3.5 h-3.5 text-slate-400" />
              操作按鍵一覽
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-[11px]">
              <div className="flex justify-between text-slate-400">
                <span>移動 / 衝刺</span>
                <span className="font-mono-num text-slate-200">WASD / Shift</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>連續跳躍</span>
                <span className="font-mono-num text-slate-200">Space</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>切換蹲下</span>
                <span className="font-mono-num text-slate-200">C</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>射擊 / 換彈</span>
                <span className="font-mono-num text-slate-200">左鍵 / R</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>瞄準鏡</span>
                <span className="font-mono-num text-slate-200">按住右鍵</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>切換武器</span>
                <span className="font-mono-num text-slate-200">1–0 / 滾輪</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>戰術標記</span>
                <span className="font-mono-num text-slate-200">F / 中鍵</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>投擲 / 切換道具</span>
                <span className="font-mono-num text-slate-200">G / Q</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>開發者模式</span>
                <span className="font-mono-num text-amber-300">F8</span>
              </div>
            </div>
          </div>

          {/* Exit Game */}
          <button
            type="button"
            onClick={onExitGame}
            className="w-full py-2.5 px-4 rounded-lg bg-rose-950/60 hover:bg-rose-900/75 border border-rose-500/45 text-rose-200 font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            退出遊戲返回主畫面
          </button>
        </div>
      </div>
    </div>
  );
}
