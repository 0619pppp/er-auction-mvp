import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import multer from "multer";
import { parse } from "csv-parse/sync";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "adminpass";

const app = express();
app.use(cors({ origin: true }));

const upload = multer({ storage: multer.memoryStorage() });

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

    leaders: {},                // {socketId:{id,name,pointsLeft,picks:[]}}
    playersQueue: [],           // [{id,name,characters,motto}]
    lastUploadedPlayers: [],    // 업로드된 최신 선수 풀

    currentLot: null,           // {player,highestBid,highestBidder,endsAt,phase,totalSec,lastBidderId,timer}
    started: false,

    unsold: [],
    secondRound: false,
    unsoldPass: 0,

    logs: []
  };
  rooms.set(code, state);
  return state;
}
function getRoom() {
  if (!rooms.has(DEFAULT_CODE)) createRoom();
  return rooms.get(DEFAULT_CODE);
}

// ===== 브로드캐스트 =====
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
          phase: state.currentLot.phase,
          totalSec: state.currentLot.totalSec || 0
        }
      : null,
    started: state.started,
    secondRound: state.secondRound,
    unsoldPass: state.unsoldPass
  };
}
const publish = (state) => io.emit("state", sanitize(state));
const sys = (text) => io.emit("system", { t: Date.now(), text });

// ===== 타이머 =====
function clearTimer(state) {
  if (state?.currentLot?.timer) {
    clearInterval(state.currentLot.timer);
    state.currentLot.timer = null;
  }
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

// ===== 경매 단계 =====
function startPreview(state) {
  state.currentLot.phase = "preview";
  state.currentLot.lastBidderId = null; // 연속호가 리셋
  sys(`소개 시작: ${state.currentLot.player.name}`);
  startTimer(state, state.settings.previewSec);
  publish(state);
}
function startBidding(state) {
  state.currentLot.phase = "bidding";
  sys("호가 시작");
  startTimer(state, state.settings.lotTimeSec);
  publish(state);
}

// 로트 진행
function proceedNextLot(state) {
  // 큐 비었으면 유찰 라운드로 들어가거나 종료
  if (state.playersQueue.length === 0) {
    if (state.unsold.length > 0) {
      state.playersQueue = state.unsold;
      state.unsold = [];
      state.secondRound = true;
      state.unsoldPass += 1;
      sys(`유찰 라운드 시작 (패스 ${state.unsoldPass})`);
      publish(state);
    } else {
      state.started = false;
      sys("경매 종료");
      publish(state);
      return;
    }
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

// 로트 마감
function finishCurrentLot(state) {
  const lot = state.currentLot;
  if (!lot) return;

  if (lot.highestBidder) {
    // 정상 낙찰
    const leader = state.leaders[lot.highestBidder.id];
    leader.pointsLeft -= lot.highestBid;
    leader.picks.push(lot.player);
    sys(`낙찰: ${leader.name} ← ${lot.player.name} @ ${lot.highestBid}pt`);
  } else {
    // 무입찰
    if (state.secondRound) {
      // 유찰 라운드에서는 무입찰이면 강제 배정 (0pt)
      const leadersArr = Object.values(state.leaders || {});
      const candidates = leadersArr.filter(l => l.picks.length < state.settings.pickCount);

      if (candidates.length > 0) {
        candidates.sort(
          (a, b) => b.pointsLeft - a.pointsLeft || a.name.localeCompare(b.name)
        );
        const winner = candidates[0];
        winner.picks.push(lot.player);
        sys(`무입찰 배정: ${winner.name} ← ${lot.player.name} @ 0pt`);
      } else {
        // 전원 슬롯 꽉 찼으면 다시 유찰 목록으로
        sys(`유찰 지속: ${lot.player.name}`);
        state.unsold.push(lot.player);
      }
    } else {
      // 본 라운드 유찰 -> unsold에 넣음. 나중에 secondRound에서 다시 돌림
      sys(`유찰: ${lot.player.name}`);
      state.unsold.push(lot.player);
    }
  }

  state.currentLot = null;
  publish(state);
  proceedNextLot(state);
}

// 입찰 제한
function canBid(state, leaderId, amount) {
  const leader = state.leaders[leaderId];
  if (!leader) return [false, "팀장이 아님"];
  if (!state.currentLot) return [false, "현재 경매 없음"];
  if (state.currentLot.phase !== "bidding") return [false, "호가 전입니다"];

  // 연속 호가 방지
  if (state.currentLot.lastBidderId === leaderId)
    return [false, "연속 호가 불가"];

  // 팀장 슬롯 다 찼으면 추가 구매 금지
  if (leader.picks.length >= state.settings.pickCount)
    return [false, "팀원 완료"];

  // 유찰 라운드에서 0 입찰 허용
  if (state.secondRound && amount === 0) {
    if (leader.pointsLeft === 0 && (state.currentLot.highestBid || 0) === 0) {
      return [true, null];
    }
    return [false, "0 입찰은 잔여 0일 때만 가능"];
  }

  // 최소 인상폭
  if (amount < state.currentLot.highestBid + state.settings.bidStep)
    return [false, "입찰 단위 미달"];

  // 잔여 포인트 체크
  const remainingSlots = state.settings.pickCount - leader.picks.length;
  const mustReserve =
    Math.max(0, remainingSlots - 1) * state.settings.minReservePerSlot;
  if (amount > leader.pointsLeft - mustReserve)
    return [false, "보유 포인트 초과"];

  return [true, null];
}

// 방 초기화 (경매 준비상태로 되돌림)
function resetRoomState(state) {
  clearTimer(state);

  // 팀장들 리셋 (돈 / picks)
  for (const id of Object.keys(state.leaders)) {
    state.leaders[id].pointsLeft = state.settings.maxPoints;
    state.leaders[id].picks = [];
  }

  // 업로드된 명단을 다시 playersQueue로 복원
  state.playersQueue = state.lastUploadedPlayers.map(p => ({ ...p }));

  // 경매 상태 완전 리셋
  state.currentLot = null;
  state.started = false;
  state.unsold = [];
  state.secondRound = false;
  state.unsoldPass = 0;

  sys("방 초기화되었습니다. (대기 상태)");
  publish(state);
}

// CSV 업로드 (라이브 등록)
app.post(
  "/admin/uploadPlayers",
  upload.single("playersCsv"),
  (req, res) => {
    const state = getRoom();

    // 비밀번호 체크
    const pw = req.body?.password;
    if (pw !== ADMIN_PASSWORD) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "no file" });
    }

    // CSV 파싱
    let rows;
    try {
      rows = parse(req.file.buffer, { columns: true, skip_empty_lines: true });
    } catch {
      return res.status(400).json({ ok: false, error: "csv parse fail" });
    }

    // CSV → playersQueue
    const newPlayers = rows.map((r, i) => ({
      id: `p${Date.now()}_${i}`,
      name: (r.name || "").trim() || `플레이어${i}`,
      characters: r.characters
        ? r.characters.split(",").map(s => s.trim()).slice(0, 3)
        : [],
      motto: (r.motto || "").trim()
    }));

    // 상태 갱신
    state.lastUploadedPlayers = newPlayers.map(p => ({ ...p }));
    state.playersQueue = newPlayers.map(p => ({ ...p }));

    // 경매 상태 초기화
    clearTimer(state);
    state.currentLot = null;
    state.started = false;
    state.unsold = [];
    state.secondRound = false;
    state.unsoldPass = 0;

    sys(`플레이어 명단 업로드 (${newPlayers.length}명). 대기상태로 리셋됨.`);
    publish(state);

    return res.json({ ok: true, count: newPlayers.length });
  }
);

