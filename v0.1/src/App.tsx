import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_MAP_LAYOUT, ECONOMY, generateMapLayout } from './shared/gameConfig.ts';
import type {
  CrosshairColor,
  CrosshairSettings,
  CrosshairStyle,
  DamageIndicatorEvent,
  DigUpdateEvent,
  GadgetFxEvent,
  GadgetId,
  GameMode,
  KillFeedEvent,
  MapLayout,
  MapMode,
  MatchEndSummary,
  RoomLobbyInfo,
  RoomSettings,
  StateSyncPayload,
  TacticalPing,
  TeamChatMessage,
  TeamId,
  TracerEvent,
  UpgradeStat,
  WeaponId,
} from './shared/gameConfig.ts';
import { ArenaEngine } from './three/ArenaEngine.ts';
import type { ArenaPoseState, HudProjection, SpectateInfo, VitalsState } from './three/ArenaEngine.ts';
import { soundEngine } from './audio/soundEngine.ts';
import { LobbyScreen } from './components/LobbyScreen.tsx';
import type { ServerNetworkInfo } from './components/LobbyScreen.tsx';
import { GameHUD } from './components/GameHUD.tsx';
import { ArmoryModal } from './components/ArmoryModal.tsx';
import { ScoreboardModal } from './components/ScoreboardModal.tsx';
import { MatchEndModal } from './components/MatchEndModal.tsx';
import { PauseModal } from './components/PauseModal.tsx';
import type { GameSettings } from './components/PauseModal.tsx';

const DEFAULT_CROSSHAIR: CrosshairSettings = {
  style: 'cross',
  color: 'white',
  size: 1.0,
  showDot: true,
};

const DEFAULT_SETTINGS: GameSettings = {
  sensitivity: 1.0,
  fov: 76,
  volume: 1.0,
  crosshair: DEFAULT_CROSSHAIR,
};

const VALID_STYLES: CrosshairStyle[] = ['cross', 'dot', 'circle', 'tactical'];
const VALID_COLORS: CrosshairColor[] = ['white', 'cyan', 'emerald', 'amber'];

