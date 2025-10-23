import { useEffect, useMemo, useState } from 'react'
import { socket } from './lib/socket'
import AuctionBoard from './components/AuctionBoard'
import CurrentLotCard from './components/CurrentLotCard'

const fmtSec = (ms) => Math.max(0, Math.ceil((ms - Date.now())/1000))

export default function App() {

  const [mode, setMode] = useState('lobby') // lobby | room
  const [name, setName] = useState('팀장A')
  const [role, setRole] = useState('leader')

  const [pChar, setPChar] = useState(['','',''])
  const [pMotto, setPMotto] = useState('')

  const [state, setState] = useState(null)
  const [feed, setFeed] = useState([])
  const [myId, setMyId] = useState(null)
  const myLeader = myId && state?.leaders ? state.leaders[myId] : null
  const pickCount = state?.settings?.pickCount ?? 2

  useEffect(() => {
    socket.on('state', st => setState(st))
    socket.on('system', m => setFeed(c=>[...c,m]))
    socket.on('error_msg', m => alert(m))
    socket.on('connect', () => setMyId(socket.id))
    return () => socket.disconnect()
  }, [])

  const currentEndsIn = useMemo(() => {
    if (!state?.currentLot?.endsAt) return 0
    return fmtSec(state.currentLot.endsAt)
  }, [state?.currentLot?.endsAt])

  useEffect(() => {
    if (!state?.currentLot?.endsAt) return
    const iv=setInterval(()=>setState(p=>({...p})),250) // 타이머/진행률 리렌더
    return ()=>clearInterval(iv)
  },[state?.currentLot?.endsAt])

  const joinRoom=()=>{ 
    const info={ role, name }
    if(role==='player') info.playerInfo={ name, characters:pChar.filter(Boolean), motto:pMotto }
    socket.emit('join_room', info); 
    setMode('room')
  }
  const startAuction=()=>socket.emit('start_auction')
  const bidAbs=(v)=>socket.emit('bid',{amount:v})
  const nextLot=()=>socket.emit('next_lot')

  if(mode==='lobby')return(
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl mb-4">ER 경매</h1>
      <div className="grid gap-3">
        <input placeholder="이름" value={name} onChange={e=>setName(e.target.value)}/>
        <select value={role} onChange={e=>setRole(e.target.value)}>
          <option value="leader">팀장</option>
          <option value="player">플레이어</option>
          <option value="viewer">관전자</option>
        </select>
        {role==='player'&&(
          <div className="card">
            <div className="text-sm text-textSub mb-2">선호 캐릭터</div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {pChar.map((c,i)=>
                <input key={i} placeholder={`캐릭터 ${i+1}`} value={c}
                       onChange={e=>{const cp=[...pChar];cp[i]=e.target.value;setPChar(cp)}} />)}
            </div>
            <div className="text-sm text-textSub mb-2">각오</div>
            <input placeholder="각오 한마디" value={pMotto} onChange={e=>setPMotto(e.target.value)}/>
          </div>
        )}
      </div>
      <div className="mt-6 flex gap-3">
        <button onClick={joinRoom} className="primary px-4 py-2">입장</button>
      </div>
    </main>
  )

  return(
    <main className="mx-auto max-w-6xl px-4 py-6 grid grid-cols-1 md:grid-cols-3 gap-6">
      <section className="md:col-span-2">
        <AuctionBoard leaders={state?.leaders||{}}/>
      </section>
      <section className="space-y-6">
        <CurrentLotCard lot={state?.currentLot}
                        onBidAbs={bidAbs} onStart={startAuction}
                        onNext={nextLot} started={!!state?.started}
                        myId={myId} myLeader={myLeader} pickCount={pickCount}/>
        <div className="card">
          <h4 className="text-base mb-3">남은 플레이어</h4>
          <ol className="space-y-2 list-decimal list-inside">
            {(state?.playersQueue||[]).map(p=>
              <li key={p.id} className="text-sm">{p.name}</li>)}
          </ol>
        </div>
        <div className="card">
          <h4 className="text-base mb-3">경매 피드</h4>
          <div className="h-56 overflow-auto space-y-1 text-sm">
            {feed.map((m,i)=>
              <div key={i} className="text-slate-200">
                <code className="text-xs text-textSub mr-2">{new Date(m.t).toLocaleTimeString()}</code>{m.text}
              </div>)}
          </div>
          <div className="mt-3 text-right">
            <button onClick={()=>socket.emit('reset_room')} className="ghost px-3 py-2 text-sm">방 초기화</button>
          </div>
        </div>
      </section>
    </main>
  )
}
