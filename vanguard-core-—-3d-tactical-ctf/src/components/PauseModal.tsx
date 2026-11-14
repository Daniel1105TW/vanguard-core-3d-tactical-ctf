import { Play, LogOut, ShoppingBag, Volume2, VolumeX, Sliders, Keyboard } from 'lucide-react';

export interface GameSettings {
  sensitivity: number;
  fov: number;
  volume: number;
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
                <span>切換槍枝</span>
                <span className="font-mono-num text-slate-200">1–8 / 滾輪</span>
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
