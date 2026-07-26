/**
 * 라우트 전환 즉시 뜨는 스켈레톤.
 * 서버 데이터가 늦어도 화면이 즉시 반응하므로 "눌렸나?" 하는 구간이 생기지 않는다.
 */
export default function AppLoading() {
  return (
    <div className="flex animate-[skeleton-pulse_1.2s_ease-in-out_infinite] flex-col gap-6">
      <div className="skeleton h-9 w-56" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-[104px]" />
        ))}
      </div>
      <div className="skeleton h-[220px]" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-[76px]" />
        ))}
      </div>
    </div>
  );
}
