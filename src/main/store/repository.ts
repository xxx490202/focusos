// ============================================================
//  repository.ts — 主进程 JSON 文件存储
// ============================================================
//  · 原子写：writeFileSync(tmp) → renameSync(tmp, target)
//  · 写入节流 500ms，避免拖拽时高频落盘
//  · schemaVersion + migrate() 迁移函数链
//  · 不引入 better-sqlite3 等原生模块
// ============================================================
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { zPersistedData, type PersistedDataPayload } from '@shared/ipc-contract'
import { SCHEMA_VERSION, defaultSettings, emptyData, mergeDeep } from '@shared/defaults'
import type { PersistedData, DailyStat } from '@shared/types'
import { logger } from './logger'

const FILE_NAME = 'focusos-data.json'
const THROTTLE_MS = 500

function dataDir(): string {
  return app.getPath('userData')
}

function dataFile(): string {
  return join(dataDir(), FILE_NAME)
}

/**
 * 旧版 Python 版番茄钟的数据文件。
 * macOS:~/.pomodoro_stats.json；Windows: %USERPROFILE%\.pomodoro_stats.json
 * 同一逻辑，用 homedir() 即可覆盖两平台（禁止手写路径拼接）。
 */
function legacyStatsFile(): string {
  return join(homedir(), '.pomodoro_stats.json')
}

// ============================================================
//  迁移函数链
// ============================================================
//  每个函数负责把 fromVersion 的数据升级到 fromVersion+1。
//  新增版本时在此追加，并在 migrate() 中串联。
type Migration = (data: Record<string, unknown>) => Record<string, unknown>

const MIGRATIONS: Record<number, Migration> = {
  // 示例（保留位，说明迁移写法）：
  // 1: (d) => ({ ...d, planBlocks: d.planBlocks ?? [] })
}

function migrate(
  input: Record<string, unknown>,
  fromVersion: number
): { data: Record<string, unknown>; toVersion: number } {
  let data = input
  let version = fromVersion
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (step) {
      data = step(data)
      logger.info(`迁移 schemaVersion ${version} → ${version + 1}`)
    }
    version++
  }
  return { data, toVersion: version }
}

// ============================================================
//  校验：失败时回退到空数据，绝不破坏用户现有文件
// ============================================================
function coerce(raw: unknown): { data: PersistedData; migrated: boolean; invalid: boolean } {
  if (typeof raw !== 'object' || raw === null) {
    return { data: emptyData(), migrated: false, invalid: false }
  }
  const obj = raw as Record<string, unknown>
  const fromVersion = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1

  let working = obj
  let migrated = false
  if (fromVersion !== SCHEMA_VERSION) {
    const r = migrate(obj, fromVersion)
    working = r.data
    migrated = r.toVersion !== fromVersion
  }

  const parsed = zPersistedData.safeParse({
    ...working,
    // 缺字段时用默认值补齐，避免旧文件直接打不开
    tasks: working.tasks ?? [],
    planBlocks: working.planBlocks ?? [],
    sessions: working.sessions ?? [],
    dailyStats: working.dailyStats ?? [],
    habits: working.habits ?? [],
    /*
     * ⚠️ 必须**深合并**。Settings 里有嵌套对象（background / durations /
     *    notifications / dnd），浅合并会让旧文件的 background 整体盖掉默认值，
     *    导致新版本给 background 追加的字段（如 rotate / order）在旧文件里缺失，
     *    zod 校验失败 → 用户数据被当成损坏并回退成空数据。
     */
    settings: mergeDeep(defaultSettings(), working.settings)
  })

  if (!parsed.success) {
    logger.error('数据校验失败，回退为空数据', parsed.error.issues)
    return { data: emptyData(), migrated: false, invalid: true }
  }
  return { data: parsed.data as PersistedData, migrated, invalid: false }
}

// ============================================================
//  旧版 ~/.pomodoro_stats.json 迁移（F11）
//  { '2026-10-14': 3 } → DailyStat[]
//  只读不删原文件；不存在则静默跳过
// ============================================================
function migrateLegacyStats(): { stats: DailyStat[]; migrated: boolean } {
  const p = legacyStatsFile()
  if (!existsSync(p)) return { stats: [], migrated: false }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null) return { stats: [], migrated: false }

    const stats: DailyStat[] = []
    for (const [date, count] of Object.entries(raw as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      const n = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, count) : 0
      if (n === 0) continue
      stats.push({ date, focusCount: n, focusSeconds: n * 25 * 60, tasksDone: 0 })
    }
    if (stats.length > 0) {
      logger.info(`已从旧版统计文件迁移 ${stats.length} 天记录（原文件保留）`)
    }
    return { stats, migrated: stats.length > 0 }
  } catch (err) {
    logger.warn('旧版统计文件读取失败，已跳过', err)
    return { stats: [], migrated: false }
  }
}

// ============================================================
//  Repository
// ============================================================
class Repository {
  private cache: PersistedData | null = null
  private pending: PersistedData | null = null
  private timer: NodeJS.Timeout | null = null
  private legacyMigrated = false
  /**
   * rename 是否可用。首次 rename 失败（EPERM）后本会话永久降级为直写，
   * 避免每次落盘都重试一次注定失败的操作、刷屏日志。
   */
  private renameAvailable = true

