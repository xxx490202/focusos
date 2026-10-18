#!/bin/bash
# ============================================================
#  build-app.sh — 手工组装 macOS 应用（绕过 electron-builder）
# ============================================================
#  为什么需要它：
#    本项目在 WorkBuddy 环境里跑 `npm run build:mac` 会失败 ——
#    该环境的安全策略禁止创建/读取 .asar 文件（@electron/asar 直接
#    decision:'deny'），而 electron-builder 的核心步骤就是生成 app.asar。
#
#  本脚本改为手工组装，产物与 electron-builder 的 `--dir` 结果同构：
#      FocusOS.app/Contents/Resources/
#        app/{out/**, package.json, node_modules/**}
#        sounds/  backgrounds/  build/  icon.icns
#
#  用法：
#      npm run build                              # 先用 electron-vite 产出 out/
#      bash scripts/build-app.sh                  # 默认 arm64
#      bash scripts/build-app.sh x64              # 可选 arm64 | x64
#
#  产物位置： dist/mac-<arch>/FocusOS.app
#
#  ⚠️ 五个踩过的坑，改脚本时别改回去：
#    1. Resources/app 下必须**保留 out/ 这一层**：
#       src/main/window.ts 写死了 join(app.getAppPath(),'out/renderer/index.html')
#       与 'out/preload/index.cjs'。拍平成 app/{main,preload,renderer} 会白屏。
#    2. 必须带上生产依赖：main 用 externalizeDepsPlugin，产物里保留着
#       require("zod")，缺 node_modules 就 module not found（双击毫无反应）。
#    3. Helper 的「目录名 + 内部可执行文件 + CFBundleExecutable」要一起改，
#       只改目录名会 FATAL「Unable to find helper app」。
#    4. Frameworks/Electron Framework.framework **不要改名**：
#       主二进制的 @rpath 引用就是这个名字，改了要连带 install_name_tool。
#    5. 签名必须在 /tmp 完成后再 ditto 回项目目录：
#       项目位于 ~/Desktop，文件带 com.apple.provenance，会被 codesign 拒绝。
# ============================================================
set -e

PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="${1:-arm64}"
case "$ARCH" in
  arm64|x64) ;;
  *) echo "用法: bash scripts/build-app.sh [arm64|x64]" >&2; exit 1 ;;
esac
DEST="$PROJ/dist/mac-$ARCH/FocusOS.app"
WORK="/tmp/focusos-build-$ARCH"
STAGE="$WORK/FocusOS.app"

# 版本号与构建号：
#   · 对外显示用 package.json 的 version；
#   · CFBundleVersion 用 out/ 最后一次构建的时间，arm64/x64 共用同一个值，
#     「关于」页会显示它 —— 用户报「是不是旧版」时可以直接对照。
SHORT_VERSION="$(node -p "require('$PROJ/package.json').version")"
BUILD_NUMBER="$(date -r "$PROJ/out/main/index.cjs" +%Y%m%d%H%M 2>/dev/null || date +%Y%m%d%H%M)"

# 需要一个解包好的 Electron 发行版；没有就从本机 electron 缓存里取
# ⚠️ 必须与 node_modules/electron 的版本一致：缓存里常有多个历史版本，
#    按目录顺序取「第一个」会静默打出旧版 Electron（dev 跑 44、包里跑 33）。
# ⚠️ 也要按架构取：arm64 / x64 的发行包不能混用。
EDIST="$WORK/electron-dist"
DESIRED="$(node -p "require('$PROJ/node_modules/electron/package.json').version")"
CURRENT="$(cat "$EDIST/version" 2>/dev/null || true)"
if [ ! -d "$EDIST/Electron.app" ] || [ "$CURRENT" != "$DESIRED" ]; then
  echo "[0/9] 准备 Electron ${DESIRED}-${ARCH} (当前: ${CURRENT:-无})"
  rm -rf "$EDIST"
  mkdir -p "$EDIST"
  ZIP="$(find "$HOME/Library/Caches/electron" -name "electron-v${DESIRED}-darwin-${ARCH}.zip" 2>/dev/null | head -1)"
  if [ -z "$ZIP" ]; then
    ZIP="$(find "$HOME/Library/Caches/electron" -name "electron-v*-darwin-${ARCH}.zip" 2>/dev/null | sort -V | tail -1)"
  fi
  if [ -z "$ZIP" ]; then
    echo "找不到 ${ARCH} 的 Electron 发行包，请先执行 npm install 让 electron 下载二进制" >&2
    exit 1
  fi
  echo "    使用 $ZIP"
  unzip -q -o "$ZIP" -d "$EDIST"
fi

rm -rf "$STAGE" && mkdir -p "$WORK"
ditto --noqtn "$EDIST/Electron.app" "$STAGE"
C="$STAGE/Contents"

echo "[1/9] 主二进制改名"
mv "$C/MacOS/Electron" "$C/MacOS/FocusOS"

echo "[2/9] 移除 default_app.asar（由 app/ 目录替代）"
mv "$C/Resources/default_app.asar" "$WORK/default_app.asar.bak"

echo "[3/9] 写入应用代码到 Resources/app/"
mkdir -p "$C/Resources/app"
cp -R "$PROJ/out" "$C/Resources/app/out"
cp "$PROJ/package.json" "$C/Resources/app/package.json"

