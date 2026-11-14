import { X, Coins, ArrowUpRight, Check, Flame, Cloud, Zap } from 'lucide-react';
import {
  GADGETS,
  GADGET_ORDER,
  MAX_UPGRADE_LEVEL,
  UPGRADE_COSTS,
  WEAPONS,
  WEAPON_ORDER,
  getEffectiveWeaponStats,
} from '../shared/gameConfig.ts';
import type { ActorSnapshot, GadgetId, UpgradeStat, WeaponId } from '../shared/gameConfig.ts';

interface ArmoryModalProps {
  actor: ActorSnapshot;
  onClose: () => void;
  onBuyWeapon: (weaponId: WeaponId) => void;
  onSwitchWeapon: (weaponId: WeaponId) => void;
  onUpgradeWeapon: (weaponId: WeaponId, stat: UpgradeStat) => void;
  onBuyGadget: (gadgetId: GadgetId) => void;
  onSwitchGadget: (gadgetId: GadgetId) => void;
}

function GadgetIcon({ id, className }: { id: GadgetId; className?: string }) {
  if (id === 'frag') return <Flame className={className} />;
  if (id === 'smoke') return <Cloud className={className} />;
  return <Zap className={className} />;
}

export function ArmoryModal({
  actor,
  onClose,
  onBuyWeapon,
  onSwitchWeapon,
  onUpgradeWeapon,
  onBuyGadget,
  onSwitchGadget,
}: ArmoryModalProps) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#090d16]/82 pointer-events-auto">
      <div className="w-full max-w-6xl max-h-[90vh] flex flex-col bg-[#0d1422] border border-slate-700 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#090d16]">
          <div>
            <h2 className="font-display text-xl font-bold text-white">軍械庫商店與武器升級</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              擊殺敵人 (+$150)、搶奪旗幟 (+$100) 與成功帶回得分 (+$400) 皆可獲得金錢 · 共 8 款戰術槍械與 3 款投擲裝備
            </p>
          </div>
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2 font-mono-num text-xl font-bold text-amber-300">
              <Coins className="w-5 h-5 text-amber-400" />${actor.money.toLocaleString()}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
            >
              <X className="w-4 h-4" />
              返回戰鬥 [B]
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {/* Tactical Equipment Section */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-amber-300 tracking-wide">
                戰術投擲裝備（按 [G] 投擲 · [Q] 切換）
              </h3>
              <span className="text-xs text-slate-400">
                可於交火時部署煙霧掩護、破片轟炸或電磁干擾
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {GADGET_ORDER.map((gid) => {
                const spec = GADGETS[gid];
                const count = actor.gadgets?.[gid] ?? 0;
                const isActive = actor.activeGadget === gid;
                const isFull = count >= spec.maxCarry;
                const canAfford = actor.money >= spec.cost && !isFull;

                return (
                  <div
                    key={gid}
                    className={`rounded-xl p-3.5 border flex flex-col justify-between gap-2.5 ${
                      isActive
                        ? 'bg-amber-950/25 border-amber-400/70'
                        : 'bg-[#090d16]/75 border-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <div
                          className="w-9 h-9 rounded-lg flex items-center justify-center border border-slate-700 bg-slate-900 shrink-0"
                          style={{ color: spec.accentColor }}
                        >
                          <GadgetIcon id={gid} className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-display text-sm font-bold text-white">{spec.name}</h4>
                            <span className="font-mono-num text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">
                              {count}/{spec.maxCarry}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">{spec.englishName}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {count > 0 && (
                          <button
                            type="button"
                            onClick={() => onSwitchGadget(gid)}
                            className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                              isActive
                                ? 'bg-cyan-500/20 border border-cyan-400/60 text-cyan-200'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                            }`}
                          >
                            {isActive ? '裝備中' : '切換'}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={!canAfford}
                          onClick={() => onBuyGadget(gid)}
                          className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs font-bold font-mono-num transition-colors"
                        >
                          {isFull ? '已滿' : `+$${spec.cost}`}
                        </button>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-300 leading-relaxed">{spec.description}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Weapons Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {WEAPON_ORDER.map((wid, idx) => {
              const spec = WEAPONS[wid];
              const upg = actor.ownedWeapons[wid];
              const owned = Boolean(upg);
              const equipped = actor.activeWeapon === wid;
              const effective = getEffectiveWeaponStats(wid, upg);
              const canAffordBuy = actor.money >= spec.cost;

              const statRows: Array<{
                key: UpgradeStat;
                label: string;
                level: number;
                displayVal: string;
              }> = [
                {
                  key: 'damage',
                  label: '火力傷害',
                  level: upg?.damageLevel ?? 1,
                  displayVal: `${effective.damage}${effective.pellets > 1 ? `×${effective.pellets}` : ''}`,
                },
                {
                  key: 'fireRate',
                  label: '射擊速率',
                  level: upg?.fireRateLevel ?? 1,
                  displayVal: `${(1 / effective.fireInterval).toFixed(1)}/s`,
                },
                {
                  key: 'mag',
                  label: '彈匣容量',
                  level: upg?.magLevel ?? 1,
                  displayVal: `${effective.magSize} 發`,
                },
              ];

              return (
                <div
                  key={wid}
                  className={`rounded-xl p-3.5 border flex flex-col justify-between gap-3 ${
                    equipped
                      ? 'bg-cyan-950/25 border-cyan-400/70'
                      : owned
                        ? 'bg-[#090d16]/85 border-slate-700'
                        : 'bg-[#090d16]/55 border-slate-800'
                  }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono-num text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                            {idx + 1}
                          </span>
                          <h3 className="font-display text-base font-bold text-white">{spec.name}</h3>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {spec.englishName} ·{' '}
                          {spec.scopeType === 'sniper' ? '光學倍鏡' : spec.scopeType === 'holo' ? '全息鏡' : '機瞄'}
                        </p>
                      </div>
                      {equipped ? (
                        <span className="text-xs font-semibold text-cyan-300 flex items-center gap-1 shrink-0">
                          <Check className="w-3.5 h-3.5" /> 裝備中
                        </span>
                      ) : owned ? (
                        <button
                          type="button"
                          onClick={() => onSwitchWeapon(wid)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-white font-semibold shrink-0"
                        >
                          裝備
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={!canAffordBuy}
                          onClick={() => onBuyWeapon(wid)}
                          className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs font-bold font-mono-num transition-colors shrink-0"
                        >
                          ${spec.cost}
                        </button>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-300 leading-relaxed min-h-[2.6rem]">
                      {spec.description}
                    </p>

                    {/* Upgrades */}
                    <div className="space-y-2 pt-2 border-t border-slate-800/90">
                      {statRows.map((row) => {
                        const isMax = row.level >= MAX_UPGRADE_LEVEL;
                        const nextCost = isMax ? 0 : UPGRADE_COSTS[row.level];
                        const canUpgrade = owned && !isMax && actor.money >= nextCost;

                        return (
                          <div key={row.key} className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-slate-300">{row.label}</span>
                                <span className="font-mono-num text-slate-200 font-semibold">
                                  {row.displayVal} · Lv.{row.level}
                                </span>
                              </div>
                              <div className="grid grid-cols-4 gap-1">
                                {[1, 2, 3, 4].map((lv) => (
                                  <div
                                    key={lv}
                                    className={`h-1 rounded ${
                                      lv <= row.level ? 'bg-cyan-400' : 'bg-slate-800'
                                    }`}
                                  />
                                ))}
                              </div>
                            </div>

                            <button
                              type="button"
                              disabled={!canUpgrade}
                              onClick={() => onUpgradeWeapon(wid, row.key)}
                              className={`px-2 py-1.5 rounded font-mono-num text-[11px] font-bold shrink-0 flex items-center gap-0.5 transition-colors ${
                                isMax
                                  ? 'bg-slate-900 text-emerald-400 cursor-default'
                                  : canUpgrade
                                    ? 'bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-400/50 text-cyan-200'
                                    : 'bg-slate-900 text-slate-600 cursor-not-allowed'
                              }`}
                            >
                              {isMax ? (
                                'MAX'
                              ) : (
                                <>
                                  <ArrowUpRight className="w-3 h-3" />${nextCost}
                                </>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

