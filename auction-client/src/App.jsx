import React, { useEffect, useState } from "react";
import { socket } from "./lib/socket";

export default function App() {
  const [mode, setMode] = useState("lobby");
  const [role, setRole] = useState("leader");
  const [name, setName] = useState("");
  const [chars, setChars] = useState(["", "", ""]);
  const [motto, setMotto] = useState("");
  const [state, setState] = useState(null);
  const [feed, setFeed] = useState([]);

  useEffect(() => {
    socket.on("state", (st) => setState(st));
    socket.on("system", (msg) => setFeed((f) => [...f, msg]));
  }, []);

  const join = () => {
    const playerInfo =
      role === "player"
        ? { name, characters: chars.filter(Boolean), motto }
        : null;
    socket.emit("join_room", { role, name, playerInfo });
    setMode("room");
  };

  const start = () => socket.emit("start_auction");
  const bid = (v) => socket.emit("bid", { amount: v });

  if (mode === "lobby")
    return (
      <main className="p-8 max-w-md mx-auto">
        <h1 className="text-xl mb-4">ER 자낳대 경매</h1>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full mb-2 bg-panel p-2 rounded"
        >
          <option value="leader">팀장</option>
          <option value="player">플레이어</option>
        </select>
        <input
          placeholder="이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full mb-2 bg-panel p-2 rounded"
        />
        {role === "player" && (
          <div className="space-y-2 mb-4">
            {chars.map((c, i) => (
              <input
                key={i}
                placeholder={`선호 캐릭터 ${i + 1}`}
                value={c}
                onChange={(e) => {
                  const cp = [...chars];
                  cp[i] = e.target.value;
                  setChars(cp);
                }}
                className="w-full bg-panel p-2 rounded"
              />
            ))}
            <input
              placeholder="각오 한마디"
              value={motto}
              onChange={(e) => setMotto(e.target.value)}
              className="w-full bg-panel p-2 rounded"
            />
          </div>
        )}
        <button onClick={join} className="primary w-full">
          입장
        </button>
      </main>
    );

  return (
    <main className="grid md:grid-cols-3 gap-4 p-6 max-w-6xl mx-auto">
      <section className="md:col-span-2 space-y-4">
        <h2 className="text-lg font-bold mb-2">팀장 현황</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {Object.values(state?.leaders || {}).map((l) => (
            <div key={l.id} className="card">
              <div className="text-xl font-bold">{l.name}</div>
              <div className="text-sm text-gray-300">
                잔여: {l.pointsLeft}pt
              </div>
              <div className="mt-2">
                {(l.picks || []).map((p) => (
                  <div key={p.id} className="text-sm text-cyan-300">
                    {p.name}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="card">
          {!state?.started ? (
            <button onClick={start} className="primary w-full">
              경매 시작
            </button>
          ) : state?.currentLot ? (
            <>
              <div className="text-lg font-bold mb-2">
                {state.currentLot.player.name}
              </div>
              <div className="text-sm mb-1">
                현재가: {state.currentLot.highestBid}pt
              </div>
              <div className="flex gap-2">
                {[10, 20, 50].map((v) => (
                  <button
                    key={v}
                    onClick={() =>
                      bid(state.currentLot.highestBid + v)
                    }
                    className="primary flex-1"
                  >
                    +{v}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div>로트 대기 중...</div>
          )}
        </div>

        <div className="card">
          <h4 className="mb-2 font-bold">피드</h4>
          <div className="h-64 overflow-auto text-sm space-y-1">
            {feed.map((m, i) => (
              <div key={i}>{m.text}</div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
