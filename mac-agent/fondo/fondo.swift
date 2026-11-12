// Fondo de pantalla actual de la Mac, para el panel de la tablet.
//
// Uso:  fondo <carpeta de salida> [ancho máximo]
//
// Escribe en la carpeta:
//   fondo.jpg   el fondo tal como se ve en el escritorio
//   vidrio.jpg  el mismo fondo, pequeño y desenfocado (para el efecto de vidrio
//               de los widgets sin gastar GPU en la tablet)
//   firma.txt   identifica la versión; si no cambió, no se vuelve a generar
// y responde por stdout  {"firma": "...", "origen": "...", "cambiado": true|false}
//
// De dónde sale la imagen, del más fiel al menos:
//   1. La captura que guarda macOS (WallpaperAgent) del fondo que está puesto.
//      Sirve para los Aerial (videos), que no tienen una imagen fija, incluso
//      cuando van rotando solos.
//   2. El primer fotograma del video del Aerial.
//   3. El archivo de imagen elegido por el usuario.
//   4. Lo que diga AppKit (fondos clásicos del sistema).
//
// Ni System Events ni NSWorkspace sirven para los Aerial: devuelven una imagen
// genérica (DefaultDesktop.heic), no lo que se ve.

import AppKit
import AVFoundation
import CoreImage
import CryptoKit
import SQLite3

let fm = FileManager.default
let casa = fm.homeDirectoryForCurrentUser
let raizFondos = casa.appendingPathComponent("Library/Application Support/com.apple.wallpaper")
let cacheCapturas = casa.appendingPathComponent(
    "Library/Containers/com.apple.wallpaper.agent/Data/Library/Caches/com.apple.wallpaper.caches")
let rotacionAerials = casa.appendingPathComponent(
    "Library/Containers/com.apple.wallpaper.extension.aerials/Data/Library/Application Support/Shuffle/ShuffleOrder.db")

func salir(_ valor: Any, codigo: Int32 = 0) -> Never {
    let datos = (try? JSONSerialization.data(withJSONObject: valor, options: [.sortedKeys])) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(datos)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(codigo)
}

func fallar(_ mensaje: String) -> Never { salir(["error": mensaje], codigo: 1) }

struct Fuente {
    let origen: String
    let url: URL
    let esVideo: Bool
}

func fechaDe(_ url: URL) -> Date? {
    (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
}

// ---------- Qué fondo eligió el usuario (Ajustes del Sistema › Fondo de pantalla) ----------

struct Eleccion {
    let proveedor: String
    let config: [String: Any]
    let archivos: [URL]
}

func eleccionDeEscritorio() -> Eleccion? {
    guard let datos = try? Data(contentsOf: raizFondos.appendingPathComponent("Store/Index.plist")),
          let raiz = (try? PropertyListSerialization.propertyList(from: datos, format: nil)) as? [String: Any]
    else { return nil }

    // Primero lo específico de una pantalla; si no hay, lo común a todas.
    var candidatos: [[String: Any]] = []
    if let porPantalla = raiz["Displays"] as? [String: Any] {
        candidatos += porPantalla.values.compactMap { $0 as? [String: Any] }
    }
    for clave in ["AllSpacesAndDisplays", "SystemDefault"] {
        if let c = raiz[clave] as? [String: Any] { candidatos.append(c) }
    }

    for c in candidatos {
        guard let escritorio = c["Desktop"] as? [String: Any],
              let contenido = escritorio["Content"] as? [String: Any],
              let opciones = contenido["Choices"] as? [[String: Any]],
              let primera = opciones.first,
              let proveedor = primera["Provider"] as? String
        else { continue }
        var config: [String: Any] = [:]
        if let d = primera["Configuration"] as? Data,
           let p = (try? PropertyListSerialization.propertyList(from: d, format: nil)) as? [String: Any] {
            config = p
        }
        var archivos: [URL] = []
        for f in primera["Files"] as? [Any] ?? [] {
            if let dic = f as? [String: Any], let rel = dic["relative"] as? String, let u = URL(string: rel) {
                archivos.append(u)
            } else if let s = f as? String, let u = URL(string: s) {
                archivos.append(u)
            }
        }
        return Eleccion(proveedor: proveedor, config: config, archivos: archivos)
    }
    return nil
}

/** Con los Aerial en rotación (cada 12 h, cada día…), cuál toca ahora. */
func aerialEnRotacion() -> String? {
    var db: OpaquePointer?
    guard sqlite3_open_v2(rotacionAerials.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
        sqlite3_close(db)
        return nil
    }
    defer { sqlite3_close(db) }
    var consulta: OpaquePointer?
    let sql = "SELECT ZCURRENTID FROM ZPERSISTENTSHUFFLEORDER ORDER BY ZDATEMODIFIED DESC LIMIT 1"
    guard sqlite3_prepare_v2(db, sql, -1, &consulta, nil) == SQLITE_OK else { return nil }
    defer { sqlite3_finalize(consulta) }
    guard sqlite3_step(consulta) == SQLITE_ROW, let texto = sqlite3_column_text(consulta, 0) else { return nil }
    return String(cString: texto)
}

// ---------- Capturas que guarda macOS del fondo actual ----------
// Nombre: <hash>-<ancho>-<alto>-<n>-<fecha del archivo de origen, un Double en hex>.bmp

struct Captura {
    let url: URL
    let ancho: Int
    let fechaOrigen: Double
    let escrita: Date
}

func capturas(en carpeta: String) -> [Captura] {
    let dir = cacheCapturas.appendingPathComponent(carpeta)
    guard let archivos = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])
    else { return [] }
    return archivos.compactMap { a in
        guard a.pathExtension.lowercased() == "bmp" else { return nil }
        let partes = a.deletingPathExtension().lastPathComponent.split(separator: "-")
        guard partes.count >= 5,
              let bits = UInt64(partes[partes.count - 1], radix: 16),
              let ancho = Int(partes[partes.count - 4])
        else { return nil }
        return Captura(url: a, ancho: ancho, fechaOrigen: Double(bitPattern: bits), escrita: fechaDe(a) ?? .distantPast)
    }
}

