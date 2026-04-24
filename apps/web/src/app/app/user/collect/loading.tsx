export default function CollectLoading() {
  return (
    <div className="animate-pulse px-4 pt-6 pb-24 lg:px-8 lg:pb-8 space-y-4">
      <div className="h-52 rounded-[28px] bg-card/40" />
      <div className="grid grid-cols-2 gap-4">
        <div className="h-36 rounded-[28px] bg-card/40" />
        <div className="h-36 rounded-[28px] bg-card/40" />
      </div>
      <div className="h-56 rounded-[28px] bg-card/40" />
    </div>
  )
}
