# FocusOS

> 把「今天要做什么」和「现在正在做什么」统一管理的时间容器。

一个基于 Electron 的桌面番茄钟 + 日程管理应用，**同一套源码同时适配 macOS 与 Windows**。  
无 UI 组件库、无 CSS 框架、无图表库、无原生模块 —— 界面、图表、图标全部手写。

---

## 目录

- [快速开始](#快速开始)
- [安装包下载](#安装包下载)
- [功能总览](#功能总览)
- [快捷键总览](#快捷键总览)
- [数据文件位置](#数据文件位置)
- [主题机制](#主题机制)
- [双平台差异说明](#双平台差异说明)
- [常见问题](#常见问题)
- [项目结构](#项目结构)

---

## 快速开始

环境要求：**Node.js ≥ 18**（推荐 20 LTS）、npm 9+。

```bash
git clone https://github.com/xxx490202/focusos.git
cd focusos
npm install          # postinstall 会自动生成资源（提示音 + 托盘图标）
npm run dev          # 开发模式：热更新 + DevTools
```

> `npm install` 的 `postinstall` 会执行 `node scripts/gen-assets.mjs && node scripts/gen-tray.mjs`，  
> 合成自带提示音并从 `build/icon.png` 派生托盘图标。这两步是纯 Node 实现  
> （自写 PNG 编解码），**不依赖 `sips` / ImageMagick / 任何原生模块**。

### 全部脚本

| 命令                   | 作用                                              |
| -------------------- | ----------------------------------------------- |
| `npm run dev`        | 启动开发模式（electron-vite dev，主/预加载/渲染三段热更新）         |
| `npm run build`      | 只编译三段产物到 `out/`，不打安装包                           |
| `npm start`          | 预览已编译产物（`electron-vite preview`，等价于生产渲染路径）      |
| `npm run typecheck`  | `tsc --noEmit` 分别校验主进程与渲染层两份 tsconfig           |
| `npm test`           | 跑全部单元测试（vitest）                                 |
| `npm run test:watch` | 测试监听模式                                          |
| `npm run gen:assets` | 重新生成提示音 + 托盘图标                                  |
| `npm run gen:icon`   | 从 `FocusOS.icns` 重新提取 `build/icon.png`（仅换图标时需要） |
| `npm run build:mac`  | 打包 macOS：dmg + zip（arm64 / x64 各一份）             |
| `npm run build:win`  | 打包 Windows：NSIS 安装版 + portable 便携版（x64）         |
| `npm run build:dir`  | 只产出未压缩目录（快速验证打包结果，不打安装包）                        |

> ⚠️ **不要用 `npx electron .` 直接启动。** 该方式缺少 vite 注入的 `ELECTRON_RENDERER_URL`，  
> 主进程会去加载未经转换的 `src/renderer/index.html`，页面必然白屏。  
> 开发请用 `npm run dev`，验证编译产物请用 `npm start` 或 `npm run build:dir` 后打开产出的 app。

---

## 安装包下载

正式产物由 GitHub Actions 构建（见 `.github/workflows/release.yml`），  
打 `v*` tag 后自动产出并上传到 **Releases** 页面：

| 平台               | 产物                                          | 适用机型                              |
| ---------------- | ------------------------------------------- | --------------------------------- |
| macOS (Apple 芯片) | `focusos-1.0.0-mac-arm64.dmg` / `.zip`      | M1 / M2 / M3 / M4 等 Apple Silicon |
| macOS (Intel)    | `focusos-1.0.0-mac-x64.dmg` / `.zip`        | Intel 处理器 Mac                     |
| Windows (x64)    | `focusos-1.0.0-win-x64-setup.exe`（NSIS 安装版） | 常规安装，可选安装目录、建桌面快捷方式               |
| Windows (x64)    | `focusos-1.0.0-win-x64-portable.exe`（便携版）   | 免安装，双击即用                          |

**怎么选**：macOS 上「关于本机 → 芯片」若显示 Apple M* 就下 `arm64`，显示 Intel 就下 `x64`；  
不确定时 `.zip` 与 `.dmg` 内容一致，`.dmg` 拖拽安装更直观。

本地自行打包：

```bash
npm run build:mac   # 产物在 dist/
npm run build:win
```

> CI 上的签名密钥通过 Repository Secrets 注入（`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、  
> `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`、`WIN_CSC_LINK`、  
> `WIN_CSC_KEY_PASSWORD`），**仓库内不含任何证书**。  
> 本地未配置证书时 `electron-builder.yml` 里 `identity: null` 会跳过签名，  
> 产物可直接运行，但首次打开会被系统提示见[常见问题](#常见问题)。

---

## 功能总览

| 编号  | 功能              | 说明                                                                            |
| --- | --------------- | ----------------------------------------------------------------------------- |
| F1  | **计时引擎**        | 工作 / 短休息 / 长休息三阶段循环；**零漂移**（一律用 `endsAt - Date.now()` 求差，绝不 `remaining -= 1`） |
| F2  | **专注视图 + 背景模式** | 环形进度、大字号时钟、背景图轮播、遮罩与模糊、自动文字对比色                                                |
| F3  | **日程数据模型**      | 任务块支持拖拽、缩放、**15 分钟吸附**、重叠冲突检测与提示                                              |
| F4  | **任务与收件箱**      | 优先级 / 分类 / 标签 / 清单 / 预估番茄数 / 完成度；自然语言快速添加（`明天下午3点开会 2个番茄 #工作 重要`）             |
| F5  | **日视图时间轴**      | 24 小时纵向时间轴，双击空白新建，冲突块并列布局                                                     |
| F6  | **生成番茄计划**      | ⭐ 核心差异化：按任务预估番茄数，自动在空闲时段排布「专注 + 休息」序列，预览确认后写入                                 |
| F7  | **周视图**         | 7 列 × 24 小时完整时间网格；表头标注「周一…周日 + 日期」；左上角时间格点开**日历面板**（年/月步进、5 个月可滚动、选中周 7 天蓝色高亮） |
| F8  | **洞察统计**        | 手写 SVG 图表：番茄趋势、时段分布、任务完成率、连续天数                                                |
| F9  | **系统集成**        | 菜单栏 / 托盘常驻、标题实时显示剩余时间、全局快捷键、系统通知、开机自启、单实例锁、睡眠唤醒校正                             |
| F10 | **设置页**         | 主题 / 计时 / 日程 / 提醒 / 数据 / 关于 六组；快捷键文案按平台渲染按键符号                                 |
| F11 | **数据持久化**       | JSON 单文件存储，原子写入（临时文件 + rename）、500ms 节流、`schemaVersion` 迁移链、损坏文件自动备份          |
| F12 | **空状态与打磨**      | 每处空列表都有插画式空状态；首启引导；`CmdOrCtrl+/` 快捷键速查面板                                      |

### 计时精度设计

- 主进程内存是**唯一权威状态**，渲染层只做展示，不参与计算。
- 阶段结束时间以绝对时间戳 `endsAt` 记录，任何时刻的剩余时间 = `endsAt - Date.now()`。
- 系统睡眠 / 休眠后唤醒会走 `runCatchUp()`：用**绝对时间游标**逐阶段回放，  
  跨过的阶段全部补响提示音，而不是从「现在」重新计时。
- 阶段归零 → 响铃 → 500ms 后切阶段，双击开始不会产生竞态。

---

## 快捷键总览

按键符号由 `src/shared/platform.ts` 的 `keyLabel()` 渲染，两平台各显示自己的符号。

### 全局快捷键（应用在后台也生效）

| 功能      | macOS       | Windows            |
| ------- | ----------- | ------------------ |
| 开始 / 暂停 | `⌘ ⇧ Space` | `Ctrl Shift Space` |
| 全屏专注    | `⌘ ⇧ F`     | `Ctrl Shift F`     |
| 新建任务    | `⌘ ⇧ N`     | `Ctrl Shift N`     |
| 今日日程    | `⌘ ⇧ D`     | `Ctrl Shift D`     |

> 若某个组合已被系统或其它应用占用，注册会失败并**降级为仅窗口内生效**，  
> 设置页会标红提示。底层一律使用 `CmdOrCtrl` 前缀，不做平台分支。

### 窗口内快捷键

| 功能        | 按键               | 说明           |
| --------- | ---------------- | ------------ |
| 开始 / 暂停   | `Space`          |              |
| 重置当前阶段    | `R`              |              |
| 立即进入休息    | `B`              |              |
| 跳过当前阶段    | `S`              |              |
| 全屏 / 窗口切换 | `F`              |              |
| 返回 / 关闭弹层 | `Esc`            | 全屏与本窗口之间来回切换 |
| 新建任务      | `N`              |              |
| 搜索        | `/`              |              |
| 切换深 / 浅主题 | `T`              |              |
| 快捷键速查面板   | `⌘ /` 或 `Ctrl /` |              |

> **所有单键快捷键在输入框 / 文本域聚焦时自动失效**（`Esc` 与 `⌘ /` 除外），  
> 因此不会干扰任务标题、搜索等文字输入。

---

## 数据文件位置

应用数据统一存为单个 JSON 文件，便于备份与迁移。

| 平台      | 路径                                                        |
| ------- | --------------------------------------------------------- |
| macOS   | `~/Library/Application Support/focusos/focusos-data.json` |
| Windows | `%APPDATA%\focusos\focusos-data.json`                     |

在文件管理器地址栏粘贴 `%APPDATA%\focusos` 即可直达（Windows）。

**设置页 → 数据 → 打开数据目录** 可直接唤起系统文件管理器定位该目录  
（走 Electron 的 `shell.openPath`，两平台一致）。

### 文件结构

```jsonc
{
  "schemaVersion": 1,
  "tasks": [],       // 任务
  "planBlocks": [],  // 日程时间块
  "sessions": [],    // 每次计时会话
  "dailyStats": [],  // 每日聚合统计
  "settings": {}     // 全部设置
}
```

- 写入采用**原子替换**：先写 `focusos-data.json.tmp`，再 `rename`，断电不会写坏原文件。
- 文件损坏时会自动重命名为 `.corrupt-<时间戳>` 备份，然后以空数据启动，**不会静默丢数据**。
- 从旧版本 Python 脚本的 `~/.pomodoro_stats.json` 会自动迁移（只读读取，原文件保留不动）。

**手动备份**：直接复制上面那个 JSON 文件即可；设置页也提供 **导出 / 导入 JSON**，  
导出内容可原样重新导入且数据完全一致。

---

## 主题机制

支持四种模式：**浅色 / 深色 / 跟随系统 / 日落自动切换**。

- 颜色全部走**语义令牌**（`--bg`、`--surface`、`--text-1/2/3`、`--accent`、`--warning` …），  
  组件里**不写死任何颜色值** —— 连按钮上的白字都用 `--on-solid`，不用裸 `#fff`。
- **全部语义色对每种表面底色的对比度 ≥ 4.5:1（WCAG AA 正文标准），两套主题都满足**，  
  由 `tests/contrast.test.ts` 锁死。基准取**最不利底色**（浅色主题取最暗的 `--bg`），  
  只对着纯白调会漏掉约 0.4 的差距。
- `--on-solid` 是「压在实心语义色上的前景色」：浅色主题的色块足够深，取白；  
  深色主题的色块是为暗底设计的亮色，必须取近黑 —— 否则白字压上去只有 1.41–3.65:1。
- 主题通过 `<html data-theme="light|dark">` 切换，**只改属性、不整页 reload**，  
  因此没有白闪。`index.html` 上预置了 `data-theme="dark"` 作为首帧兜底色。
- 系统主题变化由主进程 `nativeTheme` 监听后推送给渲染层，渲染层不直接读系统。
- 「日落自动切换」按两个时间点（默认 20:00 入深色、07:00 回浅色）在渲染层计算，  
  设置页提供实时预览小样条。
- 背景图模式支持多图轮播、遮罩强度、模糊半径、暗角与自动文字对比色，  
  退出后界面完整恢复。
- 全局遵守 `prefers-reduced-motion`，动效自动降级。

---

## 双平台差异说明

**所有平台差异都收敛在 `src/shared/platform.ts` 一个文件里。**  
组件、业务逻辑、样式表中不出现 `process.platform` / `isMac` / `.icns` / `AppData` 等字样。

| 差异点      | macOS                                                    | Windows                                         |
| -------- | -------------------------------------------------------- | ----------------------------------------------- |
| 窗口装饰     | `titleBarStyle: 'hiddenInset'` + 毛玻璃 vibrancy；为红绿灯留 78px | `titleBarOverlay` 自绘按钮，`symbolColor` 随主题变化；无留白  |
| 菜单栏 / 托盘 | **Template 变体** + `setTemplateImage(true)`，系统自动反色        | 彩色图标，深浅两套跟随主题切换                                 |
| 托盘标题     | 显示完整 `🍅 24:31`，3 秒刷新                                    | 任务栏空间紧张，只显示分钟数 `🍅 25m`，5 秒刷新（更省电）              |
| 关闭窗口     | 默认**留在菜单栏**继续计时                                          | 默认**关窗即退出**                                     |
| 系统术语     | 「菜单栏」「睡眠」                                                | 「托盘」「休眠」                                        |
| 唤醒事件     | `powerMonitor` 的 `suspend` / `resume`                    | 只有 `lock-screen` / `unlock-screen`，作为近似触发点      |
| 按键符号     | `⌘` `⌥` `⇧`                                              | `Ctrl` `Alt` `Shift`                            |
| 字体栈      | `-apple-system` / `SF Pro Text` / `PingFang SC`          | `Segoe UI Variable Text` / `Microsoft YaHei UI` |
| 侧栏材质     | 原生 vibrancy 毛玻璃                                          | Win11 (build ≥ 22000) 用 `acrylic`，Win10 优雅降级为纯色 |
| 提示音      | 统一使用自带 `chime.wav`                                       | 同左（**不依赖 `/System/Library/Sounds`**）            |
| 托盘图标渲染尺寸 | 16pt（显式 `resize`，否则 44px 素材会被当成 44pt 撑爆菜单栏）              | 16px                                            |

> 「关闭窗口」的默认值本身就完成了平台适配 —— `defaults.ts` 里写的是  
> `closeToTray: defaultCloseToTray()`，由 `platform.ts` 返回平台值，  
> 而不是在业务代码里做 `if` 判断。

---

## 常见问题

### Windows：首次运行被 SmartScreen / 安全软件拦截

正式发布版应带代码签名证书；未签名的自建产物首次运行会被拦截，这是系统行为而非应用问题。

- **SmartScreen 弹窗**：点「更多信息」→「仍要运行」。
- **被静默拦截**：右键 exe →「属性」→ 勾选「解除锁定」→「确定」，再运行。
- **企业安全软件误报**：将 `focusos-*-setup.exe` 或安装后的整个目录加入信任白名单。
- 便携版（portable）同样适用上述步骤。

### macOS：提示「无法打开，因为来自身份不明的开发者」

自建未签名产物：

```bash
# 方式一：右键 App →「打开」→ 在弹窗中再次点「打开」（只需一次）
# 方式二：命令行移除隔离属性
xattr -dr com.apple.quarantine /Applications/FocusOS.app
```

### 界面全白 / 全黑，什么都没有

这类问题几乎都出在**启动方式**上：

- 开发调试请用 `npm run dev`，**不要**直接 `npx electron .`（缺少 vite 注入的开发服务器地址）。
- 验证打包产物请先 `npm run build`，再 `npm start`，或直接打开 `npm run build:dir` 产出的 app。
- 若打开安装后的应用仍白屏，请到「设置 → 关于」确认版本，并附上  
  `~/Library/Application Support/focusos/`（macOS）或 `%APPDATA%\focusos\`（Windows）  
  下的日志排查。


### 托盘 / 菜单栏图标太大或显示为空白

图标由 `npm run gen:tray` 从 `build/icon.png` 派生，渲染尺寸由
`platform.ts` 的 `trayIconPointSize()` 统一压到 16pt。
若图标异常，执行：

```bash
npm run gen:tray     # 重新派生托盘图标
npm run build        # 重新编译
```

### 全局快捷键没反应

某个组合可能已被系统或其它应用占用。此时应用会**自动降级为窗口内快捷键**，
并在设置页标红提示。换一个组合或关闭冲突应用的快捷键即可。

### 睡眠 / 休眠后计时不准

计时不依赖 `setInterval` 累加，唤醒后会按绝对时间戳回放所有跨过的阶段，
剩余时间误差在 1 秒以内，并补响漏掉的提示音。若发现异常请反馈系统版本与睡眠时长。

---

## 项目结构

```
focusos/
├── electron.vite.config.ts         # 主 / 预加载 / 渲染三段构建配置
├── electron-builder.yml            # ⭐ macOS 与 Windows 双平台打包配置
├── .github/workflows/release.yml   # ⭐ 双平台 CI 构建矩阵
├── build/                          # 构建期资源（必须提交）
│   ├── icon.png                    #   1024×1024 唯一源图，构建时自动生成 .icns / .ico
│   ├── trayTemplate.png            #   macOS 菜单栏 Template 变体
│   ├── trayWin-light/dark.png      #   Windows 托盘深浅两套
│   └── entitlements.mac.plist      #   macOS 签名与沙箱
├── resources/                      # 运行期资源，打包进产物
│   ├── sounds/chime.wav            #   自带提示音（两平台一致）
│   └── backgrounds/                #   内置背景图
├── scripts/                        # 纯 Node 资源流水线
│   ├── gen-assets.mjs              #   合成提示音
│   ├── gen-tray.mjs                #   派生托盘图标（自写 PNG 编解码）
│   └── extract-icon.mjs            #   从 .icns 提取 1024 源图
├── src/
│   ├── shared/                     # 主进程与渲染层共用（禁止 import electron）
│   │   ├── platform.ts             # ⭐ 全工程唯一的平台差异收敛点
│   │   ├── schedule.ts             #   纯函数：时间↔分钟、重复展开、重叠检测
│   │   ├── smart-parse.ts          #   自然语言快速添加解析
│   │   ├── theme-resolver.ts       #   主题解析（含日落切换）
│   │   ├── ipc-contract.ts         #   通道名常量 + zod 校验（前后端唯一真源）
│   │   ├── types.ts / defaults.ts
│   ├── main/                       # 主进程
│   │   ├── timer/timer-engine.ts   # ⭐ 零漂移计时引擎
│   │   ├── scheduler/plan-generator.ts  # F6 番茄计划生成
│   │   ├── store/repository.ts     #   原子写 + schemaVersion 迁移
│   │   ├── ipc/index.ts            #   全部 IPC handler
│   │   ├── window.ts / tray.ts / theme.ts
│   ├── preload/index.ts            # contextBridge 白名单（完全自包含）
│   └── renderer/                   # React 界面（零 Node 能力）
└── tests/                          # vitest 单测
```

### 工程约束

- 渲染进程**零 Node 能力**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，
  并配置了 CSP。所有文件 / 窗口 / 通知 / 快捷键 / 主题操作都经 `preload` 暴露的白名单方法。
- 主进程**不 import 渲染层**，渲染层**不 import electron**，`shared/` 两边共用且保持纯净。
- 全部 IPC 入参用 **zod** 校验，非法载荷直接拒绝。
- 无 UI 组件库 / CSS 框架 / 图表库 / ORM / 原生数据库；图表与图标全部手写 SVG。

---

## 测试

```bash
npm test
```

共 **169** 条：

| 测试文件                      | 覆盖内容                                                  |
| ------------------------- | ----------------------------------------------------- |
| `timer-engine.test.ts`    | 暂停恢复、归零补齐、跳过阶段、`onWake` 校正、长休息周期                     |
| `schedule.test.ts`        | 时间换算、重复规则展开、重叠检测、跨午夜勿扰时段、**月历网格**                     |
| `plan-generator.test.ts`  | F6 计划生成数量、边界、与已有日程不重叠、勿扰时段规避                         |
| `theme-platform.test.ts`  | 主题解析、日落窗口、**平台能力降级**、红绿灯留白范围                          |
| `smart-parse.test.ts`     | 自然语言解析（时间 / 时长 / 优先级 / 标签）与容错降级                       |
| `contrast.test.ts`        | **语义色对比度 ≥ 4.5:1**、`--on-solid` 配对、主题预览与令牌同步         |
| `backgrounds.test.ts`     | 背景排序「新导入不丢」、不轮播时取第一张、拖拽换位                            |
| `settings-merge.test.ts`  | ⭐ **读档向后兼容**：旧文件缺少新增字段时不能被判损坏（含反例验证浅合并会失败）            |

CI 在 `macos-latest` 与 `windows-latest` 上各跑一遍
`typecheck → test → gen:assets → build → electron-builder --dir`，
双平台问题在提交阶段就会暴露，不会拖到发版。

---

## 许可

MIT