  /** 读取（带内存缓存），损坏文件自动备份后重建 */
  read(): PersistedData {
    if (this.cache) return this.cache

    // 首次读取时清掉上次残留的 .tmp（rename 失败时会留下，属于垃圾文件）
    this.cleanupTmp()

    const file = dataFile()
    if (!existsSync(file)) {
      const fresh = emptyData()
      // 首次启动：尝试导入旧版统计
      const legacy = migrateLegacyStats()
      if (legacy.migrated) {
        fresh.dailyStats = legacy.stats
        fresh.settings.closeToTray = defaultSettings().closeToTray
        this.legacyMigrated = true
      }
      this.cache = fresh
      this.scheduleWrite(fresh)
      return fresh
    }

    try {
      const text = readFileSync(file, 'utf8')
      const { data, migrated, invalid } = coerce(JSON.parse(text))
      /*
       * ⭐ 校验失败必须先备份原文件，再回退空数据。
       *    否则本会话里任何一次写盘（改设置 / 退出前 flushNow）都会把
       *    空数据覆盖到用户文件上 —— 用户的任务曾这样静默消失：
       *    导出文件还留着 4 条任务，live 文件已变成空数据。
       *    备份成 *.corrupt-<时间戳> 与 JSON 解析失败的路径保持一致。
       */
      if (invalid) this.backupCorrupt()
      if (migrated) this.scheduleWrite(data)
      this.cache = data
      return data
    } catch (err) {
      logger.error('数据文件损坏，已备份并重建', err)
      this.backupCorrupt()
      const fresh = emptyData()
      this.cache = fresh
      this.scheduleWrite(fresh)
      return fresh
    }
  }

  /** 备份损坏文件，避免用户数据被静默覆盖 */
  private backupCorrupt(): void {
    try {
      const file = dataFile()
      if (!existsSync(file)) return
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      renameSync(file, `${file}.corrupt-${stamp}`)
    } catch (err) {
      logger.warn('损坏文件备份失败', err)
    }
  }

  getLegacyMigrated(): boolean {
    return this.legacyMigrated
  }

  /** 写入（节流 500ms） */
  write(data: PersistedData): void {
    this.cache = data
    this.scheduleWrite(data)
  }

  private scheduleWrite(data: PersistedData): void {
    this.pending = data
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      const target = this.pending
      this.pending = null
      if (target) this.flush(target)
    }, THROTTLE_MS)
  }

  /** 立即落盘（退出前调用） */
  flushNow(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const target = this.pending ?? this.cache
    this.pending = null
    if (target) this.flush(target)
  }

  private flush(data: PersistedData): void {
    const file = dataFile()
    const text = JSON.stringify(data, null, 2)

    try {
      mkdirSync(dirname(file), { recursive: true })
    } catch (err) {
      logger.error('数据目录创建失败，本次改动未能落盘', err)
      return
    }

    // ---- 首选：原子写（tmp → rename） ----
    if (this.renameAvailable) {
      const tmp = `${file}.tmp`
      let wrote = false
      try {
        writeFileSync(tmp, text, 'utf8')
        wrote = true
      } catch (err) {
        logger.error('临时文件写入失败', err)
      }
      if (wrote) {
        try {
          renameSync(tmp, file)
          return
        } catch (err) {
          /*
           * ⭐ 实测：部分受限环境里 renameSync 抛 EPERM（writeFileSync 仍可用）。
           *   这正是此前「用户数据整段丢失」的根因 —— 旧代码在这里直接放弃，
           *   只留下一个 .tmp 残留，本次会话新建的任务与统计退出后全没了。
           *
           *   现在的处理：本会话永久降级为直写（不再反复重试 → 不刷日志、
           *   不做无谓 IO），并把临时文件清掉避免残留。
           */
          this.renameAvailable = false
          logger.warn(
            '原子 rename 不可用（EPERM），本会话改用直写保存',
            (err as NodeJS.ErrnoException).code
          )
          this.cleanupTmp()
        }
      }
    }

    // ---- 兜底：直接写目标文件 ----
    /*
     * 保命优先于原子性。直写在极端情况下可能写出半截文件，
     * 但 coerce() 对损坏文件有「备份 + 重建」兜底，
     * 总好过数据凭空消失。
     */
    try {
      writeFileSync(file, text, 'utf8')
    } catch (err) {
      logger.error('数据写入彻底失败，本次改动未能落盘', err)
    }
  }

  /** 全量替换（导入用） */
  replace(data: PersistedData): void {
    this.cache = data
    this.pending = data
    this.flushNow()
  }

  /** 清空全部数据 */
  clear(): void {
    this.replace(emptyData())
  }

  filePath(): string {
    return dataFile()
  }

  dirPath(): string {
    return dataDir()
  }

  /** 导出文件路径（focusos-export-YYYYMMDD.json） */
  exportPath(fileName: string): string {
    return join(dataDir(), fileName)
  }

  /** 校验导入数据，失败抛中文错误且不破坏现有数据 */
  parseImport(text: string): PersistedData {
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new Error('文件不是合法的 JSON，无法导入')
    }
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('文件内容不是有效的 FocusOS 数据')
    }
    const obj = raw as Record<string, unknown>
    if (!('tasks' in obj) && !('dailyStats' in obj)) {
      throw new Error('文件缺少 tasks / dailyStats 字段，可能不是 FocusOS 导出的数据')
    }
    const { data, invalid } = coerce(obj)
    /*
     * ⭐ 校验不过就拒绝导入，绝不能返回空数据 ——
     *    导入路径紧接着就是 replace() 全量落盘，
     *    返回空数据等于「导入一个坏文件 = 清空自己的数据」。
     */
    if (invalid) throw new Error('文件校验未通过，可能来自不兼容的版本，已拒绝导入')
    return data
  }

  /** 删除临时文件残留 */
  cleanupTmp(): void {
    try {
      const tmp = `${dataFile()}.tmp`
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      // 忽略
    }
  }
}

export const repository = new Repository()

/** zod 校验导出结构，供 sys:export 复用 */
export const zExportPayload = zPersistedData

export type { PersistedDataPayload }