/** La más grande; entre iguales, la más reciente. */
func mejor(_ lista: [Captura]) -> URL? {
    lista.max { a, b in a.ancho != b.ancho ? a.ancho < b.ancho : a.escrita < b.escrita }?.url
}

/** La captura del escritorio hecha a partir de ESTE video (la pantalla de bloqueo puede tener otro). */
func captura(deVideo video: URL) -> URL? {
    guard let fecha = fechaDe(video)?.timeIntervalSinceReferenceDate else { return nil }
    return mejor(capturas(en: "extension-com.apple.wallpaper.extension.aerials").filter { abs($0.fechaOrigen - fecha) < 0.5 })
}

// ---------- De dónde sale la imagen ----------

func esImagen(_ url: URL) -> Bool {
    var esCarpeta: ObjCBool = false
    guard fm.fileExists(atPath: url.path, isDirectory: &esCarpeta), !esCarpeta.boolValue else { return false }
    return CGImageSourceCreateWithURL(url as CFURL, nil).map { CGImageSourceGetCount($0) > 0 } ?? false
}

func fuenteActual() -> Fuente {
    if let e = eleccionDeEscritorio() {
        if e.proveedor.hasSuffix(".aerials") {
            let videos = raizFondos.appendingPathComponent("aerials/videos")
            var video = videos.appendingPathComponent("\(e.config["assetID"] as? String ?? "-").mov")
            // Si el id no es un video sino una categoría («Espacio», «Paisajes»…), van en rotación.
            if !fm.fileExists(atPath: video.path), let actual = aerialEnRotacion() {
                video = videos.appendingPathComponent("\(actual).mov")
            }
            if fm.fileExists(atPath: video.path) {
                if let c = captura(deVideo: video) { return Fuente(origen: "captura", url: c, esVideo: false) }
                return Fuente(origen: "video", url: video, esVideo: true)
            }
        } else if let archivo = e.archivos.first(where: esImagen) {
            return Fuente(origen: "imagen", url: archivo, esVideo: false)
        } else {
            // Fondos dinámicos, degradados, etc.: lo que macOS dibujó por última vez.
            let carpeta = "extension-" + e.proveedor.replacingOccurrences(of: ".choice.", with: ".extension.")
            if let c = mejor(capturas(en: carpeta)) { return Fuente(origen: "captura", url: c, esVideo: false) }
        }
    }
    if let pantalla = NSScreen.main ?? NSScreen.screens.first,
       let url = NSWorkspace.shared.desktopImageURL(for: pantalla), esImagen(url) {
        return Fuente(origen: "sistema", url: url, esVideo: false)
    }
    fallar("No se pudo determinar el fondo de pantalla")
}

// ---------- Imagen ----------

func cargar(_ f: Fuente, maximo: Int) -> CGImage? {
    if f.esVideo {
        let generador = AVAssetImageGenerator(asset: AVURLAsset(url: f.url))
        generador.appliesPreferredTrackTransform = true
        generador.maximumSize = CGSize(width: maximo, height: maximo)
        return try? generador.copyCGImage(at: .zero, actualTime: nil)
    }
    guard let origen = CGImageSourceCreateWithURL(f.url as CFURL, nil) else { return nil }
    let opciones: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maximo,
    ]
    return CGImageSourceCreateThumbnailAtIndex(origen, 0, opciones as CFDictionary)
}

let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

