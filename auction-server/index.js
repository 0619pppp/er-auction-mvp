import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors({ origin: true }));

// 헬스 체크
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.get("/", (_req, res) => res.type("text").send("OK"));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ===== 단일 방 =====
const DEFAULT_CODE = "MAIN";
const rooms = new Map();

const DEFAULT_SETTINGS = {
  maxPoints: 500,
  bidStep: 10,
  pickCount: 2,
  lotTimeSec: 20,
  onRaiseResetSec: 10,
  previewSec: 30,
  minReservePerSlot: 0
};

function createRoom(code = DEFAULT_CODE, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const state = {
    code,
    settings: s,
    leaders: {},          // {socketId:{id,name,pointsLeft,picks:[]}}
    playersQueue: [],     // [{id,name,characters,motto}]
    currentLot: null,     // {player,highestBid,highestBidder,endsAt,phase,totalSec,lastBidderId,timer}
    started: false,
    logs: []
  };
  rooms.set(code, state);
  return state;
}
function getRoom() {
  if (!rooms.has(DEFAULT_CODE)) createRoom();
  return rooms.get(DEFAULT_CODE);
}

function sanitize(state) {
  return {
    code: state.code,
    leaders: state.leaders,
    playersQueue: state.playersQueue,
    currentLot: state.currentLot
      ? {
          player: state.currentLot.player,
          highestBid: state.currentLot.highestBid,
          highestBidder: state.currentLot.highestBidder
            ? { id: state.currentLot.highestBidder.id, name: state.currentLot.highestBidder.name }
            : null,
          endsAt: state.currentLot.endsAt,
          phase: state.currentLot.phase,
          totalSec: state.currentLot.totalSec || 0
        }
      : null,
    started: state.started
  };
}
const publish = (state) => io.emit("state", sanitize(state));
const sys = (text) => io.emit("system", { t: Date.now(), text });

function clearTimer(state){
  if (state?.currentLot?.timer) { clearInterval(state.currentLot.timer); state.currentLot.timer = null; }
}
function startTimer(state, seconds) {
  clearTimer(state);
  state.currentLot.totalSec = seconds;
  state.currentLot.endsAt = Date.now() + seconds * 1000;
  state.currentLot.timer = setInterval(() => {
    if (!state.currentLot) return clearTimer(state);
    if (Date.now() >= state.currentLot.endsAt) {
      clearTimer(state);
      if (state.currentLot.phase === "preview") startBidding(state);
      else finishCurrentLot(state);
    } else {
      publish(state);
    }
  }, 250);
}

function startPreview(state){
  state.currentLot.phase = "preview";
  state.currentLot.lastBidderId = null; // 연속호가 리셋
  sys(`소개 시작: ${state.currentLot.player.name}`);
  startTimer(state, state.settings.previewSec);
  publish(state);
}
function startBidding(state){
  state.currentLot.phase = "bidding";
  sys("호가 시작");
  startTimer(state, state.settings.lotTimeSec);
  publish(state);
}
function proceedNextLot(state){
  if (!state.playersQueue.length) {
    state.started = false;
    sys("경매 종료");
    publish(state);
    return;
  }
  const player = state.playersQueue.shift();
  state.currentLot = {
    player,
    highestBid: 0,
    highestBidder: null,
    endsAt: null,
    phase: "preview",
    totalSec: 0,
    lastBidderId: null,
    timer: null
  };
  startPreview(state);
}

function finishCurrentLot(state){
  const lot = state.currentLot;
  if (!lot) return;
  if (lot.highestBidder) {
    const leader = state.leaders[lot.highestBidder.id];
    leader.pointsLeft -= lot.highestBid;
    leader.picks.push(lot.player);
    sys(`낙찰: ${leader.name} ← ${lot.player.name} @ ${lot.highestBid}pt`);
  } else {
    sys(`유찰: ${lot.player.name}`);
    state.playersQueue.push(lot.player); // 원하면 주석 처리
  }
  state.currentLot = null;
  publish(state);
  proceedNextLot(state);
}

function canBid(state, leaderId, amount){
  const leader = state.leaders[leaderId];
  if (!leader) return [false, "팀장이 아님"];
  if (!state.currentLot) return [false, "현재 경매 없음"];
  if (state.currentLot.phase !== "bidding") return [false, "아직 호가 시작 전입니다."];
  if (state.currentLot.lastBidderId === leaderId) return [false, "연속 호가 불가"];
  if (amount < state.currentLot.highestBid + state.settings.bidStep) return [false, "입찰 단위 미달"];
  const remainingSlots = state.settings.pickCount - leader.picks.length;
  const mustReserve = Math.max(0, remainingSlots - 1) * state.settings.minReservePerSlot;
  if (amount > leader.pointsLeft - mustReserve) return [false, "보유 포인트 초과"];
  return [true, null];
}

// ===== 소켓 =====
io.on("connection", (socket) => {
  const state = getRoom();
  socket.join(DEFAULT_CODE);

  socket.on("join_room", ({ role, name, playerInfo }) => {
    if (role === "leader") {
      state.leaders[socket.id] = {
        id: socket.id,
        name: name || `팀장-${socket.id.slice(0,4)}`,
        pointsLeft: state.settings.maxPoints,
        picks: []
      };
      sys(`팀장 입장: ${state.leaders[socket.id].name}`);
    } else if (role === "player") {
      const p = {
        id: socket.id,
        name: playerInfo?.name || name || `플레이어-${socket.id.slice(0,4)}`,
        characters: Array.isArray(playerInfo?.characters) ? playerInfo.characters.slice(0,3) : [],
        motto: playerInfo?.motto || ""
      };
      state.playersQueue.push(p);
      sys(`플레이어 등록: ${p.name}`);
    }
    publish(state);
  });

  socket.on("start_auction", () => {
    if (state.started) return;
    // 셔플
    for (let i = state.playersQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.playersQueue[i], state.playersQueue[j]] = [state.playersQueue[j], state.playersQueue[i]];
    }
    state.started = true;
    sys("경매 시작");
    proceedNextLot(state);
  });

  socket.on("bid", ({ amount }) => {
    if (!state.currentLot) return;
    const [ok, reason] = canBid(state, socket.id, amount);
    if (!ok) return socket.emit("error_msg", reason);
    state.currentLot.highestBid = amount;
    state.currentLot.highestBidder = { id: socket.id, name: state.leaders[socket.id].name };
    state.currentLot.lastBidderId = socket.id; // 연속호가 방지
    sys(`호가: ${state.leaders[socket.id].name} → ${amount}pt`);
    startTimer(state, state.settings.onRaiseResetSec); // 리셋
    publish(state);
  });

  socket.on("next_lot", () => {
    if (!state.started) return;
    clearTimer(state);
    finishCurrentLot(state); // 강제 진행
  });

  socket.on("disconnect", () => {
    if (state.leaders[socket.id]) {
      const nm = state.leaders[socket.id].name;
      delete state.leaders[socket.id];
      sys(`팀장 퇴장: ${nm}`);
    } else {
      state.playersQueue = state.playersQueue.filter(p => p.id !== socket.id);
    }
    publish(state);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`auction-server listening on http://localhost:${PORT}`));
