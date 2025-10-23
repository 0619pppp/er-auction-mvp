import { useState, useEffect } from 'react'

export default function CurrentLotCard({ lot, timeLeft, onBidAbs, onStart, onNext, started }) {
  const [manual, setManual] = useState('')
  useEffect(() => { if (lot?.highestBid != null) setManual(String((lot.highestBid || 0) + 10)) }, [lot?.highestBid])
  if (!started) return (
    <div className="card text-center">
      <p className="text-slate-300 mb-3">아직 경매가 시작되지 않았습니다.</p>
      <button onClick={onStart} className="primary px-5 py-2">경매 시작</button>
    </div>)
  if (!lot) return (
    <div className="card text-center">
      <p className="text-slate-300">현재 진행 중인 경매가 없습니다.</p>
      <button onClick={onNext} className="ghost mt-3 px-5 py-2">다음 로트</button>
    </div>)
  const { player, highestBid, highestBidder, phase } = lot
  const preview = phase === 'preview'
  const submitManual = () => { const v = Number(manual); if (!Number.isFinite(v)) return; onBidAbs(v) }

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <div className={`text-xs rounded-full px-2 py-1 font-medium ${preview ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
          {preview ? '소개중 (호가 대기)' : '호가 진행중'}
        </div>
        <div className="text-xs rounded-full bg-slate-700 px-2 py-1 text-slate-200 font-medium">
          남은 {timeLeft}s
        </div>
      </div>
      <div className="mb-4">
        <div className="text-xl font-bold">{player.name}</div>
        {player.motto && <div className="italic text-textSub mt-1 border-l-4 border-slate-500 pl-3">“{player.motto}”</div>}
      </div>
      <div className="mb-4">
        <div className="text-sm text-textSub mb-1 font-medium">선호 캐릭터</div>
        <div className="flex flex-wrap gap-2">
          {(player.characters || []).length
            ? player.characters.map((c, i) => (
              <span key={i} className="px-3 py-1 rounded-full bg-slate-800 border border-slate-600 text-slate-100 text-sm">{c}</span>
            ))
            : <span className="text-slate-500 text-sm">입력된 캐릭터 없음</span>}
        </div>
      </div>
      <div className="rounded-xl bg-slate-800 p-4 border border-slate-600">
        <div className="mb-2">
          <div className="text-xs text-textSub">현재 최고가</div>
          <div className="text-2xl font-bold text-white">{highestBid} <span className="text-base font-medium">pt</span></div>
          <div className="text-xs text-textSub">{highestBidder ? `(${highestBidder.name})` : '입찰자 없음'}</div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[10,20,50,100].map(step => (
            <button key={step} onClick={() => onBidAbs((highestBid || 0) + step)} disabled={preview}
              className={`py-2 text-sm font-medium ${preview ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'primary'}`}>+{step}</button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input value={manual} onChange={e=>setManual(e.target.value)} onKeyDown={e=>{ if (e.key==='Enter' && !preview) submitManual() }} className="flex-1" placeholder="직접 입력 예: 270" disabled={preview}/>
          <button onClick={submitManual} disabled={preview} className="ghost px-4 py-2 text-sm">입력가 입찰</button>
        </div>
      </div>
      <div className="mt-4 text-right">
        <button onClick={onNext} className="ghost px-4 py-2 text-sm">다음 로트</button>
      </div>
    </div>
  )
}
