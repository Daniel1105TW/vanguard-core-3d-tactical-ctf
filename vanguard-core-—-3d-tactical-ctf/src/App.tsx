import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_MAP_LAYOUT, ECONOMY, generateMapLayout } from './shared/gameConfig.ts';
import type {
  DigUpdateEvent,
  GadgetFxEvent,
  GadgetId,
  KillFeedEvent,
  MapLayout,
  MapMode,
  MatchEndSummary,
  RoomLobbyInfo,
  RoomSettings,
  StateSyncPayload,
  TeamId,
  TracerEvent,
  UpgradeStat,
  WeaponId,
} from './shared/gameConfig.ts';
import { ArenaEngine } from './three/ArenaEngine.ts';
import type { ArenaPoseState, HudProjection } from './three/ArenaEngine.ts';
import { soundEngine } from './audio/soundEngine.ts';
import { LobbyScreen } from './components/LobbyScreen.tsx';
import { GameHUD } from './components/GameHUD.tsx';
import { ArmoryModal } from './components/ArmoryModal.tsx';
import { ScoreboardModal } from './components/ScoreboardModal.tsx';
import { MatchEndModal } from './components/MatchEndModal.tsx';
import { PauseModal } from './components/PauseModal.tsx';
import type { GameSettings } from './components/PauseModal.tsx';

const DEFAULT_SETTINGS: GameSettings = {
  sensitivity: 1.0,
  fov: 76,
  volume: 1.0,
};

