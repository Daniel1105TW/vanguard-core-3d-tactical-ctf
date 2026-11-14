import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { GameRoom } from './server/gameRoom.ts';
import { GAME_MODES } from './src/shared/gameConfig.ts';
import type { GadgetId, GameMode, MapMode, RoomSettings, TeamId, UpgradeStat, WeaponId } from './src/shared/gameConfig.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

interface ClientSession {
  playerId: string;
  roomId: string | null;
  token: string;
  ws: WebSocket | null;
  isAlive: boolean;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, GameRoom>();
const socketSession = new Map<WebSocket, ClientSession>();
const tokenToSession = new Map<string, ClientSession>();

let playerSeq = 1;

function getLanUrls(): string[] {
  const urls: string[] = [];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const net of list) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`http://${net.address}:${PORT}`);
      }
    }
  }
  return urls;
}

function getSharedUrlFromAppUrl(appUrl: string): string {
  if (!appUrl) return '';
  if (appUrl.includes('ais-dev-')) {
    return appUrl.replace('ais-dev-', 'ais-pre-');
  }
  return appUrl;
}

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomId() : code;
}

// Cleanup abandoned rooms every 30s
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms.entries()) {
    if (room.emptySince && now - room.emptySince > 60_000) {
      room.stopLoop();
      rooms.delete(id);
    }
  }
}, 30_000);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, activeRooms: rooms.size });
});

app.get('/api/rooms', (_req, res) => {
  const list = Array.from(rooms.values())
    .filter((r) => r.hasCapacity() && r.getHumanCount() > 0 && r.phase !== 'ended')
    .map((r) => r.buildLobbyInfo());
  res.json({ rooms: list });
});

app.get('/api/server-info', (_req, res) => {
  const appUrl = (process.env.APP_URL || '').trim();
  res.json({
    appUrl,
    sharedUrl: getSharedUrlFromAppUrl(appUrl),
    lanUrls: getLanUrls(),
  });
});

