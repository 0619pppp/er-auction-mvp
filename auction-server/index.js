import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors({ origin: true }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ===== 단일방 설정 =====
const DEFAULT_CODE = "MAIN";
const rooms = new Map();

const DEFAULT_SETTINGS = {
  maxPoints: 500,
  bidStep: 10,
  pickCount: 2,
  lotTimeSec: 20,
  onRaiseResetSec: 10,
  previewSec: 30,
};

function createRoom(code = DEFAULT_CODE, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const state = {
    code,
    settings: s,
    leaders: {},
    playersQueue: [],
    currentLot: null,
    started: false,
  };
  rooms.set(code, state);
  return state;
}
function getRoom() {
  if (!rooms.has(DEFAULT_CODE)) createRoom();
  return rooms.get(DEFAULT_CODE);
}

// ===== Helper =====
function publish(state) {
  io.emit("state", sanitize(state));
}
function sanitize(state) {
  return {
    leaders: state.leaders,
    playersQueue: state.playersQueue,
    currentLot: state.currentLot,
    started: state.started,
  };
}

// ===== Auction Logic =====
function nextLot(state) {
  if (!state.playersQueue.length) {
    state.started = false;
    io.emit("system", { text: "경매 종료" });
    publish(state);
    return;
  }
  const player = state.playersQueue.shift();
  state.currentLot = {
    player,
    highestBid: 0,
    highestBidder: null,
    endsAt: Date.now() + state.settings.previewSec * 1000,
    phase: "preview",
  };
  publish(state);

  setTimeout(() => {
    state.currentLot.phase = "bidding";
    state.currentLot.endsAt = Date.now() + state.settings.lotTimeSec * 1000;
    publish(state);
    const timer = setInterval(() => {
      if (!state.currentLot) return clearInterval(timer);
      const left = state.currentLot.endsAt - Date.now();
      if (left <= 0) {
        clearInterval(timer);
        finishLot(state);
      }
    }, 500);
  }, state.settings.previewSec * 1000);
}

function finishLot(state) {
  const lot = state.currentLot;
  if (!lot) return;
  if (lot.highestBidder) {
    const leader = state.leaders[lot.highestBidder.id];
    leader.pointsLeft -= lot.highestBid;
    leader.picks.push(lot.player);
    io.emit("system", {
      text: `${leader.name} 님이 ${lot.player.name} 낙찰 (${lot.highestBid}pt)`,
    });
  } else {
    io.emit("system", { text: `${lot.player.name} 유찰` });
  }
  state.currentLot = null;
  publish(state);
  nextLot(state);
}

// ===== Socket =====
io.on("connection", (socket) => {
  const state = getRoom();

  socket.on("join_room", ({ role, name, playerInfo }) => {
    socket.join(DEFAULT_CODE);
    if (role === "leader") {
      state.leaders[socket.id] = {
        id: socket.id,
        name,
        pointsLeft: state.settings.maxPoints,
        picks: [],
      };
      io.emit("system", { text: `팀장 ${name} 입장` });
    } else if (role === "player") {
      state.playersQueue.push({
        id: socket.id,
        name: playerInfo?.name || name,
        characters: playerInfo?.characters || [],
        motto: playerInfo?.motto || "",
      });
      io.emit("system", { text: `플레이어 ${name} 등록` });
    }
    publish(state);
  });

  socket.on("start_auction", () => {
    if (!state.started) {
      state.started = true;
      io.emit("system", { text: "경매 시작" });
      nextLot(state);
    }
  });

  socket.on("bid", ({ amount }) => {
    const lot = state.currentLot;
    if (!lot || lot.phase !== "bidding") return;
    const leader = state.leaders[socket.id];
    if (!leader) return;
    if (amount <= lot.highestBid) return;
    if (amount > leader.pointsLeft) return;
    lot.highestBid = amount;
    lot.highestBidder = { id: socket.id, name: leader.name };
    lot.endsAt = Date.now() + state.settings.onRaiseResetSec * 1000;
    io.emit("system", { text: `${leader.name} → ${amount}pt` });
    publish(state);
  });

  socket.on("disconnect", () => {
    delete state.leaders[socket.id];
    state.playersQueue = state.playersQueue.filter((p) => p.id !== socket.id);
    publish(state);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () =>
  console.log(`Auction server running on http://localhost:${PORT}`)
);
