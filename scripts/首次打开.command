#!/bin/bash
# ============================================================
#  首次打开.command — FocusOS 安装 / 首次启动助手
# ============================================================
#  用法：在 Finder 里双击本文件（不是用终端执行）。
#
#  它做这些事：
#    1. 如果安装包旁边有 FocusOS.app，就把它安装到「应用程序」；
#       已有旧版时先退出旧版再整包替换 —— 防止用户一直跑着旧版本；
#    2. 移除 macOS 给下载文件加上的 com.apple.quarantine 隔离标记；
#    3. 校验 app 的代码签名是否完整；
#    4. 启动 FocusOS。
#
#  为什么需要它：FocusOS 没有 Developer ID 证书、未做公证，
#  macOS 默认会拦截从网络下载的 app；去掉隔离标记后即可正常打开。
# ============================================================

cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
SRC="$HERE/FocusOS.app"
DEST="/Applications/FocusOS.app"

say() { printf '%s\n' "$*"; }
pause() { printf '\n按回车键关闭窗口…'; read -r _ || true; }

read_plist() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null || true
}

say "FocusOS 首次打开助手"
say "————————————————————"

if [ -d "$SRC" ]; then
  say "安装包版本：$(read_plist "$SRC" CFBundleShortVersionString) ($(read_plist "$SRC" CFBundleVersion))"
fi
if [ -d "$DEST" ]; then
  say "已安装版本：$(read_plist "$DEST" CFBundleShortVersionString) ($(read_plist "$DEST" CFBundleVersion))"
fi

# 防止脚本被放在 /Applications 里、源和目标是同一个 app 时误删
SAME_APP=""
if [ -d "$SRC" ] && [ -d "$DEST" ]; then
  SRC_REAL="$(cd "$SRC" && pwd -P 2>/dev/null)"
  DEST_REAL="$(cd "$DEST" && pwd -P 2>/dev/null)"
  [ "$SRC_REAL" = "$DEST_REAL" ] && SAME_APP=1
fi

if [ -d "$SRC" ] && [ -z "$SAME_APP" ]; then
  if [ -d "$DEST" ]; then
    say "正在退出已安装的 FocusOS…"
    osascript -e 'tell application "FocusOS" to quit' >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5; do
      pgrep -f "FocusOS.app/Contents/MacOS/FocusOS" >/dev/null 2>&1 || break
      sleep 1
    done
    if pgrep -f "FocusOS.app/Contents/MacOS/FocusOS" >/dev/null 2>&1; then
      say "FocusOS 仍在运行，请先从菜单栏退出它，然后重新双击本脚本。"
      pause
      exit 1
    fi
    say "正在替换为安装包内的版本…"
    if ! rm -rf "$DEST" 2>/dev/null; then
      say "没有权限替换旧版本。请手动把 FocusOS.app 拖进「应用程序」并选择「替换」。"
      pause
      exit 1
    fi
  fi

  say "正在安装 FocusOS.app 到「应用程序」…"
  if ! ditto --noqtn "$SRC" "$DEST" 2>/dev/null; then
    say "安装失败。请手动把 FocusOS.app 拖进「应用程序」文件夹，然后重新双击本脚本。"
    pause
    exit 1
  fi
elif [ ! -d "$DEST" ]; then
  say "没有找到 FocusOS.app。"
  say "请先把 FocusOS.app 拖进「应用程序」文件夹，再双击本脚本。"
  pause
  exit 1
fi

say "正在移除下载隔离标记…"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

if codesign --verify --deep "$DEST" >/dev/null 2>&1; then
  say "应用完整性校验通过。"
else
  say "⚠️ 应用签名校验失败，可能安装包不完整。"
  say "请重新下载安装包后再试。"
  pause
  exit 1
fi

say "正在启动 FocusOS…"
if open "$DEST"; then
  say "完成。以后可以直接从「应用程序」或程序坞打开 FocusOS。"
else
  say "系统仍然阻止了启动。"
  say "请前往：系统设置 → 隐私与安全性 → 点击「仍要打开」。"
fi

pause