async function startServer() {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Keep WebSocket connections alive across reverse proxies / Cloud Run / mobile networks
  const heartbeatInterval = setInterval(() => {
    for (const [ws, session] of socketSession.entries()) {
      if (!session.isAlive) {
        ws.terminate();
        continue;
      }
      session.isAlive = false;
      try {
        ws.ping();
      } catch {
        // ignore closed sockets
      }
    }
  }, 20_000);
  wss.on('close', () => clearInterval(heartbeatInterval));

  wss.on('connection', (ws, req) => {
    let requestedToken = '';
    try {
      const url = new URL(req.url || '/ws', 'http://localhost');
      requestedToken = (url.searchParams.get('token') || '').trim();
    } catch {
      requestedToken = '';
    }

    let session = requestedToken ? tokenToSession.get(requestedToken) : undefined;
    let resumed = false;

    if (session) {
      if (session.disconnectTimer) {
        clearTimeout(session.disconnectTimer);
        session.disconnectTimer = null;
      }
      if (session.ws && session.ws !== ws) {
        socketSession.delete(session.ws);
        try {
          session.ws.close();
        } catch {
          // ignore
        }
      }
      session.ws = ws;
      session.isAlive = true;

      if (session.roomId) {
        const room = rooms.get(session.roomId);
        if (room && room.reattachPlayerSocket(session.playerId, ws)) {
          resumed = true;
        } else {
          session.roomId = null;
        }
      }
    } else {
      const playerId = `p-${playerSeq++}-${Math.random().toString(36).slice(2, 6)}`;
      const token = `${playerId}-${Math.random().toString(36).slice(2, 10)}`;
      session = {
        playerId,
        roomId: null,
        token,
        ws,
        isAlive: true,
        disconnectTimer: null,
      };
      tokenToSession.set(token, session);
    }

    socketSession.set(ws, session);
    ws.on('pong', () => {
      session!.isAlive = true;
    });

    ws.send(
      JSON.stringify({
        type: 'session:init',
        payload: { playerId: session.playerId, sessionToken: session.token, resumed },
      }),
    );

    if (resumed && session.roomId) {
      const room = rooms.get(session.roomId);
      if (room) {
        ws.send(JSON.stringify({ type: 'room:joined', payload: room.buildLobbyInfo() }));
        if (room.phase === 'playing') {
          ws.send(
            JSON.stringify({
              type: 'match:started',
              payload: room.buildStateSync(true, room.getActorTeam(session.playerId)),
            }),
          );
        }
      }
    }

    ws.on('message', (raw) => {
      session!.isAlive = true;
      let msg: { type: string; payload?: Record<string, unknown> };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      const activeSession = socketSession.get(ws);
      if (!activeSession) return;

      const leaveCurrentRoom = () => {
        if (activeSession.roomId) {
          const prev = rooms.get(activeSession.roomId);
          prev?.removeHumanPlayer(activeSession.playerId);
          activeSession.roomId = null;
        }
      };

      if (msg.type === 'room:create') {
        leaveCurrentRoom();
        const p = msg.payload ?? {};
        const name = String(p.name ?? '特戰隊員');
        const settings = p.settings as Partial<RoomSettings> | undefined;
        const preferredTeam = p.team as TeamId | undefined;
        const useStipend = Boolean(p.useStipend);

        const roomId = generateRoomId();
        const room = new GameRoom(roomId, activeSession.playerId, settings);
        rooms.set(roomId, room);
        activeSession.roomId = roomId;
        room.addHumanPlayer(activeSession.playerId, name, ws, preferredTeam, useStipend);
        ws.send(JSON.stringify({ type: 'room:joined', payload: room.buildLobbyInfo() }));
        return;
      }

      if (msg.type === 'room:join') {
        const p = msg.payload ?? {};
        const targetId = String(p.roomId ?? '').trim().toUpperCase();
        const name = String(p.name ?? '特戰隊員');
        const preferredTeam = p.team as TeamId | undefined;
        const useStipend = Boolean(p.useStipend);

        const room = rooms.get(targetId);
        if (!room || room.phase === 'ended') {
          ws.send(JSON.stringify({ type: 'room:error', payload: { message: '找不到該房間代碼（可能已結束或位於不同網址）' } }));
          return;
        }
        if (!room.hasCapacity()) {
          ws.send(JSON.stringify({ type: 'room:error', payload: { message: '房間已滿員' } }));
          return;
        }

        leaveCurrentRoom();
        activeSession.roomId = room.roomId;
        room.addHumanPlayer(activeSession.playerId, name, ws, preferredTeam, useStipend);
        ws.send(JSON.stringify({ type: 'room:joined', payload: room.buildLobbyInfo() }));
        if (room.phase === 'playing') {
          ws.send(
            JSON.stringify({
              type: 'match:started',
              payload: room.buildStateSync(true, room.getActorTeam(activeSession.playerId)),
            }),
          );
        }
        return;
      }

      if (msg.type === 'room:quickplay') {
        leaveCurrentRoom();
        const p = msg.payload ?? {};
        const name = String(p.name ?? '特戰隊員');
        const useStipend = Boolean(p.useStipend);
        const mapMode = p.mapMode as MapMode | undefined;
        const rawGameMode = p.gameMode as GameMode | undefined;
        const gameMode: GameMode =
          rawGameMode === 'tdm' || rawGameMode === 'dom' || rawGameMode === 'ctf'
            ? rawGameMode
            : 'ctf';
        const modeInfo = GAME_MODES.find((m) => m.id === gameMode) ?? GAME_MODES[0];

        let room = Array.from(rooms.values()).find(
          (r) =>
            r.hasCapacity() &&
            r.getHumanCount() > 0 &&
            r.phase !== 'ended' &&
            r.settings.gameMode === gameMode,
        );
        if (!room) {
          const roomId = generateRoomId();
          room = new GameRoom(roomId, activeSession.playerId, {
            teamSize: 3,
            durationSec: 300,
            scoreLimit: modeInfo.defaultScoreLimit,
            mapMode: mapMode ?? 'nexus',
            gameMode,
          });
          rooms.set(roomId, room);
        }
        activeSession.roomId = room.roomId;
        room.addHumanPlayer(activeSession.playerId, name, ws, undefined, useStipend);
        ws.send(JSON.stringify({ type: 'room:joined', payload: room.buildLobbyInfo() }));
        if (room.phase === 'lobby') {
          room.startMatch(activeSession.playerId);
        } else if (room.phase === 'playing') {
          ws.send(
            JSON.stringify({
              type: 'match:started',
              payload: room.buildStateSync(true, room.getActorTeam(activeSession.playerId)),
            }),
          );
        }
        return;
      }

      if (msg.type === 'room:leave') {
        leaveCurrentRoom();
        ws.send(JSON.stringify({ type: 'room:left' }));
        return;
      }

      const room = activeSession.roomId ? rooms.get(activeSession.roomId) : undefined;
      if (!room) return;

      const payload = msg.payload ?? {};
      switch (msg.type) {
        case 'room:switchTeam':
          room.switchTeam(activeSession.playerId, payload.team as TeamId);
          break;
        case 'room:settings':
          room.updateSettings(activeSession.playerId, payload as Partial<RoomSettings>);
          break;
        case 'room:start':
          room.startMatch(activeSession.playerId);
          break;
        case 'room:restart':
          room.restartMatch(activeSession.playerId);
          break;
        case 'room:pause':
          room.setPaused(activeSession.playerId, Boolean(payload.paused));
          break;
        case 'player:state':
          room.handlePlayerState(
            activeSession.playerId,
            payload as {
              x: number;
              y: number;
              z: number;
              yaw: number;
              pitch: number;
              crouching?: boolean;
            },
          );
          break;
        case 'player:shoot':
          room.handlePlayerShoot(
            activeSession.playerId,
            payload as {
              origin: { x: number; y: number; z: number };
              dir: { x: number; y: number; z: number };
              aiming?: boolean;
            },
          );
          break;
        case 'player:dig':
          room.handlePlayerDig(
            activeSession.playerId,
            payload as {
              origin?: { x: number; y: number; z: number };
              dir?: { x: number; y: number; z: number };
            },
          );
          break;
        case 'player:reload':
          room.handleReload(activeSession.playerId);
          break;
        case 'player:switchWeapon':
          room.handleSwitchWeapon(activeSession.playerId, payload.weaponId as WeaponId);
          break;
        case 'player:toggleDevMode':
          room.handleToggleDevMode(activeSession.playerId);
          break;
        case 'player:switchGadget':
          room.handleSwitchGadget(activeSession.playerId, payload.gadgetId as GadgetId);
          break;
        case 'player:throwGadget':
          room.handleThrowGadget(
            activeSession.playerId,
            payload as {
              origin?: { x: number; y: number; z: number };
              dir?: { x: number; y: number; z: number };
            },
          );
          break;
        case 'player:ping':
          room.handlePlayerPing(
            activeSession.playerId,
            payload as {
              origin?: { x: number; y: number; z: number };
              dir?: { x: number; y: number; z: number };
            },
          );
          break;
        case 'chat:team':
          room.handleTeamChat(activeSession.playerId, String(payload.text ?? ''));
          break;
        case 'shop:buy': {
          const res = room.handleBuyWeapon(activeSession.playerId, payload.weaponId as WeaponId);
          ws.send(JSON.stringify({ type: 'shop:result', payload: res }));
          break;
        }
        case 'shop:buyGadget': {
          const res = room.handleBuyGadget(activeSession.playerId, payload.gadgetId as GadgetId);
          ws.send(JSON.stringify({ type: 'shop:result', payload: res }));
          break;
        }
        case 'shop:upgrade': {
          const res = room.handleUpgradeWeapon(
            activeSession.playerId,
            payload.weaponId as WeaponId,
            payload.stat as UpgradeStat,
          );
          ws.send(JSON.stringify({ type: 'shop:result', payload: res }));
          break;
        }
      }
    });

    ws.on('close', () => {
      const closedSession = socketSession.get(ws);
      socketSession.delete(ws);
      if (!closedSession) return;
      if (closedSession.ws === ws) {
        closedSession.ws = null;
        closedSession.disconnectTimer = setTimeout(() => {
          if (closedSession.ws === null) {
            if (closedSession.roomId) {
              rooms.get(closedSession.roomId)?.removeHumanPlayer(closedSession.playerId);
              closedSession.roomId = null;
            }
            tokenToSession.delete(closedSession.token);
          }
        }, 20_000);
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Vanguard Core CTF server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
