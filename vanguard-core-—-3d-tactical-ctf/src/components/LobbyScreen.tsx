import { useEffect, useState } from 'react';
import { Copy, Check, Plus, Users, Play, Shield, Crosshair, Coins, Volume2, VolumeX, Map as MapIcon } from 'lucide-react';
import { ECONOMY, MAP_MODES } from '../shared/gameConfig.ts';
import type { MapMode, RoomLobbyInfo, RoomSettings, TeamId } from '../shared/gameConfig.ts';

interface LobbyScreenProps {
  connected: boolean;
  playerId: string | null;
  lobby: RoomLobbyInfo | null;
  errorMsg: string | null;
  commanderVault: number;
  muted: boolean;
  onToggleMute: () => void;
  onQuickPlay: (name: string, useStipend: boolean, mapMode: MapMode) => void;
  onCreateRoom: (name: string, team: TeamId, settings: RoomSettings, useStipend: boolean) => void;
  onJoinRoom: (roomId: string, name: string, useStipend: boolean) => void;
  onSwitchTeam: (team: TeamId) => void;
  onUpdateSettings: (settings: Partial<RoomSettings>) => void;
  onStartMatch: () => void;
  onLeaveRoom: () => void;
}

export function LobbyScreen({
  connected,
  playerId,
  lobby,
  errorMsg,
  commanderVault,
  muted,
  onToggleMute,
  onQuickPlay,
  onCreateRoom,
  onJoinRoom,
  onSwitchTeam,
  onUpdateSettings,
  onStartMatch,
  onLeaveRoom,
}: LobbyScreenProps) {
  const [name, setName] = useState(() => localStorage.getItem('vc_callsign') || '特戰隊員');
  const [joinCode, setJoinCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') || '').toUpperCase();
  });
  const [preferredTeam, setPreferredTeam] = useState<TeamId>('blue');
  const [teamSize, setTeamSize] = useState<3 | 4>(3);
  const [durationSec, setDurationSec] = useState<number>(300);
  const [scoreLimit, setScoreLimit] = useState<number>(5);
  const [mapMode, setMapMode] = useState<MapMode>('nexus');
  const [useStipend, setUseStipend] = useState(false);
  const [copied, setCopied] = useState(false);
  const [publicRooms, setPublicRooms] = useState<RoomLobbyInfo[]>([]);

  useEffect(() => {
    localStorage.setItem('vc_callsign', name);
  }, [name]);

  useEffect(() => {
    if (lobby) return;
    let active = true;
    const fetchRooms = async () => {
      try {
        const res = await fetch('/api/rooms');
        if (!res.ok) return;
        const data = (await res.json()) as { rooms: RoomLobbyInfo[] };
        if (active) setPublicRooms(data.rooms);
      } catch {
        // ignore transient network errors
      }
    };
    fetchRooms();
    const timer = setInterval(fetchRooms, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [lobby]);

  const canAffordStipend = commanderVault >= ECONOMY.STIPEND_COST;

  const copyInviteLink = () => {
    if (!lobby) return;
    const url = `${window.location.origin}?room=${lobby.roomId}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-6 md:p-10 pointer-events-auto bg-gradient-to-b from-[#090d16]/80 via-[#090d16]/55 to-[#090d16]/90 overflow-y-auto">
      {/* Top Bar */}
      <header className="flex items-center justify-between gap-6 max-w-6xl w-full mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center text-cyan-300">
            <Crosshair className="w-5 h-5" />
          </div>
          <span className="font-display text-xl md:text-2xl font-bold tracking-wider text-white whitespace-nowrap">
            VANGUARD CORE
          </span>
        </div>

        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2 text-sm text-amber-300 font-mono-num">
            <Coins className="w-4 h-4 text-amber-400" />
            <span className="text-slate-400 font-sans text-xs">戰術金庫</span>
            <span className="font-bold">${commanderVault.toLocaleString()}</span>
          </div>
          <button
            type="button"
            onClick={onToggleMute}
            className="p-2 rounded bg-slate-900/90 border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
            title={muted ? '開啟音效' : '靜音'}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl w-full mx-auto my-auto py-6">
        {errorMsg && (
          <div className="mb-4 px-4 py-3 rounded bg-red-950/90 border border-red-500/50 text-red-200 text-sm">
            {errorMsg}
          </div>
        )}

        {!lobby ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left Hero & Quick Entry */}
            <div className="lg:col-span-7 bg-[#0d1422]/92 border border-slate-700/80 rounded-xl p-6 md:p-8 flex flex-col justify-between gap-6">
              <div className="space-y-3">
                <p className="text-xs font-medium tracking-widest text-cyan-400 uppercase">
                  3D 第一人稱科幻搶旗對戰
                </p>
                <h1 className="font-display text-3xl md:text-4xl font-bold text-white leading-tight text-balance">
                  潛入敵陣奪取核心旗幟，升級武裝主宰戰場
                </h1>
                <p className="text-sm md:text-base text-slate-300 leading-relaxed max-w-xl">
                  紅藍兩隊即時交鋒，空位由 AI 戰術機器人自動補位。擊殺敵人與搶奪旗幟可賺取金錢，隨時按{' '}
                  <span className="font-mono-num text-amber-300 font-semibold">B</span> 開啟軍械庫解鎖並強化槍枝，結束時奪旗較多隊伍獲勝並贏得{' '}
                  <span className="font-mono-num text-amber-300 font-semibold">+$1,000</span> 勝利額外獎金。
                </p>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">特戰代號</label>
                    <input
                      type="text"
                      value={name}
                      maxLength={16}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="輸入您的代號"
                      className="w-full px-3.5 py-2.5 rounded-lg bg-[#080c14] border border-slate-700 text-white text-sm focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">開局勝利金庫補給</label>
                    <button
                      type="button"
                      disabled={!canAffordStipend}
                      onClick={() => setUseStipend((v) => !v)}
                      className={`w-full px-3.5 py-2.5 rounded-lg border text-sm text-left flex items-center justify-between transition-colors ${
                        !canAffordStipend
                          ? 'bg-[#080c14]/60 border-slate-800 text-slate-500 cursor-not-allowed'
                          : useStipend
                            ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                            : 'bg-[#080c14] border-slate-700 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      <span className="truncate">開局攜帶 +${ECONOMY.STIPEND_MATCH_BONUS}</span>
                      <span className="font-mono-num text-xs shrink-0 ml-2">
                        {canAffordStipend ? (useStipend ? '已啟用' : `花費 $${ECONOMY.STIPEND_COST}`) : '需 $350'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Map Mode Selector */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <MapIcon className="w-3.5 h-3.5 text-cyan-400" />
                      戰場地圖模式
                    </span>
                    <span className="text-cyan-300 font-medium">
                      {MAP_MODES.find((m) => m.id === mapMode)?.description}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                    {MAP_MODES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMapMode(m.id)}
                        className={`px-2 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                          mapMode === m.id
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                            : 'bg-[#080c14] border-slate-700 text-slate-400 hover:text-white hover:border-slate-500'
                        }`}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    disabled={!connected}
                    onClick={() => onQuickPlay(name, useStipend && canAffordStipend, mapMode)}
                    className="flex-1 min-w-[190px] px-6 py-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    立即快速開戰
                  </button>

                  <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                    <input
                      type="text"
                      value={joinCode}
                      maxLength={6}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="輸入 6 碼房號"
                      className="flex-1 px-3.5 py-3 rounded-lg bg-[#080c14] border border-slate-700 text-white font-mono-num text-sm uppercase focus:outline-none focus:border-cyan-400"
                    />
                    <button
                      type="button"
                      disabled={!connected || joinCode.trim().length < 4}
                      onClick={() => onJoinRoom(joinCode, name, useStipend && canAffordStipend)}
                      className="px-4 py-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white text-sm font-semibold whitespace-nowrap transition-colors disabled:opacity-40"
                    >
                      加入房間
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Create Custom Room & Public Rooms */}
            <div className="lg:col-span-5 bg-[#0d1422]/92 border border-slate-700/80 rounded-xl p-6 flex flex-col justify-between gap-5">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-lg font-bold text-white">建立自訂對戰房間</h2>
                  <span className="text-xs text-slate-400">支援多人連線 + AI 補位</span>
                </div>

                <div className="space-y-3">
                  <div>
                    <span className="block text-xs text-slate-400 mb-1.5">選擇初始隊伍</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPreferredTeam('red')}
                        className={`py-2 px-3 rounded-lg border text-sm font-semibold transition-colors ${
                          preferredTeam === 'red'
                            ? 'bg-red-500/25 border-red-400 text-red-200'
                            : 'bg-[#080c14] border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        紅隊 Crimson
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreferredTeam('blue')}
                        className={`py-2 px-3 rounded-lg border text-sm font-semibold transition-colors ${
                          preferredTeam === 'blue'
                            ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                            : 'bg-[#080c14] border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        藍隊 Cobalt
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className="block text-xs text-slate-400 mb-1">編制</span>
                      <select
                        value={teamSize}
                        onChange={(e) => setTeamSize(Number(e.target.value) as 3 | 4)}
                        className="w-full px-2.5 py-2 rounded bg-[#080c14] border border-slate-700 text-sm text-white"
                      >
                        <option value={3}>3 vs 3</option>
                        <option value={4}>4 vs 4</option>
                      </select>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-400 mb-1">對戰時間</span>
                      <select
                        value={durationSec}
                        onChange={(e) => setDurationSec(Number(e.target.value))}
                        className="w-full px-2.5 py-2 rounded bg-[#080c14] border border-slate-700 text-sm text-white"
                      >
                        <option value={180}>3 分鐘</option>
                        <option value={300}>5 分鐘</option>
                        <option value={480}>8 分鐘</option>
                      </select>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-400 mb-1">目標旗數</span>
                      <select
                        value={scoreLimit}
                        onChange={(e) => setScoreLimit(Number(e.target.value))}
                        className="w-full px-2.5 py-2 rounded bg-[#080c14] border border-slate-700 text-sm text-white"
                      >
                        <option value={3}>3 支</option>
                        <option value={5}>5 支</option>
                        <option value={7}>7 支</option>
                      </select>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!connected}
                  onClick={() =>
                    onCreateRoom(
                      name,
                      preferredTeam,
                      { teamSize, durationSec, scoreLimit, mapMode },
                      useStipend && canAffordStipend,
                    )
                  }
                  className="w-full py-2.5 px-4 rounded-lg bg-slate-100 hover:bg-white text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  建立房間並邀請好友
                </button>
              </div>

              {/* Active Rooms List */}
              <div className="border-t border-slate-800 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-400">進行中或等待中房間</span>
                  <span className="text-xs font-mono-num text-slate-500">{publicRooms.length} 間</span>
                </div>
                {publicRooms.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">目前無公開房間，點擊左側快速開戰或右側建立房間。</p>
                ) : (
                  <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                    {publicRooms.map((r) => (
                      <div
                        key={r.roomId}
                        className="flex items-center justify-between px-3 py-2 rounded bg-[#080c14] border border-slate-800 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono-num font-bold text-cyan-300">{r.roomId}</span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-300">
                            {r.settings.teamSize}v{r.settings.teamSize}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-400">
                            {r.players.filter((p) => !p.isBot).length} 位真人
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onJoinRoom(r.roomId, name, useStipend && canAffordStipend)}
                          className="px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-medium"
                        >
                          加入
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Staging Room View */
          <div className="bg-[#0d1422]/94 border border-slate-700/80 rounded-xl p-6 md:p-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="font-display text-2xl font-bold text-white">戰術整備室</h2>
                  <span className="font-mono-num text-lg font-bold text-cyan-300 bg-cyan-950/60 border border-cyan-500/40 px-3 py-0.5 rounded">
                    房號 {lobby.roomId}
                  </span>
                  <button
                    type="button"
                    onClick={copyInviteLink}
                    className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs text-slate-200 flex items-center gap-1.5"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? '已複製邀請連結' : '複製邀請連結'}
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  分享房號給朋友即可連線同場對戰；未滿編的位置將自動由 AI 戰術機器人補位。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {lobby.hostId === playerId ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <select
                      value={lobby.settings.mapMode}
                      onChange={(e) => onUpdateSettings({ mapMode: e.target.value as MapMode })}
                      className="px-2.5 py-2 rounded bg-[#080c14] border border-slate-700 text-cyan-300 font-medium"
                    >
                      {MAP_MODES.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={lobby.settings.teamSize}
                      onChange={(e) => onUpdateSettings({ teamSize: Number(e.target.value) as 3 | 4 })}
                      className="px-2.5 py-2 rounded bg-[#080c14] border border-slate-700 text-white"
                    >
                      <option value={3}>3 vs 3</option>
                      <option value={4}>4 vs 4</option>
                    </select>
                    <select
                      value={lobby.settings.durationSec}
                      onChange={(e) => onUpdateSettings({ durationSec: Number(e.target.value) })}
                      className="px-2.5 py-2 rounded bg-[#080c14] border border-slate-700 text-white"
                    >
                      <option value={180}>3 分鐘</option>
                      <option value={300}>5 分鐘</option>
                      <option value={480}>8 分鐘</option>
                    </select>
                  </div>
                ) : (
                  <span className="px-3 py-1.5 rounded bg-[#080c14] border border-slate-700 text-xs text-cyan-300">
                    地圖：{MAP_MODES.find((m) => m.id === lobby.settings.mapMode)?.name ?? lobby.settings.mapMode}
                  </span>
                )}
                <button
                  type="button"
                  onClick={onLeaveRoom}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium"
                >
                  離開房間
                </button>
                <button
                  type="button"
                  disabled={lobby.hostId !== playerId}
                  onClick={onStartMatch}
                  className="px-6 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm flex items-center gap-2 disabled:opacity-40"
                >
                  <Play className="w-4 h-4 fill-current" />
                  {lobby.hostId === playerId ? '開始對戰' : '等待房主開始'}
                </button>
              </div>
            </div>

            {/* Red vs Blue Team Rosters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {(['red', 'blue'] as TeamId[]).map((team) => {
                const humans = lobby.players.filter((p) => p.team === team && !p.isBot);
                const emptySlots = Math.max(0, lobby.settings.teamSize - humans.length);
                const isRed = team === 'red';
                const myTeam = lobby.players.find((p) => p.id === playerId)?.team;

                return (
                  <div
                    key={team}
                    className={`rounded-xl p-5 border ${
                      isRed
                        ? 'bg-red-950/20 border-red-500/40'
                        : 'bg-cyan-950/20 border-cyan-500/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Shield className={`w-5 h-5 ${isRed ? 'text-red-400' : 'text-cyan-400'}`} />
                        <h3 className="font-display text-lg font-bold text-white">
                          {isRed ? '紅隊 Crimson' : '藍隊 Cobalt'}
                        </h3>
                      </div>
                      {myTeam !== team && (
                        <button
                          type="button"
                          onClick={() => onSwitchTeam(team)}
                          className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium"
                        >
                          加入此隊
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {humans.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-[#080c14]/90 border border-slate-700/80 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-slate-400" />
                            <span className="font-semibold text-white">{p.name}</span>
                            {p.id === playerId && (
                              <span className="text-xs text-amber-300">(您)</span>
                            )}
                          </div>
                          <span className="text-xs text-slate-400">
                            {p.id === lobby.hostId ? '房主' : '玩家'}
                          </span>
                        </div>
                      ))}

                      {Array.from({ length: emptySlots }).map((_, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-[#080c14]/45 border border-dashed border-slate-800 text-xs text-slate-500"
                        >
                          <span>AI 戰術機器人（自動補位）</span>
                          <span>待命</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Bottom Controls Legend */}
      <footer className="max-w-6xl w-full mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400 border-t border-slate-800/80 pt-4">
        <div className="flex flex-wrap items-center gap-4">
          <span>WASD 移動 · Shift 衝刺 · Space 跳躍 · C 蹲下</span>
          <span>·</span>
          <span>左鍵 射擊 · 右鍵 瞄準鏡 · R 換彈 · G 投擲裝備 · Q 切換裝備 · E 挖掘</span>
          <span>·</span>
          <span>1-8 切換武器 · B 軍械庫 · Tab 戰績表 · ESC 暫停</span>
        </div>
        <div className="font-mono-num text-slate-500">
          {connected ? '連線伺服器就緒' : '連線中...'}
        </div>
      </footer>
    </div>
  );
}
