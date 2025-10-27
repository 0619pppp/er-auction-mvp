export default function AuctionBoard({ leaders }) {
  const items = Object.values(leaders || {})
  if (!items.length) {
    return (
      <div className="card text-slate-300">
        팀장이 아직 없습니다.
      </div>
    )
  }

  return (
    <div className="card">
      <h2 className="text-lg mb-4">양혜성배 이터널리턴대회 경매 / 팀 현황</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {items.map(l => (
          <div key={l.id} className="bg-slate-900/40 border border-slate-700 rounded-xl p-4">
            <div className="mb-3">
              <div className="text-lg font-bold">🏆 팀장 {l.name}</div>
              <div className="text-xs text-textSub">
                잔여 {l.pointsLeft} pt
              </div>
            </div>
            <div className="space-y-2">
              {[0,1].map(i => (
                <div
                  key={i}
                  className="h-10 flex items-center justify-center rounded-xl border border-slate-600 bg-slate-800 text-slate-200 text-sm font-medium"
                >
                  {l.picks[i]?.name || '— 빈 슬롯 —'}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
