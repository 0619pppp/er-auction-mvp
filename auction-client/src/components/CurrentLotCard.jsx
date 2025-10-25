import { useState, useEffect, useMemo } from 'react'

function fmt(msLeft) {
  const s = Math.max(0, Math.ceil(msLeft/1000))
  const mm = String(Math.floor(s/60)).padStart(2,'0')
  const ss = String(s%60).padStart(2,'0')
  return `${mm}:${ss}`
}

export default function CurrentLotCard({
  lot,
  onBidAbs,
  onStart,
  started,
  myId,
  myLeader,
  pickCount = 2
}) {
  const [manual, setManual] = useState('')

  useEffect(() => {
    if (lot?.highestBid != null) {
      const nextDefault = (lot.highestBid || 0) + 10
      setManual(String(nextDefault))
    }
  }, [lot?.highestBid])

  const totalSec = lot?.totalSec || 0
  const msLeft = (lot?.endsAt || 0) - Date.now()
  const pct = useMemo(() => {
    if (!totalSec) return 0
    const leftS = Math.max(0, (lot.endsAt - Date.now())/1000)
    return Math.max(0, Math.min(100, (leftS / totalSec) * 100))
  }, [lot?.endsAt, totalSec])

  if (!started) {
    return (
      <div className="card text-center">
        <p className="text-slate-300 mb-3">
          아직 경매가 시작되지 않았습니다.
        </p>
        <button onClick={onStart} className="primary px-5 py-2">
          경매 시작
        </button>
      </div>
    )
  }

  if (!lot) {
    return (
      <div className="card text-center">
        <p className="text-slate-300">
          현재 진행 중인 경매가 없습니다.
        </p>
      </div>
    )
  }

  const { player, highestBid, highestBidder, phase } = lot
  const preview = phase === 'preview'
  const iAmTop = !!myId && highestBidder?.id === myId
  const atCapacity = (myLeader?.picks?.length || 0) >= pickCount

  // 버튼/입력 비활성 조건
  const disableBid = preview || iAmTop || atCapacity

  const submitManual = () => {
    const v = Number(manual)
    if (!Number.isFinite(v)) return
    // 일반 라운드에서는 최소 현재가 이상이어야 의미 있음
    // 유찰 라운드의 0입찰은 서버에서 판정하므로 여기선 막지 않는다
    if (v <= (highestBid||0) && v !== 0) return
    onBidAbs(v)
  }

  return (
    <div className="card">
      {/* 상태 + 타이머 */}
      <div className="mb-2 flex items-center justify-between">
        <div
          className={`text-xs rounded-full px-2 py-1 font-medium ${
            preview
              ? 'bg-amber-500/20 text-amber-300'
              : 'bg-emerald-500/20 text-emerald-300'
          }`}
        >
          {preview ? '소개중 (호가 대기)' : '호가 진행중'}
        </div>
        <div className="text-xs rounded-full bg-slate-700 px-2 py-1 text-slate-200 font-medium">
          남은 {fmt(msLeft)}
        </div>
      </div>

      {/* 남은 시간 바 */}
      <div className="w-full h-2 bg-slate-700 rounded mb-4 overflow-hidden">
        <div
          className="h-2 bg-accent transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* 매물 카드 */}
      <div className="mb-4 grid grid-cols-1 gap-3">
        <div>
          <div className="text-xl font-bold">{player.name}</div>
          {player.motto && (
            <div className="mt-2 rounded-xl border border-slate-600 bg-slate-800 p-3">
              <div className="text-xs text-textSub mb-1">각오</div>
              <div className="text-slate-100 italic">“{player.motto}”</div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-600 bg-slate-800 p-3">
          <div className="text-xs text-textSub mb-2">선호 캐릭터</div>
          <div className="flex flex-wrap gap-2">
            {(player.characters || []).length
              ? player.characters.map((c, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 rounded-full bg-slate-900 border border-slate-700 text-slate-100 text-sm"
                  >
                    {c}
                  </span>
                ))
              : (
                <span className="text-slate-500 text-sm">
                  입력된 캐릭터 없음
                </span>
              )}
          </div>
        </div>
      </div>

      {/* 입찰 박스 */}
      <div className="rounded-xl bg-slate-800 p-4 border border-slate-600">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-xs text-textSub">현재 최고가</div>
            <div className="text-2xl font-bold text-white">
              {highestBid} <span className="text-base font-medium">pt</span>
            </div>
            <div className="text-xs text-textSub">
              {highestBidder ? `(${highestBidder.name})` : '입찰자 없음'}
            </div>
          </div>

          {iAmTop && (
            <div className="text-[11px] px-2 py-1 rounded bg-slate-700 text-slate-200">
              연속 호가 불가
            </div>
          )}
          {atCapacity && (
            <div className="text-[11px] px-2 py-1 rounded bg-slate-700 text-slate-200">
              팀원 2명 완료
            </div>
          )}
        </div>

        <div className="grid grid-cols-4 gap-2">
          {[10,20,50,100].map(step => (
            <button
              key={step}
              onClick={() => onBidAbs((highestBid || 0) + step)}
              disabled={disableBid}
              className={`py-2 text-sm font-medium ${
                disableBid
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'primary'
              }`}
            >
              +{step}
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            value={manual}
            onChange={e=>setManual(e.target.value)}
            onKeyDown={e=>{
              if (e.key==='Enter' && !disableBid) submitManual()
            }}
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2"
            placeholder={`절대가 입력 (현재 ${ (highestBid||0) }pt) — 유찰라운드 0 가능`}
            disabled={disableBid}
          />
          <button
            onClick={submitManual}
            disabled={disableBid}
            className="ghost px-4 py-2 text-sm"
          >
            입력가 입찰
          </button>
        </div>
      </div>
    </div>
  )
}