function loadSavedSettings(): GameSettings {
  try {
    const raw = localStorage.getItem('vc_settings');
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      sensitivity:
        typeof parsed.sensitivity === 'number' && Number.isFinite(parsed.sensitivity)
          ? Math.min(2.4, Math.max(0.4, parsed.sensitivity))
          : DEFAULT_SETTINGS.sensitivity,
      fov:
        typeof parsed.fov === 'number' && Number.isFinite(parsed.fov)
          ? Math.min(95, Math.max(65, parsed.fov))
          : DEFAULT_SETTINGS.fov,
      volume:
        typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
          ? Math.min(1, Math.max(0, parsed.volume))
          : DEFAULT_SETTINGS.volume,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ArenaEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const prevHpRef = useRef<number>(100);
  const localTeamRef = useRef<TeamId>('blue');
  const shopOpenRef = useRef<boolean>(false);
  const pauseOpenRef = useRef<boolean>(false);
  const isPlayingRef = useRef<boolean>(false);
  const isSoloRef = useRef<boolean>(true);
  const aliveRef = useRef<boolean>(true);
  const matchSummaryRef = useRef<MatchEndSummary | null>(null);

  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [lobby, setLobby] = useState<RoomLobbyInfo | null>(null);
  const [gameState, setGameState] = useState<StateSyncPayload | null>(null);
  const [matchSummary, setMatchSummary] = useState<MatchEndSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [pointerLocked, setPointerLocked] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [pose, setPose] = useState<ArenaPoseState>({
    crouching: false,
    aiming: false,
    weaponId: 'pistol',
    scopeType: 'iron',
  });
  const [gameSettings, setGameSettings] = useState<GameSettings>(() => loadSavedSettings());
  const [hitmarker, setHitmarker] = useState<'none' | 'body' | 'head' | 'kill'>('none');
  const [hitBadge, setHitBadge] = useState<{ text: string; tone: 'body' | 'head' | 'kill' } | null>(null);
  const [damageFlash, setDamageFlash] = useState(false);
  const [feed, setFeed] = useState<KillFeedEvent[]>([]);
  const [mapLayout, setMapLayout] = useState<MapLayout>(DEFAULT_MAP_LAYOUT);
  const [digVersion, setDigVersion] = useState(0);
  const [projection, setProjection] = useState<HudProjection>({
    enemyFlagScreen: null,
    homeBaseScreen: null,
  });
  const [insideSmoke, setInsideSmoke] = useState(false);
  const [muted, setMuted] = useState(false);
  const [commanderVault, setCommanderVault] = useState<number>(() => {
    const saved = Number(localStorage.getItem('vc_vault') || '0');
    return Number.isFinite(saved) ? saved : 0;
  });

  useEffect(() => {
    localStorage.setItem('vc_vault', String(commanderVault));
  }, [commanderVault]);

  useEffect(() => {
    localStorage.setItem('vc_settings', JSON.stringify(gameSettings));
    soundEngine.setVolume(gameSettings.volume);
    engineRef.current?.applySettings({
      sensitivityScale: gameSettings.sensitivity,
      baseFov: gameSettings.fov,
    });
  }, [gameSettings]);

  useEffect(() => {
    shopOpenRef.current = shopOpen;
    engineRef.current?.setShopOpen(shopOpen);
  }, [shopOpen]);

  useEffect(() => {
    pauseOpenRef.current = pauseOpen;
  }, [pauseOpen]);

  useEffect(() => {
    engineRef.current?.setPaused(Boolean(gameState?.paused));
  }, [gameState?.paused]);

  const sendWs = useCallback((type: string, payload?: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  // Initialize Three.js Engine once
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const engine = new ArenaEngine(mount, {
      onPointerLockChange: (locked) => {
        setPointerLocked(locked);
        if (
          !locked &&
          isPlayingRef.current &&
          !shopOpenRef.current &&
          !matchSummaryRef.current &&
          aliveRef.current
        ) {
          setPauseOpen(true);
          if (isSoloRef.current) {
            sendWs('room:pause', { paused: true });
          }
        }
      },
      onShoot: (origin, dir, aiming) => sendWs('player:shoot', { origin, dir, aiming }),
      onDig: (origin, dir) => sendWs('player:dig', { origin, dir }),
      onReload: () => sendWs('player:reload'),
      onSwitchWeapon: (weaponId) => sendWs('player:switchWeapon', { weaponId }),
      onThrowGadget: (origin, dir) => sendWs('player:throwGadget', { origin, dir }),
      onSwitchGadget: (gadgetId) => sendWs('player:switchGadget', { gadgetId }),
      onSmokeStateChange: (inside) => setInsideSmoke(inside),
      onStateReport: (pos) => sendWs('player:state', pos),
      onOpenShopKey: () => setShopOpen((prev) => !prev),
      onScoreboardKey: (open) => setScoreboardOpen(open),
      onEscapeKey: () => {
        if (shopOpenRef.current) {
          setShopOpen(false);
          engineRef.current?.requestPointerLock();
          return;
        }
        if (pauseOpenRef.current) {
          setPauseOpen(false);
          sendWs('room:pause', { paused: false });
          engineRef.current?.requestPointerLock();
          return;
        }
        if (isPlayingRef.current && !matchSummaryRef.current) {
          setPauseOpen(true);
          engineRef.current?.unlockPointer();
          if (isSoloRef.current) {
            sendWs('room:pause', { paused: true });
          }
        }
      },
      onPoseChange: (nextPose) => setPose(nextPose),
      onHudProject: (proj) => setProjection(proj),
    });

    engine.applySettings({
      sensitivityScale: gameSettings.sensitivity,
      baseFov: gameSettings.fov,
    });
    soundEngine.setVolume(gameSettings.volume);

    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [sendWs]);

  // Connect WebSocket with Auto-Reconnect
  useEffect(() => {
    let closedByCleanup = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let hitTimer: ReturnType<typeof setTimeout> | null = null;
    let badgeTimer: ReturnType<typeof setTimeout> | null = null;
    let dmgTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setErrorMsg(null);
      };

      ws.onclose = () => {
        setConnected(false);
        if (!closedByCleanup) {
          reconnectTimer = setTimeout(connect, 1800);
        }
      };

      ws.onmessage = (ev) => {
        let msg: { type: string; payload?: unknown };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }

        switch (msg.type) {
          case 'session:init': {
            const p = msg.payload as { playerId: string };
            playerIdRef.current = p.playerId;
            setPlayerId(p.playerId);
            break;
          }
          case 'room:joined':
          case 'room:updated': {
            const info = msg.payload as RoomLobbyInfo;
            setLobby(info);
            setErrorMsg(null);
            break;
          }
          case 'room:left': {
            setLobby(null);
            setGameState(null);
            setMatchSummary(null);
            setShopOpen(false);
            setPauseOpen(false);
            setInsideSmoke(false);
            engineRef.current?.setPlayingMode(false, null, 'blue');
            break;
          }
          case 'room:error': {
            const err = msg.payload as { message: string };
            setErrorMsg(err.message);
            break;
          }
          case 'match:started': {
            const state = msg.payload as StateSyncPayload;
            setMatchSummary(null);
            setFeed([]);
            setShopOpen(false);
            setPauseOpen(false);
            setInsideSmoke(false);
            setGameState(state);
            const nextLayout = generateMapLayout(state.mapMode, state.mapSeed);
            setMapLayout(nextLayout);
            setDigVersion(state.digVersion ?? 0);

            const me = state.actors.find((a) => a.id === playerIdRef.current);
            prevHpRef.current = me?.hp ?? 100;
            localTeamRef.current = me?.team ?? 'blue';
            engineRef.current?.setMapLayout(state.mapMode, state.mapSeed, state.dugCells);
            engineRef.current?.setPlayingMode(
              true,
              playerIdRef.current,
              me?.team ?? 'blue',
            );
            if (me) {
              engineRef.current?.snapToActor(me);
            }
            engineRef.current?.applyServerSync(state);
            break;
          }
          case 'dig:update': {
            const ev = msg.payload as DigUpdateEvent;
            engineRef.current?.applyDigUpdate(ev.index, ev.hp, { x: ev.x, z: ev.z });
            setDigVersion(ev.digVersion);
            break;
          }
          case 'gadget:fx': {
            const ev = msg.payload as GadgetFxEvent;
            engineRef.current?.triggerGadgetFx(ev);
            break;
          }
          case 'state:sync': {
            const state = msg.payload as StateSyncPayload;
            setGameState(state);
            engineRef.current?.applyServerSync(state);

            const me = state.actors.find((a) => a.id === playerIdRef.current);
            if (me) {
              if (me.hp < prevHpRef.current && me.alive) {
                setDamageFlash(true);
                if (dmgTimer) clearTimeout(dmgTimer);
                dmgTimer = setTimeout(() => setDamageFlash(false), 180);
              }
              prevHpRef.current = me.hp;
            }
            break;
          }
          case 'combat:tracer': {
            const tracer = msg.payload as TracerEvent;
            engineRef.current?.spawnTracer(tracer);
            if (tracer.shooterId === playerIdRef.current && tracer.hitActorId) {
              const isHead = Boolean(tracer.headshot);
              const isKill = Boolean(tracer.killed);
              soundEngine.playHitmarker(isHead, isKill);
              engineRef.current?.triggerHitConfirmFeedback(isHead, isKill);
              setHitmarker(isKill ? 'kill' : isHead ? 'head' : 'body');
              if (hitTimer) clearTimeout(hitTimer);
              hitTimer = setTimeout(() => setHitmarker('none'), isKill ? 220 : 150);

              const dmgLabel = tracer.damage ? `-${tracer.damage}` : '';
              const badgeText = isKill
                ? isHead
                  ? `爆頭擊殺 +$${ECONOMY.KILL_REWARD + ECONOMY.HEADSHOT_BONUS}`
                  : `擊殺目標 +$${ECONOMY.KILL_REWARD}`
                : isHead
                  ? `爆頭 ${dmgLabel}`
                  : `命中 ${dmgLabel}`;
              setHitBadge({ text: badgeText, tone: isKill ? 'kill' : isHead ? 'head' : 'body' });
              if (badgeTimer) clearTimeout(badgeTimer);
              badgeTimer = setTimeout(() => setHitBadge(null), isKill ? 900 : 480);
            } else if (tracer.hitActorId === playerIdRef.current) {
              engineRef.current?.triggerDamageFeedback(Boolean(tracer.headshot));
              setDamageFlash(true);
              if (dmgTimer) clearTimeout(dmgTimer);
              dmgTimer = setTimeout(() => setDamageFlash(false), 200);
            }
            break;
          }
          case 'combat:feed': {
            const item = msg.payload as KillFeedEvent;
            setFeed((prev) => [item, ...prev].slice(0, 8));
            if (item.type === 'pickup') {
              soundEngine.playFlagPickup(true);
            } else if (item.type === 'return') {
              soundEngine.playFlagReturn();
            } else if (item.type === 'capture') {
              soundEngine.playFlagCapture(item.actorTeam === localTeamRef.current);
            }
            break;
          }
          case 'shop:result': {
            const res = msg.payload as { ok: boolean; error?: string };
            if (res.ok) soundEngine.playPurchase();
            break;
          }
          case 'match:ended': {
            const summary = msg.payload as MatchEndSummary;
            setMatchSummary(summary);
            setShopOpen(false);
            setPauseOpen(false);
            setScoreboardOpen(false);
            engineRef.current?.setPlayingMode(false, playerIdRef.current, 'blue');

            const me = summary.actors.find((a) => a.id === playerIdRef.current);
            if (me) {
              const won = summary.winnerTeam !== 'draw' && me.team === summary.winnerTeam;
              const earned = me.money;
              setCommanderVault((v) => v + earned);
              soundEngine.playFlagCapture(won);
            }
            break;
          }
        }
      };
    };

    connect();

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (hitTimer) clearTimeout(hitTimer);
      if (badgeTimer) clearTimeout(badgeTimer);
      if (dmgTimer) clearTimeout(dmgTimer);
      wsRef.current?.close();
    };
  }, []);

  const handleToggleMute = () => {
    const next = !muted;
    soundEngine.muted = next;
    setMuted(next);
  };

  const handleSpendStipend = (useStipend: boolean): boolean => {
    if (useStipend && commanderVault >= ECONOMY.STIPEND_COST) {
      setCommanderVault((v) => Math.max(0, v - ECONOMY.STIPEND_COST));
      return true;
    }
    return false;
  };

  const handleQuickPlay = (name: string, useStipend: boolean, mapMode: MapMode) => {
    soundEngine.unlock();
    const applied = handleSpendStipend(useStipend);
    sendWs('room:quickplay', { name, useStipend: applied, mapMode });
  };

  const handleCreateRoom = (
    name: string,
    team: TeamId,
    settings: RoomSettings,
    useStipend: boolean,
  ) => {
    soundEngine.unlock();
    const applied = handleSpendStipend(useStipend);
    sendWs('room:create', { name, team, settings, useStipend: applied });
  };

  const handleJoinRoom = (roomId: string, name: string, useStipend: boolean) => {
    soundEngine.unlock();
    const applied = handleSpendStipend(useStipend);
    sendWs('room:join', { roomId, name, useStipend: applied });
  };

  const localActor = gameState?.actors.find((a) => a.id === playerId) ?? null;
  const isPlaying = Boolean(gameState && gameState.phase === 'playing' && localActor && !matchSummary);
  const isSolo = (gameState?.humanCount ?? 1) <= 1;

  isPlayingRef.current = isPlaying;
  isSoloRef.current = isSolo;
  aliveRef.current = Boolean(localActor?.alive);
  matchSummaryRef.current = matchSummary;

  const handleOpenMenu = () => {
    engineRef.current?.unlockPointer();
    setPauseOpen(true);
    if (isSolo) {
      sendWs('room:pause', { paused: true });
    }
  };

  const handleResumeGame = () => {
    setPauseOpen(false);
    sendWs('room:pause', { paused: false });
    engineRef.current?.requestPointerLock();
  };

  const handleExitGame = () => {
    setPauseOpen(false);
    setShopOpen(false);
    sendWs('room:pause', { paused: false });
    sendWs('room:leave');
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#090d16]">
      {/* Isolated WebGL Viewport */}
      <div ref={canvasMountRef} className="fixed inset-0 w-full h-full z-0" />

      {/* Lobby Overlay */}
      {!isPlaying && !matchSummary && (
        <LobbyScreen
          connected={connected}
          playerId={playerId}
          lobby={lobby}
          errorMsg={errorMsg}
          commanderVault={commanderVault}
          muted={muted}
          onToggleMute={handleToggleMute}
          onQuickPlay={handleQuickPlay}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onSwitchTeam={(team) => sendWs('room:switchTeam', { team })}
          onUpdateSettings={(s) => sendWs('room:settings', s)}
          onStartMatch={() => sendWs('room:start')}
          onLeaveRoom={() => sendWs('room:leave')}
        />
      )}

      {/* Active FPS HUD */}
      {isPlaying && gameState && localActor && (
        <GameHUD
          state={gameState}
          localActor={localActor}
          pointerLocked={pointerLocked}
          shopOpen={shopOpen}
          pauseOpen={pauseOpen}
          pose={pose}
          insideSmoke={insideSmoke}
          hitmarker={hitmarker}
          hitBadge={hitBadge}
          damageFlash={damageFlash}
          feed={feed}
          projection={projection}
          mapLayout={mapLayout}
          digHp={engineRef.current?.getDigHpSnapshot()}
          digVersion={digVersion}
          muted={muted}
          onToggleMute={handleToggleMute}
          onOpenShop={() => {
            setPauseOpen(false);
            sendWs('room:pause', { paused: false });
            setShopOpen(true);
          }}
          onOpenMenu={handleOpenMenu}
          onSwitchWeapon={(weaponId: WeaponId) => sendWs('player:switchWeapon', { weaponId })}
          onSwitchGadget={(gadgetId: GadgetId) => sendWs('player:switchGadget', { gadgetId })}
        />
      )}

      {/* Armory Shop Modal (B) */}
      {isPlaying && shopOpen && localActor && (
        <ArmoryModal
          actor={localActor}
          onClose={() => {
            setShopOpen(false);
            engineRef.current?.requestPointerLock();
          }}
          onBuyWeapon={(weaponId: WeaponId) => sendWs('shop:buy', { weaponId })}
          onSwitchWeapon={(weaponId: WeaponId) => sendWs('player:switchWeapon', { weaponId })}
          onUpgradeWeapon={(weaponId: WeaponId, stat: UpgradeStat) =>
            sendWs('shop:upgrade', { weaponId, stat })
          }
          onBuyGadget={(gadgetId: GadgetId) => sendWs('shop:buyGadget', { gadgetId })}
          onSwitchGadget={(gadgetId: GadgetId) => sendWs('player:switchGadget', { gadgetId })}
        />
      )}

      {/* ESC Pause, Settings & Exit Menu */}
      {isPlaying && pauseOpen && !shopOpen && (
        <PauseModal
          isSolo={isSolo}
          serverPaused={Boolean(gameState?.paused)}
          settings={gameSettings}
          muted={muted}
          onUpdateSettings={setGameSettings}
          onToggleMute={handleToggleMute}
          onResume={handleResumeGame}
          onOpenArmory={() => {
            setPauseOpen(false);
            sendWs('room:pause', { paused: false });
            setShopOpen(true);
          }}
          onExitGame={handleExitGame}
        />
      )}

      {/* Live Scoreboard Modal (Tab) */}
      {isPlaying && scoreboardOpen && gameState && !shopOpen && !pauseOpen && (
        <ScoreboardModal state={gameState} localPlayerId={playerId} />
      )}

      {/* Match End & Victory Bonus Summary */}
      {matchSummary && (
        <MatchEndModal
          summary={matchSummary}
          localPlayerId={playerId}
          isHost={lobby ? lobby.hostId === playerId : true}
          onRematch={() => sendWs('room:restart')}
          onBackToLobby={() => {
            setMatchSummary(null);
            sendWs('room:leave');
          }}
        />
      )}
    </div>
  );
}