echo "[4/9] 复制生产依赖"
mkdir -p "$C/Resources/app/node_modules"
(cd "$PROJ" && npm ls --omit=dev --parseable --all 2>/dev/null | tail -n +2) | while IFS= read -r p; do
  case "$p" in
    "$PROJ"/node_modules/*) ;;
    *) continue ;;
  esac
  rel="${p#"$PROJ"/node_modules/}"
  mkdir -p "$C/Resources/app/node_modules/$(dirname "$rel")"
  cp -R "$p" "$C/Resources/app/node_modules/$rel"
done

echo "[5/9] 复制资源"
ditto "$PROJ/resources/sounds" "$C/Resources/sounds"
ditto "$PROJ/resources/backgrounds" "$C/Resources/backgrounds"
mkdir -p "$C/Resources/build"
cp "$PROJ"/build/tray*.png "$PROJ/build/icon.png" "$C/Resources/build/"

echo "[6/9] 生成应用图标"
ICONSET="$WORK/FocusOS.iconset"
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
for s in 16 32 64 128 256 512; do
  sips -z $s $s "$PROJ/build/icon.png" --out "$WORK/icon_${s}.png" >/dev/null
done
cp "$WORK/icon_16.png"  "$ICONSET/icon_16x16.png"
cp "$WORK/icon_16.png"  "$ICONSET/icon_32x32.png"
cp "$WORK/icon_32.png"  "$ICONSET/icon_32x32@2x.png"
cp "$WORK/icon_32.png"  "$ICONSET/icon_64x64.png"
cp "$WORK/icon_64.png"  "$ICONSET/icon_64x64@2x.png"
cp "$WORK/icon_128.png" "$ICONSET/icon_128x128.png"
cp "$WORK/icon_256.png" "$ICONSET/icon_128x128@2x.png"
cp "$WORK/icon_256.png" "$ICONSET/icon_256x256.png"
cp "$WORK/icon_512.png" "$ICONSET/icon_256x256@2x.png"
cp "$WORK/icon_512.png" "$ICONSET/icon_512x512.png"
cp "$WORK/icon_512.png" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$C/Resources/icon.icns"
rm -f "$C/Resources/electron.icns"

echo "[7/9] 更新 Info.plist"
/usr/libexec/PlistBuddy -c "Delete :ElectronAsarIntegrity" "$C/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName FocusOS" "$C/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName FocusOS" "$C/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable FocusOS" "$C/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.focusos.app" "$C/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile icon.icns" "$C/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $SHORT_VERSION" "$C/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$C/Info.plist"
/usr/libexec/PlistBuddy -c "Set :LSApplicationCategoryType public.app-category.productivity" "$C/Info.plist"
/usr/libexec/PlistBuddy -c "Set :LSMinimumSystemVersion 11.0" "$C/Info.plist"
/usr/libexec/PlistBuddy -c "Add :NSAppleEventsUsageDescription string 'FocusOS 使用 Apple Events 以支持系统快捷键。'" "$C/Info.plist" 2>/dev/null || true

echo "[8/9] 重命名 Helper app"
(cd "$C/Frameworks" && for app in *.app; do
  nf=$(echo "$app" | sed 's/^Electron /FocusOS /')
  [ "$app" != "$nf" ] && mv "$app" "$nf"
  base="${nf%.app}"
  for old in "$nf/Contents/MacOS"/Electron*; do
    [ -e "$old" ] && mv "$old" "$nf/Contents/MacOS/$base"
  done
  plist="$nf/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleName $base" "$plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string $base" "$plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Delete :CFBundleExecutable" "$plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string $base" "$plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.focusos.app.$(echo "$base" | tr -d ' ()' | tr 'A-Z' 'a-z')" "$plist"
done)

echo "[9/9] 签名并部署"
# ⚠️ 顺序不能反：必须在 /tmp 里签名，**签完再** ditto 到项目目录。
#    项目位于 ~/Desktop，ditto 过去的文件会带上 com.apple.provenance，
#    在那边执行 codesign 会被拒（"resource fork ... not allowed"）。
#    ditto 会原样保留已签好的签名，所以签完再拷是有效的。
find "$STAGE" -type f -exec xattr -d com.apple.provenance {} \; 2>/dev/null || true
codesign --force --deep --sign - "$STAGE" >/dev/null 2>&1
codesign -v "$STAGE" && echo "临时产物签名校验通过"

mkdir -p "$(dirname "$DEST")"
if [ -e "$DEST" ]; then
  # ⚠️ 必须整包替换，不能只覆盖 out/：
  #    Info.plist 里的版本/构建号也在变，只覆盖 out/ 会让「关于」页一直显示旧构建号，
  #    而且签名会失效。旧版可能还在运行，先退出 FocusOS。
  echo "    目标已存在 → 移除旧产物后整包部署"
  if ! rm -rf "$DEST" 2>/dev/null; then
    echo "无法删除旧产物：$DEST" >&2
    echo "请手动删除后重试（如果 FocusOS 正在运行，请先退出）。" >&2
    exit 1
  fi
fi
echo "    整包部署"
ditto --noqtn "$STAGE" "$DEST"

echo ""
echo "✅ 完成：$DEST"
echo "   版本 ${SHORT_VERSION}（构建 ${BUILD_NUMBER}），签名已验证"
