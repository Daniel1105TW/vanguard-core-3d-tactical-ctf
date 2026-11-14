import { Trophy, Coins, RotateCcw, Home, Award, Flame, Target, Crosshair } from 'lucide-react';
import { GAME_MODES } from '../shared/gameConfig.ts';
import type { ActorSnapshot, MatchEndSummary, TeamId } from '../shared/gameConfig.ts';

interface MatchEndModalProps {
  summary: MatchEndSummary;
  localPlayerId: string | null;
  isHost: boolean;
  onRematch: () => void;
  onBackToLobby: () => void;
}

function getCombatRating(a: ActorSnapshot): number {
  return (
    a.kills * 100 +
    a.assists * 45 +
    a.captures * 180 +
    a.returns * 90 +
    a.zoneScore * 6 +
    Math.round(a.damageDealt / 15)
  );
}

export function MatchEndModal({
  summary,
  localPlayerId,
  isHost,
  onRematch,
  onBackToLobby,
}: MatchEndModalProps) {
  const modeInfo = GAME_MODES.find((m) => m.id === summary.gameMode) ?? GAME_MODES[0];
  const localActor = summary.actors.find((a) => a.id === localPlayerId);
  const localWon = localActor && summary.winnerTeam !== 'draw' && localActor.team === summary.winnerTeam;

  const sortedActors = [...summary.actors].sort((a, b) => getCombatRating(b) - getCombatRating(a));
  const mvpActor = sortedActors[0] ?? null;

  const topDamageActor = [...summary.actors].sort((a, b) => b.damageDealt - a.damageDealt)[0] ?? null;
  const topStreakActor = [...summary.actors].sort((a, b) => b.bestStreak - a.bestStreak)[0] ?? null;
  const topHeadshotActor = [...summary.actors].sort((a, b) => b.headshots - a.headshots)[0] ?? null;

  const winnerTitle =
    summary.winnerTeam === 'red'
      ? '紅隊獲得勝利！'
      : summary.winnerTeam === 'blue'
        ? '藍隊獲得勝利！'
        : '雙方平手！';

  const modeVictoryDesc =
    summary.gameMode === 'ctf'
      ? '搶旗數量較多隊伍獲勝'
      : summary.gameMode === 'dom'
        ? '據點累計分數較高隊伍獲勝'
        : '團隊擊殺總數較多隊伍獲勝';

  const renderTeamBadge = (team: TeamId) => (
    <span className={team === 'red' ? 'text-red-400 font-semibold' : 'text-cyan-400 font-semibold'}>
      {team === 'red' ? '紅隊' : '藍隊'}
    </span>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-[#090d16]/88 pointer-events-auto overflow-y-auto">
      <div className="w-full max-w-5xl bg-[#0d1422] border border-slate-700 rounded-xl p-6 md:p-8 space-y-5 my-auto">
        {/* Outcome Banner */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
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
              <span className="px-2.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-semibold text-amber-300">
                {modeInfo.name}
              </span>
            </div>
            <p className="text-sm text-slate-300">
              {summary.winnerTeam !== 'draw'
                ? `${modeVictoryDesc}，全體獲勝隊員獲得額外 +$${summary.victoryBonus.toLocaleString()} 勝利獎金！`
                : '雙方積分相同，無人獲得額外勝利獎金。'}
            </p>
          </div>

          <div className="flex items-center gap-5 px-5 py-3 rounded-xl bg-[#090d16] border border-slate-800">
            <div className="text-center">
              <div className="text-xs text-red-400 font-semibold">紅隊 ({modeInfo.scoreUnit})</div>
              <div className="font-mono-num text-3xl font-bold text-white">{summary.redScore}</div>
            </div>
            <span className="text-slate-600 font-bold text-xl">:</span>
            <div className="text-center">
              <div className="text-xs text-cyan-400 font-semibold">藍隊 ({modeInfo.scoreUnit})</div>
              <div className="font-mono-num text-3xl font-bold text-white">{summary.blueScore}</div>
            </div>
          </div>
        </div>

        {/* MVP & Combat Awards Row */}
        {mvpActor && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-1 rounded-xl p-3.5 bg-amber-500/14 border border-amber-400/55 flex flex-col justify-between gap-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                <Award className="w-4 h-4 shrink-0" />
                全場 MVP
              </div>
              <div className="font-display text-lg font-bold text-white truncate">
                {mvpActor.name}
                {mvpActor.id === localPlayerId ? ' (您)' : ''}
              </div>
              <div className="font-mono-num text-[11px] text-amber-200/90">
                評分 {getCombatRating(mvpActor).toLocaleString()} · {mvpActor.kills}/{mvpActor.deaths}/{mvpActor.assists}
              </div>
            </div>

            <div className="rounded-xl p-3.5 bg-[#090d16] border border-slate-800 flex flex-col justify-between gap-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-300">
                <Target className="w-3.5 h-3.5 shrink-0" />
                全場最高傷害
              </div>
              <div className="font-semibold text-sm text-white truncate">
                {topDamageActor ? topDamageActor.name : '-'}
              </div>
              <div className="font-mono-num text-xs text-slate-300">
                {topDamageActor ? `${topDamageActor.damageDealt.toLocaleString()} 傷害` : '0 傷害'}
              </div>
            </div>

            <div className="rounded-xl p-3.5 bg-[#090d16] border border-slate-800 flex flex-col justify-between gap-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-300">
                <Flame className="w-3.5 h-3.5 shrink-0" />
                最強連殺紀錄
              </div>
              <div className="font-semibold text-sm text-white truncate">
                {topStreakActor && topStreakActor.bestStreak > 0 ? topStreakActor.name : '從缺'}
              </div>
              <div className="font-mono-num text-xs text-slate-300">
                {topStreakActor ? `${topStreakActor.bestStreak} 連殺` : '0 連殺'}
              </div>
            </div>

            <div className="rounded-xl p-3.5 bg-[#090d16] border border-slate-800 flex flex-col justify-between gap-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
                <Crosshair className="w-3.5 h-3.5 shrink-0" />
                精準神射手
              </div>
              <div className="font-semibold text-sm text-white truncate">
                {topHeadshotActor && topHeadshotActor.headshots > 0 ? topHeadshotActor.name : '從缺'}
              </div>
              <div className="font-mono-num text-xs text-slate-300">
                {topHeadshotActor ? `${topHeadshotActor.headshots} 次爆頭` : '0 次爆頭'}
              </div>
            </div>
          </div>
        )}

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
              <div className="font-mono-num text-xs text-slate-400 mt-0.5">
                戰績：{localActor.kills} 殺 / {localActor.deaths} 死 / {localActor.assists} 助 · 總傷害{' '}
                {localActor.damageDealt.toLocaleString()} · 最佳 {localActor.bestStreak} 連殺
                {summary.gameMode === 'ctf'
                  ? ` · ${localActor.captures} 次奪旗`
                  : summary.gameMode === 'dom'
                    ? ` · ${localActor.zoneScore} 據點分`
                    : ''}
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
                {summary.gameMode === 'ctf' && <th className="py-2 text-right font-medium">搶旗/護旗</th>}
                {summary.gameMode === 'dom' && <th className="py-2 text-right font-medium">據點積分</th>}
                <th className="py-2 text-right font-medium">K / D / A</th>
                <th className="py-2 text-right font-medium">總傷害</th>
                <th className="py-2 text-right font-medium">爆頭</th>
                <th className="py-2 text-right font-medium">最高連殺</th>
                <th className="py-2 text-right font-medium">總金錢</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {sortedActors.map((a) => {
                const isMvp = mvpActor?.id === a.id;
                return (
                  <tr
                    key={a.id}
                    className={a.id === localPlayerId ? 'bg-white/10 font-semibold text-white' : 'text-slate-300'}
                  >
                    <td className="py-2.5">{renderTeamBadge(a.team)}</td>
                    <td className="py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        {isMvp && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/60 text-[10px] font-bold text-amber-300">
                            MVP
                          </span>
                        )}
                        <span>{a.name}</span>
                        {a.id === localPlayerId ? <span className="text-xs text-amber-300">(您)</span> : null}
                      </span>
                    </td>
                    {summary.gameMode === 'ctf' && (
                      <td className="py-2.5 text-right font-mono-num text-amber-300">
                        {a.captures} / {a.returns}
                      </td>
                    )}
                    {summary.gameMode === 'dom' && (
                      <td className="py-2.5 text-right font-mono-num text-amber-300">{a.zoneScore}</td>
                    )}
                    <td className="py-2.5 text-right font-mono-num">
                      {a.kills} / <span className="text-slate-400">{a.deaths}</span> /{' '}
                      <span className="text-sky-300">{a.assists}</span>
                    </td>
                    <td className="py-2.5 text-right font-mono-num text-slate-200">
                      {a.damageDealt.toLocaleString()}
                    </td>
                    <td className="py-2.5 text-right font-mono-num text-cyan-300">{a.headshots}</td>
                    <td className="py-2.5 text-right font-mono-num text-orange-300">{a.bestStreak}</td>
                    <td className="py-2.5 text-right font-mono-num text-emerald-300">
                      ${a.money.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
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
