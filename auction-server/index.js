import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors({ origin: true }));

// 헬스체크 + 루트 응답
app.get("/health", (_, res) => res.json({ ok: true }));
app.get("/", (_, res) => res.type("text").send("OK"));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ["GET","POST"] } });

// In-memory 상태
const rooms = new Map();

const DEFAULT_SETTINGS = {
  maxPoints: 500,
  bidStep: 10,
  pickCount: 2,
  lotTimeSec: 20,        // 호가 단계 타이머
  onRaiseResetSec: 10,   // 최고가 갱신 시 리셋
  minPlayersToStart: 1,
  minReservePerSlot: 0,
  previewSec: 30         // 소개 단계(호가 전) 타이머
};

function createRoom(code, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const state = {
    code,
    settings: s,
    leaders: {},           // {socketId: {id,name,pointsLeft,picks:[]}}
    playersQueue: [],      // [{id,name,characters:[string],motto}]
    currentLot: null,      // {player, highestBid, highestBidder, endsAt, timer, phase}
    started: false,
    logs: []
  };
  rooms.set(code, state);
  return state;
}

function sanitize(state) {
  return {
    code: state.code,
    settings: state.settings,
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
          phase: state.currentLot.phase
        }
      : null,
    started: state.started,
    logs: state.logs.slice(-100)
  };
}

function publish(code) {
  const state = rooms.get(code);
  if (!state) return;
  io.to(code).emit("state", sanitize(state));
}

function clearTimer(state) {
  if (state?.currentLot?.timer) {
    clearInterval(state.currentLot.timer);
    state.currentLot.timer = null;
  }
}

function sys(code, kind, text, extra = {}) {
  io.to(code).emit("system", { t: Date.now(), kind, text, ...extra });
}

function startTimer(state, seconds) {
  clearTimer(state);
  const endsAt = Date.now() + seconds * 1000;
  state.currentLot.endsAt = endsAt;
  state.currentLot.timer = setInterval(() => {
    const now = Date.now();
    const secLeft = Math.max(0, Math.ceil((state.currentLot.endsAt - now) / 1000));

    // 소개 단계 카운트다운 안내
    if (state.currentLot.phase === "preview") {
      state.currentLot._announced = state.currentLot._announced || {};
      if ((secLeft === 10 || (secLeft <= 5 && secLeft > 0)) && !state.currentLot._announced[secLeft]) {
        state.currentLot._announced[secLeft] = true;
        sys(state.code, "countdown", `${secLeft}초 남음`);
      }
    }

    if (now >= state.currentLot.endsAt) {
      clearTimer(state);
      if (state.currentLot.phase === "preview") {
        startBidding(state);
      } else {
        finishCurrentLot(state);
      }
    } else {
      publish(state.code);
    }
  }, 250);
}

function startPreview(state) {
  state.currentLot.phase = "preview";
  state.currentLot._announced = {};
  state.logs.push({ t: Date.now(), type: "preview_start", player: state.currentLot.player });
  sys(state.code, "info", `소개 시작: ${state.currentLot.player.name}`);
  startTimer(state, state.settings.previewSec);
  publish(state.code);
}

function startBidding(state) {
  state.currentLot.phase = "bidding";
  state.logs.push({ t: Date.now(), type: "bidding_start", player: state.currentLot.player });
  sys(state.code, "info", "호가 시작");
  startTimer(state, state.settings.lotTimeSec);
  publish(state.code);
}

function finishCurrentLot(state) {
  const lot = state.currentLot;
  if (!lot) return;

  if (lot.highestBidder) {
    const leader = state.leaders[lot.highestBidder.id];
    leader.pointsLeft -= lot.highestBid;
    leader.picks.push(lot.player);
    state.logs.push({ t: Date.now(), type: "win", by: { id: leader.id, name: leader.name }, player: lot.player, price: lot.highestBid });
    sys(state.code, "win", `낙찰: ${leader.name} ← ${lot.player.name} @ ${lot.highestBid}pt`);
  } else {
    state.logs.push({ t: Date.now(), type: "no_bid", player: lot.player });
    state.playersQueue.push(lot.player); // 유찰 → 맨 뒤 재경매
    sys(state.code, "nobid", `유찰: ${lot.player.name}`);
  }

  state.currentLot = null;
  proceedNextLot(state);
  publish(state.code);
}

