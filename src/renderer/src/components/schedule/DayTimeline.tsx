// ============================================================
//  DayTimeline.tsx — 日视图竖向时间轴
// ============================================================
//  · 小时格高可切 48 / 64 / 96
//  · 整点实线、半点虚线
//  · 拖拽移动 15 分钟吸附、底部把手缩放、重叠分栏、冲突 ⚠️
//  · 空白区双击新建
//  · 键盘：方向键移动 15 分钟，Shift+方向键缩放，Delete 删除，Enter 编辑
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  timeToMinutes, minutesToTime, snapToStep, clampMinutes, findConflicts,
  type TimeBlock, type TimelineLayout
} from '@shared/schedule'
import { CATEGORY_LABEL } from '@shared/defaults'
import { useT } from '../../i18n'
import { IconWarn } from '../common/Icons'
import { ConfirmDot } from './ConfirmDot'
import styles from './DayTimeline.module.css'

const MIN_DURATION = 15
const SNAP = 15

export interface TimelineProps {
  blocks: TimeBlock[]
  hourHeight: 48 | 64 | 96
  date: string
  isToday: boolean
  selectedId: string | null
  preview: { startMin: number; endMin: number }[]
  /**
   * 时间轴排版（见 schedule.ts 的 layoutTimeline）。
   * ⚠️ 里面的 toDrawn / toReal 必须和块的位置成对使用：
   *    · 刻度列、网格线、当前时间线 → toDrawn（跟着块一起被撑高）
   *    · 拖拽落点、双击新建       → toReal（把屏幕位置换回真实时间）
   *    只用其中一个，块与刻度就会错位。
   */
  layout: TimelineLayout
  /** 正在播放「空心 → 实心」动效的块 id */
  confirmingId: string | null
  /** 点空心圆 → 把该条日程确认为正式日程 */
  onConfirmPending: (id: string) => void
  onSelect: (id: string | null) => void
  onMove: (id: string, startMin: number) => void
  onResize: (id: string, endMin: number) => void
  onDelete: (id: string) => void
  onEdit: (id: string) => void
  onCreateAt: (startMin: number) => void
  /** 右键事件块：在指针位置弹出上下文菜单（编辑 / 删除…） */
  onContextMenuBlock: (id: string, x: number, y: number) => void
}

