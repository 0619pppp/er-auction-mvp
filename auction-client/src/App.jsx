import { useEffect, useMemo, useState } from 'react'
import { socket } from './lib/socket'
import AuctionBoard from './components/AuctionBoard'
import CurrentLotCard from './components/CurrentLotCard'

const fmtSec = (ms) => Math.max(0, Math.ceil((ms - Date.now())/1000))

export default function App() {
  const [mode, setMode] = useState('lobby') // lobby | room
  const [name, setName] = useState('')
  const [role, setRole] = useState('leader')

  const [pChar, setPChar] = useState(['','',''])
  const [pMotto, setPMotto] = useState('')

  const [state, setState] = useState(null)
  const [feed, setFeed] = useState([])
  const [myId, setMyId] = useState(null)

  const [adminPw, setAdminPw] = useState('')
  const [csvFile, setCsvFile] = useState(null)
  const [uploadMsg, setUploadMsg] = useState('')

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
    const iv=setInterval(()=>setState(p=>({...p})),250)
    return ()=>clearInterval(iv)
  },[state?.currentLot?.endsAt])

  const joinRoom=()=>{ 
    if (!name.trim()) {
      alert('이름을 입력하세요.')
      return
    }
    const info={ role, name }
    if(role==='player') {
      info.playerInfo = {
        name,
        characters:pChar.filter(Boolean),
        motto:pMotto
      }
    }
    socket.emit('join_room', info) 
    setMode('room')
  }

  const startAuction = () => socket.emit('start_auction')
  const bidAbs       = (v) => socket.emit('bid',{amount:v})
  const resetRoom    = () => socket.emit('reset_room')
  const nextLot      = () => socket.emit('next_lot')

  const pauseAuction  = () => socket.emit('pause_auction')
  const resumeAuction = () => socket.emit('resume_auction')

  const myLeader = myId && state?.leaders ? state.leaders[myId] : null
  const pickCount = state?.settings?.pickCount ?? 2

  async function handleUploadPlayers() {
    if (!csvFile) {
      setUploadMsg('CSV 파일이 없습니다.')
      return
    }
    const form = new FormData()
    form.append('playersCsv', csvFile)
    form.append('password', adminPw)

    try {
      const res = await fetch(
        import.meta.env.VITE_SERVER_UPLOAD_URL,
        {
          method: 'POST',
          body: form
        }
      )
      const json = await res.json()
      if (json.ok) {
        setUploadMsg(`업로드 성공. ${json.count}명 로드됨.`)
        setCsvFile(null)
      } else {
        setUploadMsg(`업로드 실패: ${json.error || 'unknown'}`)
      }
    } catch(e) {
        setUploadMsg('업로드 요청 실패')
    }
  }

  if(mode==='lobby')return(
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl mb-4">
        양혜성배 이터널리턴대회 경매
      </h1>
      <div className="grid gap-3">
        <input
          placeholder="이름 적는칸"
          value={name}
          onChange={e=>setName(e.target.value)}
        />
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
                <input
                  key={i}
                  placeholder={`캐릭터 ${i+1}`}
                  value={c}
                  onChange={e=>{
                    const cp=[...pChar];cp[i]=e.target.value;setPChar(cp)
                  }}
                />)}
            </div>

            <div className="text-sm text-textSub mb-2">각오</div>
            <textarea
              placeholder="각오 한마디 (2~3줄 가능)"
              rows={3}
              value={pMotto}
              onChange={e=>setPMotto(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="mt-6 flex gap-3">
        <button onClick={joinRoom} className="primary px-4 py-2">
          입장
        </button>
      </div>
    </main>
  )

  return(
    <main className="mx-auto max-w-6xl px-4 py-6 grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* 좌측: 팀 현황 */}
      <section className="md:col-span-2">
        <AuctionBoard leaders={state?.leaders||{}}/>
      </section>

      {/* 우측: 현재 로트 / 순번 / 로그 / 관리 */}
      <section className="space-y-6">

        <CurrentLotCard
          lot={state?.currentLot}
          onBidAbs={bidAbs}
          onStart={startAuction}
          started={!!state?.started}
          myId={myId}
          myLeader={myLeader}
          pickCount={pickCount}
          paused={!!state?.paused}
          onPause={pauseAuction}
          onResume={resumeAuction}
        />

        <div className="card">
          <h4 className="text-base mb-3">남은 플레이어 (등장 예정 순서)</h4>
          <ol className="space-y-2 text-sm">
            {(state?.playersQueue||[]).map((p, idx) =>
              <li
                key={p.id}
                className="flex items-start gap-2 text-slate-200"
              >
                <span className="text-accent font-bold w-6 text-right">
                  {idx+1}.
                </span>
                <span className="flex-1">
                  <div className="font-medium text-white">
                    {p.name}
                  </div>
                  {p.motto && (
                    <div className="text-[11px] text-textSub leading-snug whitespace-pre-line break-words">
                      {p.motto}
                    </div>
                  )}
                  {(p.characters && p.characters.length>0) && (
                    <div className="text-[11px] text-slate-400 leading-snug">
                      캐릭터: {p.characters.join(", ")}
                    </div>
                  )}
                </span>
              </li>
            )}
          </ol>
        </div>

        <div className="card">
          <h4 className="text-base mb-3">경매 피드</h4>
          <div className="h-56 overflow-auto space-y-1 text-sm">
            {feed.map((m,i)=>
              <div key={i} className="text-slate-200">
                <code className="text-xs text-textSub mr-2">
                  {new Date(m.t).toLocaleTimeString()}
                </code>
                {m.text}
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-slate-600 pt-4 text-sm space-y-2">
            <div className="text-textSub text-xs">운영자 영역</div>

            <input
              type="password"
              placeholder="관리 비번"
              value={adminPw}
              onChange={e=>setAdminPw(e.target.value)}
            />

            <input
              type="file"
              accept=".csv,text/csv"
              onChange={e=>setCsvFile(e.target.files?.[0]||null)}
              className="text-xs text-textSub"
            />

            <button
              onClick={handleUploadPlayers}
              className="ghost px-3 py-2 text-sm w-full"
            >
              CSV 업로드
            </button>

            {uploadMsg && (
              <div className="text-xs text-textSub">
                {uploadMsg}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 pt-4">
              <button
                onClick={pauseAuction}
                className="ghost px-3 py-2 text-sm"
              >
                일시정지
              </button>
              <button
                onClick={resumeAuction}
                className="ghost px-3 py-2 text-sm"
              >
                재개
              </button>
              <button
                onClick={resetRoom}
                className="ghost px-3 py-2 text-sm"
              >
                방 초기화
              </button>
              <button
                onClick={nextLot}
                className="ghost px-3 py-2 text-sm"
              >
                다음 로트
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