/** Redibuja en sRGB de 8 bits: los Aerial son HDR y la tablet (y el JPEG) no. */
func enSRGB(_ imagen: CGImage, ancho: Int) -> CGImage? {
    let ancho = min(ancho, imagen.width)
    let alto = max(1, Int((Double(imagen.height) / Double(imagen.width) * Double(ancho)).rounded()))
    guard let ctx = CGContext(
        data: nil, width: ancho, height: alto, bitsPerComponent: 8, bytesPerRow: 0,
        space: sRGB, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { return nil }
    ctx.interpolationQuality = .high
    ctx.draw(imagen, in: CGRect(x: 0, y: 0, width: ancho, height: alto))
    return ctx.makeImage()
}

/** Versión «material» de macOS: muy desenfocada y con el color algo más vivo. */
func vidrio(_ imagen: CGImage) -> CGImage? {
    guard let chica = enSRGB(imagen, ancho: 384) else { return nil }
    let base = CIImage(cgImage: chica)
    let borrosa = base.clampedToExtent()
        .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 22])
        .applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 1.6])
        .cropped(to: base.extent)
    return CIContext(options: [.workingColorSpace: sRGB]).createCGImage(borrosa, from: base.extent)
}

func guardarJPEG(_ imagen: CGImage, en url: URL, calidad: Double) -> Bool {
    let temporal = url.appendingPathExtension("tmp")
    guard let destino = CGImageDestinationCreateWithURL(temporal as CFURL, "public.jpeg" as CFString, 1, nil) else { return false }
    CGImageDestinationAddImage(destino, imagen, [kCGImageDestinationLossyCompressionQuality: calidad] as CFDictionary)
    guard CGImageDestinationFinalize(destino) else { return false }
    // Escribe aparte y renombra: el agente nunca lee un JPEG a medias.
    _ = try? fm.removeItem(at: url)
    return (try? fm.moveItem(at: temporal, to: url)) != nil
}

// ---------- Principal ----------

/// Cuánto esperar antes de rendirse. La primera vez macOS pregunta si «Fondo del
/// asistente» puede acceder a datos de otras apps (la captura del fondo está en la
/// carpeta de WallpaperAgent) y el sistema deja la lectura bloqueada hasta que
/// alguien pulsa «Permitir»; sin límite, el proceso quedaría colgado para siempre.
let esperaMaxima: Double = 75

func trabajar() {

  let argumentos = Array(CommandLine.arguments.dropFirst())
  guard let primera = argumentos.first else { fallar("Uso: fondo <carpeta de salida> [ancho máximo]") }
  let carpeta = URL(fileURLWithPath: primera, isDirectory: true)
  let anchoMaximo = argumentos.count > 1 ? max(320, min(3840, Int(argumentos[1]) ?? 1600)) : 1600

  do { try fm.createDirectory(at: carpeta, withIntermediateDirectories: true) } catch {
      fallar("No se pudo crear la carpeta de salida: \(error.localizedDescription)")
  }

  let fuente = fuenteActual()
  let atributos = try? fm.attributesOfItem(atPath: fuente.url.path)
  let huella = [
      fuente.origen,
      fuente.url.path,
      String((atributos?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0),
      String((atributos?[.size] as? NSNumber)?.int64Value ?? 0),
      String(anchoMaximo),
      "v1",
  ].joined(separator: "|")
  let firma = SHA256.hash(data: Data(huella.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()

  let archivoFirma = carpeta.appendingPathComponent("firma.txt")
  let nitido = carpeta.appendingPathComponent("fondo.jpg")
  let borroso = carpeta.appendingPathComponent("vidrio.jpg")

  if (try? String(contentsOf: archivoFirma, encoding: .utf8)) == firma,
     fm.fileExists(atPath: nitido.path), fm.fileExists(atPath: borroso.path) {
      salir(["firma": firma, "origen": fuente.origen, "cambiado": false])
  }

  guard let original = cargar(fuente, maximo: anchoMaximo), let imagen = enSRGB(original, ancho: anchoMaximo) else {
      fallar("No se pudo leer la imagen del fondo (\(fuente.origen))")
  }
  guard guardarJPEG(imagen, en: nitido, calidad: 0.82) else { fallar("No se pudo escribir fondo.jpg") }
  guard let material = vidrio(imagen), guardarJPEG(material, en: borroso, calidad: 0.7) else {
      fallar("No se pudo escribir vidrio.jpg")
  }
  do { try firma.write(to: archivoFirma, atomically: true, encoding: .utf8) } catch {
      fallar("No se pudo escribir firma.txt")
  }
  salir(["firma": firma, "origen": fuente.origen, "cambiado": true, "ancho": imagen.width, "alto": imagen.height])
}

DispatchQueue.global(qos: .utility).async { trabajar() }
// El hilo principal solo vigila: trabajar() termina el proceso con salir(...).
_ = DispatchSemaphore(value: 0).wait(timeout: .now() + esperaMaxima)
fallar("macOS no respondió a tiempo. Si apareció un aviso para que «Fondo del asistente» acceda a datos de otras apps, pulsa Permitir y vuelve a intentarlo.")
