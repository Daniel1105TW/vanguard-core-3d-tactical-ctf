import { Trophy, Coins, RotateCcw, Home } from 'lucide-react';
import type { MatchEndSummary, TeamId } from '../shared/gameConfig.ts';

interface MatchEndModalProps {
  summary: MatchEndSummary;
  localPlayerId: string | null;
  isHost: boolean;
  onRematch: () => void;
  onBackToLobby: () => void;
}

export function MatchEndModal({
  summary,
  localPlayerId,
  isHost,
  onRematch,
  onBackToLobby,
}: MatchEndModalProps) {
  const localActor = summary.actors.find((a) => a.id === localPlayerId);
  const localWon = localActor && summary.winnerTeam !== 'draw' && localActor.team === summary.winnerTeam;

  const sortedActors = [...summary.actors].sort(
    (a, b) => b.captures * 150 + b.kills * 20 - (a.captures * 150 + a.kills * 20),
  );

  const winnerTitle =
    summary.winnerTeam === 'red'
      ? '紅隊獲得勝利！'
      : summary.winnerTeam === 'blue'
        ? '藍隊獲得勝利！'
        : '雙方平手！';

  const renderTeamBadge = (team: TeamId) => (
    <span className={team === 'red' ? 'text-red-400 font-semibold' : 'text-cyan-400 font-semibold'}>
      {team === 'red' ? '紅隊' : '藍隊'}
    </span>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-[#090d16]/88 pointer-events-auto overflow-y-auto">
      <div className="w-full max-w-4xl bg-[#0d1422] border border-slate-700 rounded-xl p-6 md:p-8 space-y-6">
        {/* Outcome Banner */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <Trophy
                className={`w-7 h-7 ${
                  summary.winnerTeam === 'red'
                    ? 'text-red-400'
                    : summary.winnerTeam === 'blue'
                      ? 'text-cyan-400'
                      : 'text-amber-400'
                }`}
              />
              <h2 className="font-display text-3xl font-bold text-white">{winnerTitle}</h2>
            </div>
            <p className="text-sm text-slate-300">
              {summary.winnerTeam !== 'draw'
                ? `搶旗數量較多隊伍獲勝，全體獲勝隊員獲得額外 +$${summary.victoryBonus.toLocaleString()} 勝利獎金！`
                : '雙方旗幟數量相同，無人獲得額外勝利獎金。'}
            </p>
          </div>

          <div className="flex items-center gap-5 px-5 py-3 rounded-xl bg-[#090d16] border border-slate-800">
            <div className="text-center">
              <div className="text-xs text-red-400 font-semibold">紅隊旗數</div>
              <div className="font-mono-num text-3xl font-bold text-white">{summary.redScore}</div>
            </div>
            <span className="text-slate-600 font-bold text-xl">:</span>
            <div className="text-center">
              <div className="text-xs text-cyan-400 font-semibold">藍隊旗數</div>
              <div className="font-mono-num text-3xl font-bold text-white">{summary.blueScore}</div>
            </div>
          </div>
        </div>

        {/* Personal Reward Callout */}
        {localActor && (
          <div
            className={`rounded-xl p-4 border flex flex-wrap items-center justify-between gap-4 ${
              localWon
                ? 'bg-amber-500/15 border-amber-400/60'
                : 'bg-[#090d16] border-slate-800'
            }`}
          >
            <div>
              <div className="text-sm font-bold text-white">
                {localWon
                  ? `恭喜獲勝！您獲得額外勝利獎金 +$${summary.victoryBonus.toLocaleString()}（已存入大廳戰術金庫）`
                  : '本場對戰結束，累計餘額已存入戰術金庫'}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                本場戰績：{localActor.captures} 次奪旗 · {localActor.kills} 擊殺 · {localActor.deaths} 陣亡
              </div>
            </div>
            <div className="flex items-center gap-2 font-mono-num text-2xl font-bold text-amber-300">
              <Coins className="w-5 h-5 text-amber-400" />${localActor.money.toLocaleString()}
            </div>
          </div>
        )}

        {/* Leaderboard Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-800">
                <th className="py-2 font-medium">隊伍</th>
                <th className="py-2 font-medium">選手</th>
                <th className="py-2 text-right font-medium">搶旗得分</th>
                <th className="py-2 text-right font-medium">歸位護旗</th>
                <th className="py-2 text-right font-medium">擊殺</th>
                <th className="py-2 text-right font-medium">陣亡</th>
                <th className="py-2 text-right font-medium">總金錢 (含勝場獎金)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {sortedActors.map((a) => (
                <tr
                  key={a.id}
                  className={a.id === localPlayerId ? 'bg-white/10 font-semibold text-white' : 'text-slate-300'}
                >
                  <td className="py-2.5">{renderTeamBadge(a.team)}</td>
                  <td className="py-2.5">
                    {a.name}
                    {a.id === localPlayerId ? ' (您)' : ''}
                  </td>
                  <td className="py-2.5 text-right font-mono-num text-amber-300">{a.captures}</td>
                  <td className="py-2.5 text-right font-mono-num text-sky-300">{a.returns}</td>
                  <td className="py-2.5 text-right font-mono-num">{a.kills}</td>
                  <td className="py-2.5 text-right font-mono-num text-slate-400">{a.deaths}</td>
                  <td className="py-2.5 text-right font-mono-num text-emerald-300">
                    ${a.money.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onBackToLobby}
            className="px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold flex items-center gap-2"
          >
            <Home className="w-4 h-4" />
            返回大廳
          </button>
          <button
            type="button"
            disabled={!isHost}
            onClick={onRematch}
            className="px-6 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-45 text-slate-950 text-sm font-bold flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            {isHost ? '再戰一場' : '等待房主重開'}
          </button>
        </div>
      </div>
    </div>
  );
}
