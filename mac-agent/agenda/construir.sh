#!/bin/zsh
# Compila el ayudante de agenda como mini app de macOS:
#   <destino>/Agenda del asistente.app
#
# Va como .app (y el agente la lanza con `open`) para que macOS la trate como
# responsable de su propio permiso de Calendario/Recordatorios, con su texto
# explicativo. Un binario suelto lanzado por node heredaría la petición de node,
# que no declara para qué lo quiere, y macOS la negaría sin preguntar.
#
# Solo recompila si cambió el código: cada firma nueva haría que macOS
# volviera a pedir el permiso.
set -euo pipefail

ORIGEN="${0:A:h}"
DESTINO="${1:?Uso: construir.sh <carpeta destino>}"
APP="$DESTINO/Agenda del asistente.app"
HUELLA=$(cat "$ORIGEN/agenda.swift" "$ORIGEN/Info.plist" | shasum -a 256 | cut -d' ' -f1)

if [[ -x "$APP/Contents/MacOS/agenda" && "$(cat "$APP/Contents/Resources/huella" 2>/dev/null)" == "$HUELLA" ]]; then
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
  if swiftc "${opciones[@]}" -O -swift-version 5 "$ORIGEN/agenda.swift" -o "$TMP/agenda" 2>"$TMP/errores"; then
    compilado=1
    break
  fi
done
if [[ -z "$compilado" ]]; then
  echo "No se pudo compilar el ayudante de agenda:" >&2
  tail -5 "$TMP/errores" >&2
  exit 1
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
mv "$TMP/agenda" "$APP/Contents/MacOS/agenda"
# Info.plist de la app: el del repo + lo que necesita un bundle sin interfaz.
/usr/libexec/PlistBuddy -x -c "Print" "$ORIGEN/Info.plist" > "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string agenda" \
  -c "Add :CFBundlePackageType string APPL" \
  -c "Add :LSUIElement bool true" \
  -c "Add :LSMinimumSystemVersion string 14.0" "$APP/Contents/Info.plist"
echo "$HUELLA" > "$APP/Contents/Resources/huella"
codesign --force --sign - "$APP" >/dev/null 2>&1
echo "Ayudante de agenda listo: $APP"
