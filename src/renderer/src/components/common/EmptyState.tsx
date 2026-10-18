// ============================================================
//  EmptyState.tsx — 空状态（居中图标 + 一句引导 + 一个主行动按钮）
// ============================================================
interface Props {
  icon: React.ReactNode
  title: string
  desc: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ icon, title, desc, action }: Props) {
  return (
    <div className="emptyRoot">
      <span className="emptyIcon">{icon}</span>
      <p className="emptyTitle">{title}</p>
      <p className="emptyDesc">{desc}</p>
      {action && (
        <button className="emptyAction" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
