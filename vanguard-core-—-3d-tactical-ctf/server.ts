import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { GameRoom } from './server/gameRoom.ts';
import type { GadgetId, MapMode, RoomSettings, TeamId, UpgradeStat, WeaponId } from './src/shared/gameConfig.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const app = express();
app.use(express.json());

const rooms = new Map<string, GameRoom>();
const socketSession = new Map<WebSocket, { playerId: string; roomId: string | null }>();

let playerSeq = 1;

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
    .filter((r) => r.hasCapacity() && r.getHumanCount() > 0)
    .map((r) => r.buildLobbyInfo());
  res.json({ rooms: list });
});

async function startServer() {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const playerId = `p-${playerSeq++}-${Math.random().toString(36).slice(2, 6)}`;
    socketSession.set(ws, { playerId, roomId: null });
    ws.send(JSON.stringify({ type: 'session:init', payload: { playerId } }));

    ws.on('message', (raw) => {
      let msg: { type: string; payload?: Record<string, unknown> };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      const session = socketSession.get(ws);
      if (!session) return;

      const leaveCurrentRoom = () => {
        if (session.roomId) {
          const prev = rooms.get(session.roomId);
          prev?.removeHumanPlayer(session.playerId);
          session.roomId = null;
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
        const room = new GameRoom(roomId, session.playerId, settings);
        rooms.set(roomId, room);
        session.roomId = roomId;
        room.addHumanPlayer(session.playerId, name, ws, preferredTeam, useStipend);
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
        if (!room) {
          ws.send(JSON.stringify({ type: 'room:error', payload: { message: '找不到該房間代碼' } }));
          return;
        }
        if (!room.hasCapacity()) {
          ws.send(JSON.stringify({ type: 'room:error', payload: { message: '房間已滿員' } }));
          return;
        }

        leaveCurrentRoom();
        session.roomId = room.roomId;
        room.addHumanPlayer(session.playerId, name, ws, preferredTeam, useStipend);
        ws.send(JSON.stringify({ type: 'room:joined', payload: room.buildLobbyInfo() }));
        if (room.phase === 'playing') {
          ws.send(JSON.stringify({ type: 'match:started', payload: room.buildStateSync(true) }));
        }
        return;
      }

      if (msg.type === 'room:quickplay') {
        leaveCurrentRoom();
        const p = msg.payload ?? {};
        const name = String(p.name ?? '特戰隊員');
        const useStipend = Boolean(p.useStipend);
        const mapMode = p.mapMode as MapMode | undefined;

        let room = Array.from(rooms.values()).find((r) => r.hasCapacity() && r.getHumanCount() > 0);
        if (!room) {
          const roomId = generateRoomId();
          room = new GameRoom(roomId, session.playerId, {
            teamSize: 3,
            durationSec: 300,
            scoreLimit: 5,
            mapMode: mapMode ?? 'nexus',
          });
          rooms.set(roomId, room);
        }
        session.roomId = room.roomId;
        room.addHumanPlayer(session.playerId, name, ws, undefined, useStipend);
        ws.send(JSON.stringify({ type: 'room:joined', payload: room.buildLobbyInfo() }));
        if (room.phase === 'lobby') {
          room.startMatch(session.playerId);
        } else if (room.phase === 'playing') {
          ws.send(JSON.stringify({ type: 'match:started', payload: room.buildStateSync(true) }));
        }
        return;
      }

      if (msg.type === 'room:leave') {
        leaveCurrentRoom();
        ws.send(JSON.stringify({ type: 'room:left' }));
        return;
      }

      const room = session.roomId ? rooms.get(session.roomId) : undefined;
      if (!room) return;

      const payload = msg.payload ?? {};
      switch (msg.type) {
        case 'room:switchTeam':
          room.switchTeam(session.playerId, payload.team as TeamId);
          break;
        case 'room:settings':
          room.updateSettings(session.playerId, payload as Partial<RoomSettings>);
          break;
        case 'room:start':
          room.startMatch(session.playerId);
          break;
        case 'room:restart':
          room.restartMatch(session.playerId);
          break;
        case 'room:pause':
          room.setPaused(session.playerId, Boolean(payload.paused));
          break;
        case 'player:state':
          room.handlePlayerState(
            session.playerId,
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
            session.playerId,
            payload as {
              origin: { x: number; y: number; z: number };
              dir: { x: number; y: number; z: number };
              aiming?: boolean;
            },
          );
          break;
        case 'player:dig':
          room.handlePlayerDig(
            session.playerId,
            payload as {
              origin?: { x: number; y: number; z: number };
              dir?: { x: number; y: number; z: number };
            },
          );
          break;
        case 'player:reload':
          room.handleReload(session.playerId);
          break;
        case 'player:switchWeapon':
          room.handleSwitchWeapon(session.playerId, payload.weaponId as WeaponId);
          break;
        case 'player:switchGadget':
          room.handleSwitchGadget(session.playerId, payload.gadgetId as GadgetId);
          break;
        case 'player:throwGadget':
          room.handleThrowGadget(
            session.playerId,
            payload as {
              origin?: { x: number; y: number; z: number };
              dir?: { x: number; y: number; z: number };
            },
          );
          break;
        case 'shop:buy': {
          const res = room.handleBuyWeapon(session.playerId, payload.weaponId as WeaponId);
          ws.send(JSON.stringify({ type: 'shop:result', payload: res }));
          break;
        }
        case 'shop:buyGadget': {
          const res = room.handleBuyGadget(session.playerId, payload.gadgetId as GadgetId);
          ws.send(JSON.stringify({ type: 'shop:result', payload: res }));
          break;
        }
        case 'shop:upgrade': {
          const res = room.handleUpgradeWeapon(
            session.playerId,
            payload.weaponId as WeaponId,
            payload.stat as UpgradeStat,
          );
          ws.send(JSON.stringify({ type: 'shop:result', payload: res }));
          break;
        }
      }
    });

    ws.on('close', () => {
      const session = socketSession.get(ws);
      if (session?.roomId) {
        rooms.get(session.roomId)?.removeHumanPlayer(session.playerId);
      }
      socketSession.delete(ws);
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