function proceedNextLot(state) {
  if (state.playersQueue.length === 0) {
    state.started = false;
    state.logs.push({ t: Date.now(), type: "auction_end" });
    sys(state.code, "info", "경매 종료");
    return;
  }
  const player = state.playersQueue.shift();
  state.currentLot = {
    player,
    highestBid: 0,
    highestBidder: null,
    endsAt: null,
    timer: null,
    phase: "preview"
  };
  startPreview(state);
}

function canBid(state, leaderId, amount) {
  const leader = state.leaders[leaderId];
  if (!leader) return [false, "팀장이 아님"];
  if (!state.currentLot) return [false, "현재 경매 없음"];
  if (state.currentLot.phase !== "bidding") return [false, "아직 호가 시작 전입니다."];
  if (amount < state.currentLot.highestBid + state.settings.bidStep) return [false, "입찰 단위 미달"];
  const remainingSlots = state.settings.pickCount - leader.picks.length;
  const mustReserve = Math.max(0, remainingSlots - 1) * state.settings.minReservePerSlot;
  if (amount > leader.pointsLeft - mustReserve) return [false, "보유 포인트 초과"];
  return [true, null];
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ code, settings }) => {
    if (rooms.has(code)) return socket.emit("error_msg", "이미 존재하는 코드입니다.");
    const state = createRoom(code, settings);
    socket.join(code);
    socket.emit("room_created", { code, settings: state.settings });
    publish(code);
  });

  socket.on("join_room", ({ code, role, name }) => {
    const state = rooms.get(code);
    if (!state) return socket.emit("error_msg", "존재하지 않는 방입니다.");
    socket.join(code);

    if (role === "leader") {
      state.leaders[socket.id] = {
        id: socket.id,
        name: typeof name === "string" ? name : `팀장-${socket.id.slice(0, 4)}`,
        pointsLeft: state.settings.maxPoints,
        picks: []
      };
      sys(code, "info", `팀장 입장: ${state.leaders[socket.id].name}`);
    } else if (role === "player") {
      const meta = typeof name === "object" && name !== null ? name : {};
      const pname = typeof name === "string" ? name : meta.pname || `플레이어-${socket.id.slice(0, 4)}`;
      const p = {
        id: socket.id,
        name: pname,
        characters: Array.isArray(meta.characters) ? meta.characters.slice(0, 3) : [],
        motto: typeof meta.motto === "string" ? meta.motto : ""
      };
      state.playersQueue.push(p);
      sys(code, "info", `플레이어 등록: ${p.name}`);
    } else {
      // viewer: 무시
    }
    publish(code);
  });

  socket.on("start_auction", ({ code }) => {
    const state = rooms.get(code);
    if (!state || state.started) return;
    if (Object.keys(state.leaders).length === 0) return;
    if (state.playersQueue.length < state.settings.minPlayersToStart) return;

    // 셔플
    for (let i = state.playersQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.playersQueue[i], state.playersQueue[j]] = [state.playersQueue[j], state.playersQueue[i]];
    }

    state.started = true;
    sys(code, "info", "경매 시작");
    proceedNextLot(state);
    publish(code);
  });

  socket.on("bid", ({ code, amount }) => {
    const state = rooms.get(code);
    if (!state || !state.currentLot) return;
    const [ok, reason] = canBid(state, socket.id, amount);
    if (!ok) return socket.emit("error_msg", reason);

    state.currentLot.highestBid = amount;
    state.currentLot.highestBidder = state.leaders[socket.id];
    sys(code, "bid", `호가: ${state.leaders[socket.id].name} → ${amount}pt`, {
      by: { id: socket.id, name: state.leaders[socket.id].name }, amount
    });
    startTimer(state, state.settings.onRaiseResetSec);
    publish(code);
  });

  // 자유 채팅 제거

  socket.on("disconnecting", () => {
    for (const code of socket.rooms) {
      const state = rooms.get(code);
      if (!state) continue;
      if (state.leaders[socket.id]) {
        const name = state.leaders[socket.id].name;
        delete state.leaders[socket.id];
        sys(code, "info", `팀장 퇴장: ${name}`);
      } else {
        const idx = state.playersQueue.findIndex((p) => p.id === socket.id);
        if (idx >= 0) {
          const [p] = state.playersQueue.splice(idx, 1);
          sys(code, "info", `플레이어 퇴장: ${p.name}`);
        }
      }
      publish(code);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`auction-server listening on http://localhost:${PORT}`);
});
