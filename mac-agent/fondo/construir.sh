#!/bin/zsh
# Compila el ayudante del fondo como mini app de macOS:
#   <destino>/Fondo del asistente.app
#
# Va como .app (y el agente la lanza con `open`) para que macOS la trate como
# responsable de su propio permiso: lee la captura del fondo que guarda el
# sistema dentro de la carpeta de otra app (WallpaperAgent), y macOS puede
# pedir permiso para «acceder a datos de otras apps». Así el aviso sale a
# nombre de «Fondo del asistente» y no de node.
#
# Solo recompila si cambió el código: cada firma nueva haría que macOS
# volviera a pedir el permiso.
set -euo pipefail

ORIGEN="${0:A:h}"
DESTINO="${1:?Uso: construir.sh <carpeta destino>}"
APP="$DESTINO/Fondo del asistente.app"
HUELLA=$(cat "$ORIGEN/fondo.swift" "$ORIGEN/Info.plist" | shasum -a 256 | cut -d' ' -f1)

if [[ -x "$APP/Contents/MacOS/fondo" && "$(cat "$APP/Contents/Resources/huella" 2>/dev/null)" == "$HUELLA" ]]; then
  exit 0
fi

if ! command -v swiftc >/dev/null; then
  echo "Falta swiftc: instala las herramientas de Xcode con  xcode-select --install" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# El SDK más nuevo puede ser de una versión de Swift mayor que la del compilador:
# se prueba del más nuevo al más viejo hasta que uno compile.
compilado=""
for SDK in "" $(ls -d /Library/Developer/CommandLineTools/SDKs/MacOSX[0-9]*.sdk 2>/dev/null | sort -rV); do
  opciones=()
  [[ -n "$SDK" ]] && opciones=(-sdk "$SDK")
  if swiftc "${opciones[@]}" -O -swift-version 5 "$ORIGEN/fondo.swift" -o "$TMP/fondo" 2>"$TMP/errores"; then
    compilado=1
    break
  fi
done
if [[ -z "$compilado" ]]; then
  echo "No se pudo compilar el ayudante del fondo:" >&2
  tail -5 "$TMP/errores" >&2
  exit 1
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
mv "$TMP/fondo" "$APP/Contents/MacOS/fondo"
# Info.plist de la app: el del repo + lo que necesita un bundle sin interfaz.
/usr/libexec/PlistBuddy -x -c "Print" "$ORIGEN/Info.plist" > "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string fondo" \
  -c "Add :CFBundlePackageType string APPL" \
  -c "Add :LSUIElement bool true" \
  -c "Add :LSMinimumSystemVersion string 14.0" "$APP/Contents/Info.plist"
echo "$HUELLA" > "$APP/Contents/Resources/huella"
codesign --force --sign - "$APP" >/dev/null 2>&1
echo "Ayudante del fondo listo: $APP"