export function DayTimeline({
  blocks, hourHeight, date, isToday, selectedId, preview,
  layout, confirmingId, onConfirmPending,
  onSelect, onMove, onResize, onDelete, onEdit, onCreateAt, onContextMenuBlock
}: TimelineProps) {
  const t = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [nowMin, setNowMin] = useState(() => currentMinutes())
  const [drag, setDrag] = useState<{
    id: string
    mode: 'move' | 'resize'
    grabOffset: number
    startMin: number
    endMin: number
    /** 按下那一刻的绘制区间，用于判断「有没有真的移动过」 */
    originStart: number
    originEnd: number
  } | null>(null)
  const [dropHint, setDropHint] = useState<number | null>(null)

  /*
   * 当前时间线：每秒更新一次。
   * ⭐ currentMinutes() 返回**带秒的小数分钟**，配合 CSS 的 1s 线性过渡，
   *    这条线就是连续平移的，而不是每分钟「啪」地跳一格
   *    （用户要求「时间要实时移动」）。
   */
  useEffect(() => {
    if (!isToday) return
    const id = setInterval(() => setNowMin(currentMinutes()), 1000)
    return () => clearInterval(id)
  }, [isToday])

  /*
   * 冲突检测只覆盖**已确认**的块：
   * 待确认块与已有安排撞车时走的是「下移避让」而不是报冲突，
   * 若把待确认块也算进来，被它撞到的那个已确认块会平白亮起 ⚠️ 红框。
   */
  const conflicts = useMemo(() => findConflicts(blocks.filter((b) => !b.pending)), [blocks])

  /** 撑开后的整条时间轴高度（块被堆叠/撑高时会长于 24 小时） */
  const totalHeight = (layout.drawnTotal / 60) * hourHeight

  /** 真实分钟 → 绘制用的 Y（px） */
  const yOfReal = (realMin: number): number => (layout.toDrawn(realMin) / 60) * hourHeight
  /** 已经是「绘制分钟」的值 → Y（px）。layout.blocks 里的值属于这一种，不要再套 toDrawn */
  const yOfDrawn = (drawnMin: number): number => (drawnMin / 60) * hourHeight

  // ---------------- 拖拽 ----------------
  const minutesFromClientY = useCallback(
    (clientY: number): number => {
      const el = scrollRef.current
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      const y = clientY - rect.top + el.scrollTop
      const drawnMin = (y / hourHeight) * 60
      // ⚠️ 必须反算回真实时间：时间轴被撑高后，屏幕上的 1px 不再等于固定分钟数，
      //    直接用线性换算会让拖拽落点整体偏移。
      return Math.max(0, Math.min(24 * 60, layout.toReal(drawnMin)))
    },
    [hourHeight, layout]
  )

  useEffect(() => {
    if (!drag) return

    const onMoveEvt = (e: MouseEvent) => {
      const raw = minutesFromClientY(e.clientY)
      if (drag.mode === 'move') {
        // 15 分钟吸附
        const start = clampMinutes(snapToStep(raw - drag.grabOffset, SNAP), 0, 24 * 60 - (drag.endMin - drag.startMin))
        setDrag({ ...drag, startMin: start, endMin: start + (drag.endMin - drag.startMin) })
      } else {
        const end = clampMinutes(snapToStep(raw, SNAP), drag.startMin + MIN_DURATION, 24 * 60)
        setDrag({ ...drag, endMin: end })
      }
    }

    const onUp = () => {
      /*
       * ⚠️ 只有真正移动过才落库。
       *    重叠块的绘制位置与真实时间不同，若「按下又原地松开」也保存一次，
       *    就会把真实时间悄悄改成绘制位置（09:00 变 10:00），
       *    表现为方块莫名滑走 —— 用户会以为「放不进同一时间段」。
       */
      if (drag.mode === 'move') {
        if (drag.startMin !== drag.originStart) onMove(drag.id, drag.startMin)
      } else if (drag.endMin !== drag.originEnd) {
        onResize(drag.id, drag.endMin)
      }
      setDrag(null)
    }

    window.addEventListener('mousemove', onMoveEvt)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMoveEvt)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag, minutesFromClientY, onMove, onResize])

  // 拖任务卡到时间轴 → 排期
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('application/x-focusos-task')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropHint(snapToStep(minutesFromClientY(e.clientY), SNAP))
    }
    const onDragLeave = (e: DragEvent) => {
      if (e.target === el) setDropHint(null)
    }
    const onDrop = (e: DragEvent) => {
      const taskId = e.dataTransfer?.getData('application/x-focusos-task')
      if (!taskId) return
      e.preventDefault()
      const start = snapToStep(minutesFromClientY(e.clientY), SNAP)
      setDropHint(null)
      onMove(taskId, clampMinutes(start, 0, 24 * 60 - 60))
    }
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('dragleave', onDragLeave)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('dragleave', onDragLeave)
      el.removeEventListener('drop', onDrop)
    }
  }, [minutesFromClientY, onMove])

  // ---------------- 键盘 ----------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId) return
      const target = e.target as HTMLElement
      // 所有快捷键在 input/textarea 聚焦时失效
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return

      const block = blocks.find((b) => b.id === selectedId)
      if (!block) return

      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault()
          const delta = e.key === 'ArrowUp' ? -SNAP : SNAP
          if (e.shiftKey) {
            onResize(block.id, clampMinutes(block.endMin + delta, block.startMin + MIN_DURATION, 24 * 60))
          } else {
            const start = clampMinutes(block.startMin + delta, 0, 24 * 60 - (block.endMin - block.startMin))
            onMove(block.id, start)
          }
          break
        }
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          onDelete(block.id)
          break
        case 'Enter':
          e.preventDefault()
          onEdit(block.id)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, blocks, onMove, onResize, onDelete, onEdit])

  // ---------------- 渲染 ----------------
  const hours = Array.from({ length: 24 }, (_, i) => i)

  return (
    /* 唯一的滚动容器：刻度列在它内部，两者一起滚动 */
    <div
      ref={scrollRef}
      className={styles.scroll}
      data-date={date}
      onDoubleClick={(e) => {
        // 空白区双击新建任务，自动填时段
        if ((e.target as HTMLElement).closest(`.${styles.block}`)) return
        if ((e.target as HTMLElement).closest(`.${styles.previewBlock}`)) return
        onCreateAt(snapToStep(minutesFromClientY(e.clientY), 30))
      }}
    >
      <div className={styles.rail} style={{ height: totalHeight }}>
        {/*
         * 时间刻度列。
         * ⭐ 位置由 toDrawn 决定 —— 某个时段里塞了两个事件时，那一段会被撑高，
         *    下面的刻度（10:00 / 11:00 …）也一起往下挪，
         *    否则会出现「块在 10:00 的位置、左边的 10:00 还在原地」的错位
         *    （用户实测反馈「左边时间轴也要跟着拉高」）。
         */}
        <div className={styles.gutter}>
          {hours.map((h) => (
            <span key={h} className={styles.gutterLabel} style={{ top: yOfReal(h * 60) }}>
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
          <span className={styles.gutterLabel} style={{ top: yOfReal(24 * 60) }}>
            24:00
          </span>
          {/*
            「现在」的时刻标签挂在**刻度列**上（用户要求放在左边时间轴这边），
            而不是浮在画布里的圆点旁边 —— 那边会压住事件块。
          */}
          {isToday && (
            <span className={styles.nowLabel} style={{ top: yOfReal(nowMin) }}>
              {minutesToTime(Math.floor(nowMin))}
            </span>
          )}
        </div>

        <div className={styles.canvas}>
          {/* 网格：整点实线、半点虚线；与刻度用同一套映射，保证对齐 */}
          {hours.map((h) => (
            <div key={h}>
              <div className={styles.hourLine} style={{ top: yOfReal(h * 60) }} />
              {hourHeight >= 64 && (
                <div
                  className={styles.halfLine}
                  style={{ top: (yOfReal(h * 60) + yOfReal((h + 1) * 60)) / 2 }}
                />
              )}
            </div>
          ))}

          {/* 计划预览态：半透明虚线块 */}
          {preview.map((p, i) => (
            <div
              key={`preview-${i}`}
              className={styles.previewBlock}
              style={{
                top: yOfReal(p.startMin),
                height: Math.max(6, yOfReal(p.endMin) - yOfReal(p.startMin))
              }}
            />
          ))}

          {/* 任务块 */}
          {blocks.map((b) => {
            const isDragging = drag?.id === b.id
            // 未拖动时按排版后的区间绘制；拖动中一律听拖拽的
            const laid = layout.blocks.get(b.id)
            const baseStart = laid?.startMin ?? b.startMin
            const baseEnd = laid?.endMin ?? b.endMin
            const startMin = isDragging ? drag.startMin : baseStart
            const endMin = isDragging ? drag.endMin : baseEnd
            /*
             * ⚠️ baseStart/baseEnd 来自 layout.blocks，已经是**绘制分钟**，
             *    只能用 yOfDrawn；拖动中的 drag.startMin 是**真实分钟**，
             *    要先经 toDrawn 换算。两者混用会让块在开始拖动的一瞬间跳位。
             *    高度在拖动时按「时长 × 每小时像素」算，
             *    这样框的大小只取决于时长，不会被撑高区域拉变形。
             */
            const top = isDragging ? yOfReal(startMin) : yOfDrawn(startMin)
            const height = Math.max(
              18,
              isDragging
                ? ((endMin - startMin) / 60) * hourHeight
                : yOfDrawn(endMin) - yOfDrawn(startMin)
            )
            const isConflict = conflicts.has(b.id)
            const isPending = b.pending === true

            return (
              <div
                key={b.id}
                className={styles.block}
                data-cat={b.category}
                data-conflict={isConflict ? 'true' : 'false'}
                data-selected={selectedId === b.id ? 'true' : 'false'}
                data-kind={b.kind}
                data-pending={isPending ? 'true' : 'false'}
                /*
                 * ⭐ 一律**整宽单列**绘制。
                 *    早先是重叠就左右分栏（layoutColumns），但那样每个块只有半宽，
                 *    25 分钟的番茄计划块会被挤到连标题都放不下。
                 *    现在重叠一律靠上下排列解决（见 layoutTimelineDisplay），
                 *    框始终保持内容放得下的尺寸 —— 用户明确要求「框子大小要一致」。
                 */
                style={{ top, height, left: 3, right: 3 }}
                onClick={() => onSelect(b.id)}
                onDoubleClick={() => onEdit(b.id)}
                /*
                 * ⭐ 右键 → 指针位置弹出菜单（编辑 / 删除…）。
                 *    必须 preventDefault 掉 Chromium 的原生右键菜单，
                 *    否则会和我们的菜单叠在一起。
                 */
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onSelect(b.id)
                  onContextMenuBlock(b.id, e.clientX, e.clientY)
                }}
              >
                {isConflict && (
                  <span className={styles.conflictBadge} title={t('时间冲突')}>
                    <IconWarn size={11} />
                  </span>
                )}

                <div
                  className={styles.blockBody}
                  onMouseDown={(e) => {
                    // 只允许左键拖动，避免和右键菜单冲突
                    if (e.button !== 0) return
                    e.stopPropagation()
                    onSelect(b.id)
                    /*
                     * ⚠️ 基准必须取**画出来的**位置（baseStart），不能用 b.startMin。
                     *    待确认块与已有安排撞车时会被下移绘制，若用真实 startMin 当基准，
                     *    方块会在按下的瞬间「跳」回原位，之后一路带着这段偏移量走 ——
                     *    用户怎么拖都挪不到想去的地方（实测反馈「移不到同一时间段」）。
                     *    避让前后时长不变，所以 endMin 的差值仍然可靠。
                     */
                    setDrag({
                      id: b.id,
                      mode: 'move',
                      grabOffset: minutesFromClientY(e.clientY) - baseStart,
                      startMin: baseStart,
                      endMin: baseEnd,
                      originStart: baseStart,
                      originEnd: baseEnd
                    })
                  }}
                >
                  <span className={styles.blockTitle}>{b.title}</span>
                  <span className={styles.blockTime}>
                    {/*
                     * ⚠️ 文字显示的是**真实时间**，不是绘制位置。
                     *    同一时段放两个事件时，第二个会被下移绘制（否则两个框叠在一起看不清），
                     *    但它的真实时间仍然是 09:00–10:00 —— 若跟着绘制位置显示成 10:00–11:00，
                     *    用户会以为「没放进同一时间段」（实测反馈）。
                     *    拖动过程中会实时跟随指针，方便对位。
                     */}
                    {isDragging
                      ? `${minutesToTime(startMin)}–${minutesToTime(endMin)}`
                      : `${minutesToTime(b.startMin)}–${minutesToTime(b.endMin)}`}
                    {b.kind === 'plan' && t(' · 计划')}
                    {b.repeat !== 'none' && t(' · 重复')}
                  </span>
                </div>

                {/* 待确认：右侧空心圆，点掉才算正式排定 */}
                {isPending && (
                  <div className={styles.blockSide}>
                    <ConfirmDot
                      pending
                      confirming={confirmingId === b.id}
                      onConfirm={() => onConfirmPending(b.id)}
                      title={t('点击确认这条日程')}
                    />
                  </div>
                )}

                {/* 底部 8px 把手：调整时长，最短 15 分钟 */}
                <div
                  className={styles.resizeHandle}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    setDrag({
                      id: b.id,
                      mode: 'resize',
                      grabOffset: 0,
                      startMin: b.startMin,
                      endMin: b.endMin,
                      originStart: b.startMin,
                      originEnd: b.endMin
                    })
                  }}
                />
              </div>
            )
          })}

          {/* 拖入提示线 */}
          {dropHint !== null && (
            <div className={styles.dropHint} style={{ top: yOfReal(dropHint) }}>
              <span>{minutesToTime(dropHint)}</span>
            </div>
          )}

          {/*
            当前时间指示线：非今天隐藏。
            时刻标签不在这里 —— 它挂在左侧刻度列上（见上面的 .nowLabel），
            放在这条线上会直接压住事件块的标题与时间。
          */}
          {isToday && (
            <div className={styles.nowLine} style={{ top: yOfReal(nowMin) }}>
              <span className={styles.nowDot} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 当前时刻，单位分钟，**带秒的小数**。
 * ⚠️ 必须带小数：整数分钟会让「当前时间线」每分钟跳一格，
 *    做不到用户要的「实时移动」。
 */
function currentMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

export { timeToMinutes, CATEGORY_LABEL }
