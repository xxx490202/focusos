// ============================================================
//  ConfirmDot.tsx — 待确认日程右侧的空心圆
// ============================================================
//  ⭐ 用户规则：
//     · 待确认的事件在时间轴上占一行，**字体灰色**，框右边有一个**空心圆**
//     · 点空心圆 → 变实心 → 随即消失 → 该事件被确认为正式日程，字体恢复正常色
//     · 已确认的事件不显示这颗圆
//
//  ⚠️ 必须拦掉 mousedown / click 的冒泡：
//    它坐在事件块里，而事件块自己挂了「按下拖动移动」「右键弹菜单」「单击选中」，
//    不拦住的话点一下确认会顺带把事件拖走或选中。
// ============================================================
import styles from './ConfirmDot.module.css'

interface Props {
  /** 只在待确认时渲染 */
  pending: boolean
  /** 正在播放「实心」动效（确认请求已发出，还没落库回来） */
  confirming: boolean
  onConfirm: () => void
  title: string
}

export function ConfirmDot({ pending, confirming, onConfirm, title }: Props) {
  if (!pending) return null

  return (
    <button
      type="button"
      className={styles.dot}
      data-confirming={confirming ? 'true' : 'false'}
      onMouseDown={(e) => e.stopPropagation()}
      // 双击也要拦：事件块挂了「双击 → 编辑」，不拦的话连点两下确认会弹出编辑框
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onConfirm()
      }}
      title={title}
      aria-label={title}
      data-testid="confirm-dot"
    >
      <span className={styles.fill} aria-hidden="true" />
    </button>
  )
}
