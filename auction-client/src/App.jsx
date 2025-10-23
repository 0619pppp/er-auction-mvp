import React, { useEffect, useMemo, useState } from 'react'
import { makeSocket } from './lib/socket'
import AuctionBoard from './components/AuctionBoard'
import CurrentLotCard from './components/CurrentLotCard'

export default function App() {
  const PROD_URL = import.meta.env.VITE_API_URL || "https://<your-render>.onrender.com";
  const [baseURL, setBaseURL] = useState(PROD_URL);
  const [socket, setSocket] = useState(null)
  const [mode, setMode] = useState('lobby')
  const [roomCode, setRoomCode] = useState('ER1')
  const [name, setName] = useState('팀장A')
  const [role, setRole] = useState('leader')
  const [pChar, setPChar] = useState(['','',''])
  const [pMotto, setPMotto] = useState('')
  const [state, setState] = useState(null)
  const [feed, setFeed] = useState([])

  useEffect(() => {
    const s = makeSocket(baseURL)
    setSocket(s)
    s.on('state', st => setState(st))
    s.on('system', m => setFeed(c=>[...c,m]))
    s.on('error_msg', m => alert(m))
    return ()=>s.disconnect()
  }, [baseURL])

  const currentEndsIn = useMemo(() => {
    if (!state?.currentLot?.endsAt) return 0
    return Math.max(0, Math.ceil((state.currentLot.endsAt - Date.now())/1000))
  }, [state?.currentLot?.endsAt])

  useEffect(() => {
    if (!state?.currentLot?.endsAt) return
    const iv=setInterval(()=>setState(p=>({...p})),250)
    return ()=>clearInterval(iv)
  },[state?.currentLot?.endsAt])

  const createRoom=()=>socket.emit('create_room',{code:roomCode,settings:{maxPoints:500,bidStep:10,pickCount:2,lotTimeSec:20,onRaiseResetSec:10,previewSec:30}})
  const joinRoom=()=>{const info={code:roomCode,role,name}
    if(role==='player')info.name={pname:name,characters:pChar.filter(Boolean),motto:pMotto}
    socket.emit('join_room',info)
    setMode('room')}
  const startAuction=()=>socket.emit('start_auction',{code:roomCode})
  const bidAbs=(v)=>socket.emit('bid',{code:roomCode,amount:v})
  const nextLot=()=>socket.emit('next_lot',{code:roomCode})

  if(mode==='lobby')return(
  <main className="mx-auto max-w-3xl px-4 py-8">
    <h1 className="text-xl mb-4">ER 자낳대 경매</h1>
    <div className="grid gap-3">
      <input placeholder="서버 URL" value={baseURL} onChange={e=>setBaseURL(e.target.value)}/>
      <input placeholder="방 코드" value={roomCode} onChange={e=>setRoomCode(e.target.value)}/>
      <input placeholder="이름" value={name} onChange={e=>setName(e.target.value)}/>
      <select value={role} onChange={e=>setRole(e.target.value)}>
        <option value="leader">팀장</option>
        <option value="player">플레이어</option>
        <option value="viewer">관전자</option>
      </select>
      {role==='player'&&(
        <div className="card">
          <div className="grid grid-cols-3 gap-2 mb-2">
            {pChar.map((c,i)=><input key={i} placeholder={`선호캐릭터${i+1}`} value={c} onChange={e=>{const cp=[...pChar];cp[i]=e.target.value;setPChar(cp)}} />)}
          </div>
          <input placeholder="각오 한마디" value={pMotto} onChange={e=>setPMotto(e.target.value)}/>
        </div>
      )}
    </div>
    <div className="mt-6 flex gap-3">
      <button onClick={createRoom} className="primary px-4 py-2">방 만들기</button>
      <button onClick={joinRoom} className="ghost px-4 py-2">입장</button>
    </div>
  </main>
  )

  return(
  <main className="mx-auto max-w-6xl px-4 py-6 grid grid-cols-1 md:grid-cols-3 gap-6">
    <section className="md:col-span-2"><AuctionBoard leaders={state?.leaders||{}}/></section>
    <section className="space-y-6">
      <CurrentLotCard lot={state?.currentLot} timeLeft={currentEndsIn} onBidAbs={bidAbs} onStart={startAuction} onNext={nextLot} started={!!state?.started}/>
      <div className="card"><h4 className="text-base mb-3">남은 플레이어</h4><ol className="space-y-2 list-decimal list-inside">{(state?.playersQueue||[]).map(p=><li key={p.id} className="text-sm">{p.name}</li>)}</ol></div>
      <div className="card"><h4 className="text-base mb-3">경매 피드</h4><div className="h-56 overflow-auto space-y-1 text-sm">{feed.map((m,i)=><div key={i} className="text-slate-200"><code className="text-xs text-textSub mr-2">{new Date(m.t).toLocaleTimeString()}</code>{m.text}</div>)}</div></div>
    </section>
  </main>)
}
