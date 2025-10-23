import React, { useEffect, useMemo, useRef, useState } from 'react'
import { makeSocket } from './lib/socket'
import AuctionBoard from './components/AuctionBoard'
import CurrentLotCard from './components/CurrentLotCard'

const fmtSec = (ms) => Math.max(0, Math.ceil((ms - Date.now())/1000))

export default function App() {
  const [baseURL, setBaseURL] = useState('http://localhost:4000')
  const [socket, setSocket] = useState(null)

  const [mode, setMode] = useState('lobby') // lobby | room
  const [roomCode, setRoomCode] = useState('ER1')
  const [name, setName] = useState('팀장A')
  const [role, setRole] = useState('leader') // leader | player | viewer

  const [pChar1, setPChar1] = useState('')
  const [pChar2, setPChar2] = useState('')
  const [pChar3, setPChar3] = useState('')
  const [pMotto, setPMotto] = useState('')

  const [state, setState] = useState(null)
  const [feed, setFeed] = useState([])

  useEffect(() => {
    const s = makeSocket(baseURL)
    setSocket(s)
    s.on('state', (st) => setState(st))
    s.on('system', (m) => setFeed((c) => [...c, m]))
    s.on('error_msg', (m) => alert(m))
    return () => s.disconnect()
  }, [baseURL])

  const currentEndsIn = useMemo(() => {
    if (!state?.currentLot?.endsAt) return 0
    return fmtSec(state.currentLot.endsAt)
  }, [state?.currentLot?.endsAt])

  useEffect(() => {
    if (!state?.currentLot?.endsAt) return
    const iv = setInterval(() => setState(prev => ({ ...prev })), 250)
    return () => clearInterval(iv)
  }, [state?.currentLot?.endsAt])

  const createRoom = () =>
    socket.emit('create_room', {
      code: roomCode,
      settings: { maxPoints: 500, bidStep: 10, pickCount: 2, lotTimeSec: 20, onRaiseResetSec: 10, previewSec: 30 }
    })

  const joinRoom = () => {
    if (role === 'player') {
      socket.emit('join_room', {
        code: roomCode,
        role,
        name: { pname: name, characters: [pChar1, pChar2, pChar3].filter(Boolean), motto: pMotto }
      })
    } else {
      socket.emit('join_room', { code: roomCode, role, name })
    }
    setMode('room')
  }

  const startAuction = () => socket.emit('start_auction', { code: roomCode })
  const bidAbs = (absoluteAmount) => socket.emit('bid', { code: roomCode, amount: absoluteAmount })
  const nextLot = () => socket.emit('next_lot', { code: roomCode })

  if (mode === 'lobby') {
    return (
      <div>
        <header className="border-b border-slate-700">
          <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
            <h1 className="text-xl">ER 자낳대 경매 MVP</h1>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm">서버 URL
              <input className="mt-1 w-full" value={baseURL} onChange={e=>setBaseURL(e.target.value)} />
            </label>
            <label className="text-sm">방 코드
              <input className="mt-1 w/full" value={roomCode} onChange={e=>setRoomCode(e.target.value)} />
            </label>
            <label className="text-sm">이름
              <input className="mt-1 w-full" value={name} onChange={e=>setName(e.target.value)} />
            </label>
            <label className="text-sm">역할
              <select className="mt-1 w-full" value={role} onChange={e=>setRole(e.target.value)}>
                <option value="leader">팀장</option>
                <option value="player">플레이어</option>
                <option value="viewer">관전자</option>
              </select>
            </label>

            {role === 'player' && (
              <div className="md:col-span-2 card">
                <p className="text-sm font-medium mb-2">플레이어 정보</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input placeholder="선호 캐릭터 1" value={pChar1} onChange={e=>setPChar1(e.target.value)} />
                  <input placeholder="선호 캐릭터 2" value={pChar2} onChange={e=>setPChar2(e.target.value)} />
                  <input placeholder="선호 캐릭터 3" value={pChar3} onChange={e=>setPChar3(e.target.value)} />
                </div>
                <input className="mt-2 w-full" placeholder="각오 한마디" value={pMotto} onChange={e=>setPMotto(e.target.value)} />
              </div>
            )}
          </div>

          <div className="mt-6 flex gap-3">
            <button onClick={createRoom} className="primary px-4 py-2">방 만들기</button>
            <button onClick={joinRoom} className="ghost px-4 py-2">입장</button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div>
      <header className="border-b border-slate-700">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <h2 className="text-lg">방 코드: {state?.code}</h2>
          <div className={`text-sm px-3 py-1 rounded-full ${state?.started ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
            {state?.started ? '진행중' : '대기'}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <section className="md:col-span-2">
          <AuctionBoard leaders={state?.leaders || {}} />
        </section>

        <section className="space-y-6">
          <CurrentLotCard
            lot={state?.currentLot}
            timeLeft={currentEndsIn}
            onBidAbs={bidAbs}
            onStart={startAuction}
            onNext={nextLot}
            started={!!state?.started}
          />

          <div className="card">
            <h4 className="text-base mb-3">남은 플레이어</h4>
            <ol className="space-y-2 list-decimal list-inside">
              {(state?.playersQueue || []).map(p => (
                <li key={p.id} className="text-sm">{p.name}</li>
              ))}
            </ol>
          </div>

          <div className="card">
            <h4 className="text-base mb-3">경매 피드</h4>
            <div className="h-56 overflow-auto space-y-1 text-sm">
              {feed.map((m,i)=> (
                <div key={i} className="text-slate-200">
                  <code className="text-xs text-textSub mr-2">{new Date(m.t).toLocaleTimeString()}</code>
                  {m.text}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
