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

    currentLot: null,           // {player,highestBid,highestBidder,endsAt,phase,totalSec,lastBidderId,timer,pauseRemainingMs}
    started: false,

    unsold: [],
    secondRound: false,
    unsoldPass: 0,

    paused: false,              // 일시정지 여부

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
    unsoldPass: state.unsoldPass,
    paused: state.paused
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

    // 일시정지 중이면 타이머 진행 멈춘다
    if (state.paused) return;

    if (Date.now() >= state.currentLot.endsAt) {
      clearTimer(state);
      if (state.currentLot.phase === "preview") startBidding(state);
      else finishCurrentLot(state);
    } else {
      publish(state);
    }
  }, 250);
}

// 재개용 남은시간 기반 타이머
function startTimerWithRemaining(state, secondsLeft) {
  clearTimer(state);
  state.currentLot.totalSec = secondsLeft;
  state.currentLot.endsAt = Date.now() + secondsLeft * 1000;
  state.currentLot.timer = setInterval(() => {
    if (!state.currentLot) return clearTimer(state);

    // 일시정지 중이면 타이머 진행 멈춘다
    if (state.paused) return;

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
  state.currentLot.lastBidderId = null;
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

// 다음 로트 진행
function proceedNextLot(state) {
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
    timer: null,
    pauseRemainingMs: null
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
    // 입찰자 없음 → 무조건 유찰
    sys(`유찰: ${lot.player.name}`);
    state.unsold.push(lot.player);
  }

  state.currentLot = null;
  publish(state);
  proceedNextLot(state);
}

// 입찰 제한
function canBid(state, leaderId, amount) {
  // 일시정지 상태면 입찰 불가
  if (state.paused) return [false, "일시정지 상태"];

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
    Math.max(0, remainingSlots - 1) *
    state.settings.minReservePerSlot;
  if (amount > leader.pointsLeft - mustReserve)
    return [false, "보유 포인트 초과"];

  return [true, null];
}

// 방 초기화 (경매 준비상태로 되돌림)
function resetRoomState(state) {
  clearTimer(state);

  // 팀장들 리셋
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
  state.paused = false;

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

    // 1) 업로드된 버퍼를 문자열로 변환하면서 BOM 제거
    //    일부 엑셀 CSV는 UTF-8 BOM(\ufeff)을 앞에 붙인다.
    let rawText;
    try {
      rawText = req.file.buffer.toString("utf8");
      // BOM 제거
      if (rawText.charCodeAt(0) === 0xfeff) {
        rawText = rawText.slice(1);
      }
    } catch {
      return res.status(400).json({ ok: false, error: "encoding fail" });
    }

    // 2) csv-parse로 rows 파싱
    let rows;
    try {
      rows = parse(rawText, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
    } catch {
      return res.status(400).json({ ok: false, error: "csv parse fail" });
    }

    // 3) 컬럼 키 정규화
    //    혹시 헤더가 "﻿name" (BOM 섞인 name) 같은 식으로 들어오면 여기서 name으로 바꿔준다.
    //    로우마다 키를 깨끗하게 다시 만든다.
    const cleanedRows = rows.map((row) => {
      const normalized = {};
      for (const [key, val] of Object.entries(row)) {
        // key에서 BOM류 제거나 양끝 공백 제거
        const cleanKey = key
          .replace(/^\uFEFF+/, "") // BOM 제거
          .trim()
          .toLowerCase(); // name / Name / NAME 전부 name 처리

        normalized[cleanKey] = typeof val === "string" ? val.trim() : val;
      }
      return normalized;
    });

    // 4) 서버 내부 player 오브젝트 만들기
    const newPlayers = cleanedRows.map((r, i) => {
      // r.name 이나 r["이름"] 등 다른 컬럼명을 못쓰는 참가자는 지금 안 다룬다.
      // 여기서는 name만 본다. 만약 name이 비어 있으면 fallback.
      const finalName = r.name && r.name.length > 0
        ? r.name
        : `플레이어${i}`;

      const charsField = r.characters || "";
      const parsedChars = charsField
        ? charsField.split(",").map(s => s.trim()).filter(Boolean).slice(0, 3)
        : [];

      const finalMotto = r.motto ? r.motto : "";

      return {
        id: `p${Date.now()}_${i}`,
        name: finalName,
        characters: parsedChars,
        motto: finalMotto
      };
    });

    // 5) 상태 갱신
    state.lastUploadedPlayers = newPlayers.map(p => ({ ...p }));
    state.playersQueue = newPlayers.map(p => ({ ...p }));

    // 경매 상태 초기화
    clearTimer(state);
    state.currentLot = null;
    state.started = false;
    state.unsold = [];
    state.secondRound = false;
    state.unsoldPass = 0;
    state.paused = false;

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
      // 수동 추가 fallback
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

  // 방 초기화 (경매 중지+대기상태 복귀)
  socket.on("reset_room", () => {
    resetRoomState(state);
  });

  // 경매 시작
  socket.on("start_auction", () => {
  if (state.started) return;

  // 1️⃣ 플레이어 순서 랜덤 셔플
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
  state.paused = false;

  sys("경매 순서 확정. 전략 준비 시간 60초가 주어집니다.");
  publish(state);

  // 2️⃣ 1분 준비 타이머
  clearTimer(state);
  state.currentLot = null;
  let countdown = 60;
  state.strategyTimer = setInterval(() => {
    countdown--;
    sys(`전략 준비 중... ${countdown}s 남음`);
    publish(state);
    if (countdown <= 0) {
      clearInterval(state.strategyTimer);
      sys("전략 시간 종료. 첫 매물이 등장합니다.");
      publish(state);
      proceedNextLot(state); // 첫 로트 시작
    }
  }, 1000);
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

  // 다음 로트 강제 진행
  socket.on("next_lot", () => {
    if (!state.started) return;
    clearTimer(state);
    finishCurrentLot(state); // finishCurrentLot 안에서 proceedNextLot 호출
  });

  // 일시정지
  socket.on("pause_auction", () => {
    if (!state.currentLot || state.paused) return;

    if (state.currentLot.endsAt) {
      state.currentLot.pauseRemainingMs = Math.max(
        0,
        state.currentLot.endsAt - Date.now()
      );
    } else {
      state.currentLot.pauseRemainingMs = null;
    }

    clearTimer(state);
    state.paused = true;
    sys("경매 일시정지");
    publish(state);
  });

  // 재개
  socket.on("resume_auction", () => {
    if (!state.currentLot || !state.paused) return;

    state.paused = false;

    const ms = state.currentLot.pauseRemainingMs;
    if (typeof ms === "number" && ms > 0) {
      const secLeft = Math.ceil(ms / 1000);
      startTimerWithRemaining(state, secLeft);
    } else {
      // 남은 시간이 없으면 현재 phase 기본시간으로 다시
      if (state.currentLot.phase === "preview") {
        startTimer(state, state.settings.previewSec);
      } else {
        startTimer(state, state.settings.lotTimeSec);
      }
    }

    sys("경매 재개");
    publish(state);
  });

  // 연결 종료
  socket.on("disconnect", () => {
    if (state.leaders[socket.id]) {
      const nm = state.leaders[socket.id].name;
      delete state.leaders[socket.id];
      sys(`팀장 퇴장: ${nm}`);
    }

    // socket 기반으로 임시 등록된 플레이어라면 제거
    state.playersQueue = state.playersQueue.filter(p => p.id !== socket.id);
    state.unsold = state.unsold.filter(p => p.id !== socket.id);

    publish(state);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`auction-server listening on http://localhost:${PORT}`);
});