// ===== 소켓 =====
io.on("connection", (socket) => {
  const state = getRoom();
  socket.join(DEFAULT_CODE);

  // 팀장 / 플레이어 / 관전자 입장
  socket.on("join_room", ({ role, name, playerInfo }) => {
    if (role === "leader") {
      state.leaders[socket.id] = {
        id: socket.id,
        name: name?.trim() || `팀장-${socket.id.slice(0, 4)}`,
        pointsLeft: state.settings.maxPoints,
        picks: []
      };
      sys(`팀장 입장: ${state.leaders[socket.id].name}`);
    } else if (role === "player") {
      // 수동 추가 (fallback). 보통 운영자 CSV로 넣지만 기능 유지
      const p = {
        id: socket.id,
        name:
          playerInfo?.name?.trim() ||
          name?.trim() ||
          `플레이어-${socket.id.slice(0, 4)}`,
        characters: Array.isArray(playerInfo?.characters)
          ? playerInfo.characters.slice(0, 3)
          : [],
        motto: playerInfo?.motto?.trim() || ""
      };
      state.playersQueue.push(p);
      state.lastUploadedPlayers.push({ ...p });
      sys(`플레이어 등록: ${p.name}`);
    }
    publish(state);
  });

  // 방 초기화 버튼. 경매 즉시 중지하고 준비상태로 복귀
  socket.on("reset_room", () => {
    resetRoomState(state);
  });

  // 경매 시작
  socket.on("start_auction", () => {
    if (state.started) return;

    // playersQueue 셔플
    for (let i = state.playersQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.playersQueue[i], state.playersQueue[j]] = [
        state.playersQueue[j],
        state.playersQueue[i]
      ];
    }

    state.started = true;
    state.secondRound = false;
    state.unsold = [];
    state.unsoldPass = 0;

    sys("경매 시작");
    proceedNextLot(state);
  });

  // 입찰
  socket.on("bid", ({ amount }) => {
    if (!state.currentLot) return;
    const [ok, reason] = canBid(state, socket.id, amount);
    if (!ok) return socket.emit("error_msg", reason);

    state.currentLot.highestBid = amount;
    state.currentLot.highestBidder = {
      id: socket.id,
      name: state.leaders[socket.id].name
    };
    state.currentLot.lastBidderId = socket.id;

    sys(`호가: ${state.leaders[socket.id].name} → ${amount}pt`);

    // 입찰 들어올 때마다 타이머 리셋
    startTimer(state, state.settings.onRaiseResetSec);
    publish(state);
  });

  // 수동 다음 로트
  socket.on("next_lot", () => {
    if (!state.started) return;
    clearTimer(state);
    finishCurrentLot(state); // finishCurrentLot 안에서 proceedNextLot 호출
  });

  socket.on("disconnect", () => {
    if (state.leaders[socket.id]) {
      const nm = state.leaders[socket.id].name;
      delete state.leaders[socket.id];
      sys(`팀장 퇴장: ${nm}`);
    }
    // 혹시 socket.id 기반으로 들어온 임시 플레이어가 있다면 제거
    state.playersQueue = state.playersQueue.filter(p => p.id !== socket.id);
    state.unsold = state.unsold.filter(p => p.id !== socket.id);
    publish(state);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`auction-server listening on http://localhost:${PORT}`);
});
