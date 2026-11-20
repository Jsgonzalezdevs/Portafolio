#!/bin/zsh
# Compila el panel (/app) y lo mete en el APK (android/app/src/main/assets/web) para que la app lo sirva sin red.
# Úsalo antes de ./gradlew assembleDebug. Sin esto la app sigue funcionando, pero pide la página a internet.
set -e
RAIZ="${0:A:h:h:h}"
cd "$RAIZ"
export PATH="$HOME/.local/node24/bin:$PATH"
npm run build >/dev/null
DESTINO="android/app/src/main/assets/web"
rm -rf "$DESTINO"
mkdir -p "$DESTINO/app" "$DESTINO/assets"
cp dist/app/index.html "$DESTINO/app/index.html"
cp dist/favicon.svg "$DESTINO/favicon.svg"
# Lo que cita la página, y lo que citan sus hojas de estilo y scripts (un nivel basta para este panel).
for archivo in $(grep -oE '/assets/[A-Za-z0-9_.-]+' dist/app/index.html | sort -u); do
  cp "dist$archivo" "$DESTINO$archivo"
done
for archivo in $(cat "$DESTINO"/assets/*.js "$DESTINO"/assets/*.css | grep -oE '(/assets/|\./)[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.(js|css)' | sed -E 's#^(/assets/|\./)##' | sort -u); do
  [[ -f "$DESTINO/assets/$archivo" ]] || cp "dist/assets/$archivo" "$DESTINO/assets/$archivo"
done
echo "Panel dentro del APK: $(find "$DESTINO" -type f | wc -l | tr -d ' ') archivos, $(du -sk "$DESTINO" | cut -f1) KB"
