import type { ActorSnapshot, StateSyncPayload, TeamId } from '../shared/gameConfig.ts';

interface ScoreboardModalProps {
  state: StateSyncPayload;
  localPlayerId: string | null;
}

export function ScoreboardModal({ state, localPlayerId }: ScoreboardModalProps) {
  const renderTeamTable = (team: TeamId) => {
    const isRed = team === 'red';
    const members = state.actors
      .filter((a) => a.team === team)
      .sort((a, b) => b.captures * 100 + b.kills - (a.captures * 100 + a.kills));

    return (
      <div
        className={`rounded-xl border p-4 ${
          isRed ? 'bg-red-950/20 border-red-500/40' : 'bg-cyan-950/20 border-cyan-500/40'
        }`}
      >
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
          <h3 className={`font-display text-lg font-bold ${isRed ? 'text-red-400' : 'text-cyan-400'}`}>
            {isRed ? '紅隊 Crimson' : '藍隊 Cobalt'}
          </h3>
          <span className="font-mono-num text-xl font-bold text-white">
            {isRed ? state.redScore : state.blueScore} 旗
          </span>
        </div>

        <table className="w-full text-xs text-left">
          <thead>
            <tr className="text-slate-400 border-b border-slate-800/80">
              <th className="py-1.5 font-medium">隊員</th>
              <th className="py-1.5 text-right font-medium">搶旗</th>
              <th className="py-1.5 text-right font-medium">擊殺</th>
              <th className="py-1.5 text-right font-medium">陣亡</th>
              <th className="py-1.5 text-right font-medium">金錢</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {members.map((a: ActorSnapshot) => (
              <tr
                key={a.id}
                className={a.id === localPlayerId ? 'bg-white/10 font-semibold text-white' : 'text-slate-300'}
              >
                <td className="py-2 pr-2 truncate max-w-[140px]">
                  {a.name}
                  {a.id === localPlayerId ? ' (您)' : ''}
                </td>
                <td className="py-2 text-right font-mono-num text-amber-300">{a.captures}</td>
                <td className="py-2 text-right font-mono-num">{a.kills}</td>
                <td className="py-2 text-right font-mono-num text-slate-400">{a.deaths}</td>
                <td className="py-2 text-right font-mono-num text-emerald-300">${a.money}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-6 bg-[#090d16]/75 pointer-events-none">
      <div className="w-full max-w-4xl bg-[#0d1422]/96 border border-slate-700 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-white">即時戰績表</h2>
          <span className="font-mono-num text-xs text-slate-400">房號 {state.roomId}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {renderTeamTable('red')}
          {renderTeamTable('blue')}
        </div>
      </div>
    </div>
  );
}