function loadSavedSettings(): GameSettings {
  try {
    const raw = localStorage.getItem('vc_settings');
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    const rawCh = parsed.crosshair as Partial<CrosshairSettings> | undefined;
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
      crosshair: {
        style: rawCh?.style && VALID_STYLES.includes(rawCh.style) ? rawCh.style : DEFAULT_CROSSHAIR.style,
        color: rawCh?.color && VALID_COLORS.includes(rawCh.color) ? rawCh.color : DEFAULT_CROSSHAIR.color,
        size:
          typeof rawCh?.size === 'number' && Number.isFinite(rawCh.size)
            ? Math.min(1.6, Math.max(0.7, rawCh.size))
            : DEFAULT_CROSSHAIR.size,
        showDot: typeof rawCh?.showDot === 'boolean' ? rawCh.showDot : DEFAULT_CROSSHAIR.showDot,
      },
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
  const chatOpenRef = useRef<boolean>(false);
  const chatTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const isPlayingRef = useRef<boolean>(false);
  const isSoloRef = useRef<boolean>(true);
  const aliveRef = useRef<boolean>(true);
  const devModeRef = useRef<boolean>(false);
  const touchModeRef = useRef<boolean>(false);
  const autoJoinAttemptedRef = useRef<boolean>(false);
  const matchSummaryRef = useRef<MatchEndSummary | null>(null);
  const rawDamageHitsRef = useRef<Array<{ id: string; angleDeg: number; expiresAt: number }>>([]);
  const streakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [lobby, setLobby] = useState<RoomLobbyInfo | null>(null);
  const [gameState, setGameState] = useState<StateSyncPayload | null>(null);
  const [matchSummary, setMatchSummary] = useState<MatchEndSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [pointerLocked, setPointerLocked] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
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
  const [damageIndicators, setDamageIndicators] = useState<Array<{ id: string; angleDeg: number; ratio: number }>>([]);
  const [streakBanner, setStreakBanner] = useState<{ label: string; count: number } | null>(null);
  const [spectateInfo, setSpectateInfo] = useState<SpectateInfo | null>(null);
  const [feed, setFeed] = useState<KillFeedEvent[]>([]);
  const [chatMessages, setChatMessages] = useState<TeamChatMessage[]>([]);
  const [mapLayout, setMapLayout] = useState<MapLayout>(DEFAULT_MAP_LAYOUT);
  const [digVersion, setDigVersion] = useState(0);
  const [projection, setProjection] = useState<HudProjection>({
    enemyFlagScreen: null,
    homeBaseScreen: null,
    controlZoneScreen: null,
    pingsScreen: [],
  });
  const [vitals, setVitals] = useState<VitalsState>({
    stamina: 100,
    maxStamina: 100,
    sprinting: false,
    exhausted: false,
    crosshairSpread: 0,
    hoverEnemy: false,
  });
  const [insideSmoke, setInsideSmoke] = useState(false);
  const [muted, setMuted] = useState(false);
  const [touchMode, setTouchMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      navigator.maxTouchPoints > 0 &&
      window.matchMedia('(pointer: coarse)').matches
    );
  });
  const [serverInfo, setServerInfo] = useState<ServerNetworkInfo>({
    appUrl: '',
    sharedUrl: '',
    lanUrls: [],
  });
  const [commanderVault, setCommanderVault] = useState<number>(() => {
    const saved = Number(localStorage.getItem('vc_vault') || '0');
    return Number.isFinite(saved) ? saved : 0;
  });

  useEffect(() => {
    touchModeRef.current = touchMode;
    engineRef.current?.setTouchMode(touchMode);
  }, [touchMode]);

  useEffect(() => {
    const onFirstTouch = () => {
      setTouchMode(true);
    };
    window.addEventListener('touchstart', onFirstTouch, { passive: true, once: true });
    return () => window.removeEventListener('touchstart', onFirstTouch);
  }, []);

  useEffect(() => {
    fetch('/api/server-info')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ServerNetworkInfo | null) => {
        if (data && typeof data.sharedUrl === 'string') {
          setServerInfo(data);
        }
      })
      .catch(() => {
        // Fallback to window.location.origin inside LobbyScreen
      });
  }, []);

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
    if (shopOpen) setChatOpen(false);
  }, [shopOpen]);

  useEffect(() => {
    pauseOpenRef.current = pauseOpen;
    if (pauseOpen) setChatOpen(false);
  }, [pauseOpen]);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
    engineRef.current?.setChatOpen(chatOpen);
  }, [chatOpen]);

  useEffect(() => {
    engineRef.current?.setPaused(Boolean(gameState?.paused));
  }, [gameState?.paused]);

  // Smoothly fade directional damage indicators while active
  useEffect(() => {
    if (damageIndicators.length === 0) return;
    const timer = setInterval(() => {
      const now = performance.now();
      const kept = rawDamageHitsRef.current.filter((h) => h.expiresAt > now);
      rawDamageHitsRef.current = kept;
      setDamageIndicators(
        kept.map((h) => ({
          id: h.id,
          angleDeg: h.angleDeg,
          ratio: Math.max(0, Math.min(1, (h.expiresAt - now) / 1150)),
        })),
      );
    }, 50);
    return () => clearInterval(timer);
  }, [damageIndicators.length]);

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
          !touchModeRef.current &&
          !chatOpenRef.current &&
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
      onPing: (origin, dir) => sendWs('player:ping', { origin, dir }),
      onReload: () => sendWs('player:reload'),
      onSwitchWeapon: (weaponId) => sendWs('player:switchWeapon', { weaponId }),
      onThrowGadget: (origin, dir) => sendWs('player:throwGadget', { origin, dir }),
      onSwitchGadget: (gadgetId) => sendWs('player:switchGadget', { gadgetId }),
      onSmokeStateChange: (inside) => setInsideSmoke(inside),
      onStateReport: (pos) => sendWs('player:state', pos),
      onOpenShopKey: () => setShopOpen((prev) => !prev),
      onOpenChatKey: () => {
        if (!shopOpenRef.current && !pauseOpenRef.current) {
          chatOpenRef.current = true;
          engineRef.current?.setChatOpen(true);
          setChatOpen(true);
        }
      },
      onScoreboardKey: (open) => setScoreboardOpen(open),
      onEscapeKey: () => {
        if (chatOpenRef.current) {
          setChatOpen(false);
          engineRef.current?.requestPointerLock();
          return;
        }
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
      onVitalsUpdate: (nextVitals) => setVitals(nextVitals),
      onSpectateChange: (info) => setSpectateInfo(info),
      onToggleDevMode: () => sendWs('player:toggleDevMode'),
    });

    engine.applySettings({
      sensitivityScale: gameSettings.sensitivity,
      baseFov: gameSettings.fov,
    });
    engine.setTouchMode(touchModeRef.current);
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
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let hitTimer: ReturnType<typeof setTimeout> | null = null;
    let badgeTimer: ReturnType<typeof setTimeout> | null = null;
    let dmgTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const savedToken = sessionStorage.getItem('vc_ws_token');
      const wsUrl = savedToken
        ? `${proto}//${window.location.host}/ws?token=${encodeURIComponent(savedToken)}`
        : `${proto}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setErrorMsg(null);
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 20000);
      };

      ws.onclose = () => {
        setConnected(false);
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
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
          case 'pong':
            break;
          case 'session:init': {
            const p = msg.payload as {
              playerId: string;
              sessionToken?: string;
              resumed?: boolean;
            };
            playerIdRef.current = p.playerId;
            setPlayerId(p.playerId);
            if (p.sessionToken) {
              sessionStorage.setItem('vc_ws_token', p.sessionToken);
            }
            if (!p.resumed && !autoJoinAttemptedRef.current) {
              const roomParam = new URLSearchParams(window.location.search).get('room');
              if (roomParam && roomParam.trim().length >= 4) {
                autoJoinAttemptedRef.current = true;
                const savedCallsign = (localStorage.getItem('vc_callsign') || '').trim() || '特戰隊員';
                ws.send(
                  JSON.stringify({
                    type: 'room:join',
                    payload: {
                      roomId: roomParam.trim().toUpperCase(),
                      name: savedCallsign,
                      useStipend: false,
                    },
                  }),
                );
              }
            }
            break;
          }
          case 'room:joined':
          case 'room:updated': {
            const info = msg.payload as RoomLobbyInfo;
            setLobby(info);
            setErrorMsg(null);
            if (msg.type === 'room:joined' && window.location.search.includes('room=')) {
              const url = new URL(window.location.href);
              url.searchParams.delete('room');
              window.history.replaceState({}, '', url.pathname + url.search);
            }
            break;
          }
          case 'room:left': {
            for (const t of chatTimersRef.current) clearTimeout(t);
            chatTimersRef.current.clear();
            if (streakTimerRef.current) clearTimeout(streakTimerRef.current);
            rawDamageHitsRef.current = [];
            setDamageIndicators([]);
            setStreakBanner(null);
            setSpectateInfo(null);
            setLobby(null);
            setGameState(null);
            setMatchSummary(null);
            setChatMessages([]);
            setChatOpen(false);
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
            for (const t of chatTimersRef.current) clearTimeout(t);
            chatTimersRef.current.clear();
            if (streakTimerRef.current) clearTimeout(streakTimerRef.current);
            rawDamageHitsRef.current = [];
            setDamageIndicators([]);
            setStreakBanner(null);
            setSpectateInfo(null);
            setMatchSummary(null);
            setFeed([]);
            setChatMessages([]);
            setChatOpen(false);
            setShopOpen(false);
            setPauseOpen(false);
            setInsideSmoke(false);
            setVitals({
              stamina: 100,
              maxStamina: 100,
              sprinting: false,
              exhausted: false,
              crosshairSpread: 0,
              hoverEnemy: false,
            });
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
          case 'ping:added': {
            const ping = msg.payload as TacticalPing;
            engineRef.current?.addPingInstant(ping);
            soundEngine.playPing(ping.kind);
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
          case 'combat:hitdir': {
            const ev = msg.payload as DamageIndicatorEvent;
            if (!devModeRef.current && ev.damage > 0) {
              const angleDeg = engineRef.current?.computeDamageAngleDeg(ev.sourcePos) ?? 0;
              const now = performance.now();
              const id = `dmg-${now}-${Math.random().toString(36).slice(2, 6)}`;
              const nextRaw = [
                ...rawDamageHitsRef.current.filter((h) => h.expiresAt > now).slice(-4),
                { id, angleDeg, expiresAt: now + 1150 },
              ];
              rawDamageHitsRef.current = nextRaw;
              setDamageIndicators(
                nextRaw.map((h) => ({
                  id: h.id,
                  angleDeg: h.angleDeg,
                  ratio: Math.max(0, Math.min(1, (h.expiresAt - now) / 1150)),
                })),
              );
              engineRef.current?.triggerDamageFeedback(Boolean(ev.headshot));
              setDamageFlash(true);
              if (dmgTimer) clearTimeout(dmgTimer);
              dmgTimer = setTimeout(() => setDamageFlash(false), 180);
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

              if (isKill && (tracer.streakCount ?? 0) >= 2) {
                const count = tracer.streakCount ?? 2;
                const label =
                  count === 2
                    ? '雙殺 DOUBLE KILL'
                    : count === 3
                      ? '三連殺 TRIPLE KILL'
                      : count === 4
                        ? '四殺 QUADRA KILL'
                        : `${count} 連殺 主宰戰場！`;
                setStreakBanner({ label, count });
                soundEngine.playKillStreak(count);
                if (streakTimerRef.current) clearTimeout(streakTimerRef.current);
                streakTimerRef.current = setTimeout(() => setStreakBanner(null), 2200);
              }
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
            } else if (item.type === 'zone_capture') {
              soundEngine.playZoneCapture(item.actorTeam === localTeamRef.current);
            }
            break;
          }
          case 'chat:message': {
            const chatItem = msg.payload as TeamChatMessage;
            setChatMessages((prev) =>
              prev.some((m) => m.id === chatItem.id) ? prev : [...prev, chatItem].slice(-5),
            );
            soundEngine.playChat();
            const timer = setTimeout(() => {
              chatTimersRef.current.delete(timer);
              setChatMessages((prev) => prev.filter((m) => m.id !== chatItem.id));
            }, 6500);
            chatTimersRef.current.add(timer);
            break;
          }
          case 'shop:result': {
            const res = msg.payload as { ok: boolean; error?: string };
            if (res.ok) soundEngine.playPurchase();
            break;
          }
          case 'match:ended': {
            const summary = msg.payload as MatchEndSummary;
            for (const t of chatTimersRef.current) clearTimeout(t);
            chatTimersRef.current.clear();
            if (streakTimerRef.current) clearTimeout(streakTimerRef.current);
            rawDamageHitsRef.current = [];
            setDamageIndicators([]);
            setStreakBanner(null);
            setSpectateInfo(null);
            setMatchSummary(summary);
            setChatMessages([]);
            setChatOpen(false);
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
      if (pingTimer) clearInterval(pingTimer);
      if (hitTimer) clearTimeout(hitTimer);
      if (badgeTimer) clearTimeout(badgeTimer);
      if (dmgTimer) clearTimeout(dmgTimer);
      if (streakTimerRef.current) clearTimeout(streakTimerRef.current);
      for (const t of chatTimersRef.current) clearTimeout(t);
      chatTimersRef.current.clear();
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

  const handleQuickPlay = (name: string, useStipend: boolean, mapMode: MapMode, gameMode: GameMode) => {
    soundEngine.unlock();
    const applied = handleSpendStipend(useStipend);
    sendWs('room:quickplay', { name, useStipend: applied, mapMode, gameMode });
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
  devModeRef.current = Boolean(localActor?.devMode);
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
          serverInfo={serverInfo}
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
          touchMode={touchMode}
          engine={engineRef.current}
          shopOpen={shopOpen}
          pauseOpen={pauseOpen}
          pose={pose}
          vitals={vitals}
          crosshairSettings={gameSettings.crosshair}
          insideSmoke={insideSmoke}
          hitmarker={hitmarker}
          hitBadge={hitBadge}
          damageFlash={damageFlash}
          feed={feed}
          chatMessages={chatMessages}
          chatOpen={chatOpen}
          projection={projection}
          spectateInfo={spectateInfo}
          damageIndicators={damageIndicators}
          streakBanner={streakBanner}
          mapLayout={mapLayout}
          digHp={engineRef.current?.getDigHpSnapshot()}
          digVersion={digVersion}
          muted={muted}
          onToggleMute={handleToggleMute}
          onOpenShop={() => {
            setPauseOpen(false);
            setChatOpen(false);
            sendWs('room:pause', { paused: false });
            setShopOpen(true);
          }}
          onOpenMenu={handleOpenMenu}
          onOpenChat={() => {
            if (!shopOpen && !pauseOpen) {
              chatOpenRef.current = true;
              engineRef.current?.setChatOpen(true);
              setChatOpen(true);
            }
          }}
          onCloseChat={(relockPointer = false) => {
            chatOpenRef.current = false;
            engineRef.current?.setChatOpen(false);
            setChatOpen(false);
            if (relockPointer) {
              engineRef.current?.requestPointerLock();
            }
          }}
          onSendChat={(text: string) => {
            const cleaned = text.trim();
            if (cleaned) {
              sendWs('chat:team', { text: cleaned });
            }
          }}
          onSwitchWeapon={(weaponId: WeaponId) => sendWs('player:switchWeapon', { weaponId })}
          onSwitchGadget={(gadgetId: GadgetId) => sendWs('player:switchGadget', { gadgetId })}
          onCycleSpectate={() => engineRef.current?.cycleSpectateTarget(1)}
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
