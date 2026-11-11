// Ayudante de agenda para mac-agent: Calendario y Recordatorios de macOS (EventKit).
//
// El Calendario de macOS ya junta las cuentas configuradas en la Mac (iCloud,
// Google, Exchange…), así que esto sirve para cualquiera de ellas.
//
// Uso (todo responde JSON por stdout; los errores salen con código 1 y {"error": …}):
//   agenda permisos
//   agenda pedir-permisos
//   agenda eventos <desde ISO> <hasta ISO>
//   agenda crear-evento <titulo> <inicio ISO> <fin ISO>
//   agenda recordatorios
//   agenda crear-recordatorio <titulo> [<vence ISO>]
//   agenda completar-recordatorio <id>
//
// Fechas: "2026-11-12T08:30" (hora local) o con zona ("…-05:00", "…Z").

import EventKit
import Foundation

let almacen = EKEventStore()

func salir(_ valor: Any, codigo: Int32 = 0) -> Never {
    let datos = (try? JSONSerialization.data(withJSONObject: valor, options: [.sortedKeys])) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(datos)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(codigo)
}

func fallar(_ mensaje: String) -> Never { salir(["error": mensaje], codigo: 1) }

// ---------- Fechas ----------

let isoConZona: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()

let isoConZonaFraccion: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

func formatoLocal(_ patron: String) -> DateFormatter {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone.current
    f.dateFormat = patron
    return f
}

let formatosLocales = ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm", "yyyy-MM-dd"].map(formatoLocal)

func fecha(_ texto: String) -> Date {
    if let d = isoConZona.date(from: texto) ?? isoConZonaFraccion.date(from: texto) { return d }
    for f in formatosLocales { if let d = f.date(from: texto) { return d } }
    fallar("Fecha inválida: \(texto). Usa 2026-11-12T08:30")
}

/** Salida siempre en hora local con zona, para que la IA y el panel no se líen con UTC. */
let salidaLocal: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    f.timeZone = TimeZone.current
    return f
}()

func texto(_ d: Date?) -> Any { d.map { salidaLocal.string(from: $0) } ?? NSNull() }

// ---------- Permisos ----------

func nombre(_ estado: EKAuthorizationStatus) -> String {
    switch estado {
    case .fullAccess: return "concedido"
    case .writeOnly: return "solo-escritura"
    case .denied: return "denegado"
    case .restricted: return "restringido"
    case .notDetermined: return "sin-decidir"
    @unknown default: return "desconocido"
    }
}

func exigir(_ tipo: EKEntityType) {
    let estado = EKEventStore.authorizationStatus(for: tipo)
    if estado == .fullAccess { return }
    let que = tipo == .event ? "Calendarios" : "Recordatorios"
    fallar("Sin permiso para \(que) (\(nombre(estado))). Ábrelo en Ajustes del Sistema › Privacidad y seguridad › \(que).")
}

func pedir(_ tipo: EKEntityType) -> Bool {
    let espera = DispatchSemaphore(value: 0)
    var concedido = false
    let fin: EKEventStoreRequestAccessCompletionHandler = { ok, _ in
        concedido = ok
        espera.signal()
    }
    if tipo == .event { almacen.requestFullAccessToEvents(completion: fin) }
    else { almacen.requestFullAccessToReminders(completion: fin) }
    espera.wait()
    return concedido
}

// ---------- Recordatorios ----------

func recordatoriosPendientes() -> [EKReminder] {
    let espera = DispatchSemaphore(value: 0)
    var resultado: [EKReminder] = []
    let predicado = almacen.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
    almacen.fetchReminders(matching: predicado) { r in
        resultado = r ?? []
        espera.signal()
    }
    espera.wait()
    return resultado
}

func venceDe(_ r: EKReminder) -> Date? {
    guard var c = r.dueDateComponents else { return nil }
    if c.calendar == nil { c.calendar = Calendar.current }
    // Sin hora = "ese día": se toma las 9:00 para poder avisar.
    if c.hour == nil { c.hour = 9; c.minute = 0 }
    return c.date
}

func json(_ r: EKReminder) -> [String: Any] {
    ["id": r.calendarItemIdentifier, "titulo": r.title ?? "", "vence": texto(venceDe(r)), "lista": r.calendar?.title ?? ""]
}

// ---------- Órdenes ----------

let args = Array(CommandLine.arguments.dropFirst())
guard let orden = args.first else { fallar("Falta la orden. Ver la cabecera de agenda.swift.") }

switch orden {
case "permisos":
    salir([
        "calendario": nombre(EKEventStore.authorizationStatus(for: .event)),
        "recordatorios": nombre(EKEventStore.authorizationStatus(for: .reminder)),
    ])

case "pedir-permisos":
    salir(["calendario": pedir(.event), "recordatorios": pedir(.reminder)])

case "eventos":
    guard args.count >= 3 else { fallar("Uso: agenda eventos <desde> <hasta>") }
    exigir(.event)
    let desde = fecha(args[1]), hasta = fecha(args[2])
    if hasta <= desde { fallar("«hasta» debe ser posterior a «desde»") }
    let predicado = almacen.predicateForEvents(withStart: desde, end: hasta, calendars: nil)
    let eventos = almacen.events(matching: predicado).sorted { $0.startDate < $1.startDate }.prefix(100)
    salir(eventos.map { e -> [String: Any] in
        [
            "titulo": e.title ?? "(sin título)",
            "inicio": texto(e.startDate),
            "fin": texto(e.endDate),
            "todoElDia": e.isAllDay,
            "calendario": e.calendar?.title ?? "",
            "lugar": e.location ?? NSNull(),
        ]
    })

case "crear-evento":
    guard args.count >= 4 else { fallar("Uso: agenda crear-evento <titulo> <inicio> <fin>") }
    exigir(.event)
    let e = EKEvent(eventStore: almacen)
    e.title = args[1]
    e.startDate = fecha(args[2])
    e.endDate = fecha(args[3])
    if e.endDate <= e.startDate { fallar("El evento debe terminar después de empezar") }
    guard let calendario = almacen.defaultCalendarForNewEvents else { fallar("No hay calendario por defecto en la Mac") }
    e.calendar = calendario
    do { try almacen.save(e, span: .thisEvent) } catch { fallar("No se pudo guardar el evento: \(error.localizedDescription)") }
    salir(["ok": true, "titulo": e.title ?? "", "inicio": texto(e.startDate), "calendario": calendario.title])

case "recordatorios":
    exigir(.reminder)
    let pendientes = recordatoriosPendientes().sorted {
        (venceDe($0) ?? .distantFuture) < (venceDe($1) ?? .distantFuture)
    }.prefix(100)
    salir(pendientes.map(json))

case "crear-recordatorio":
    guard args.count >= 2 else { fallar("Uso: agenda crear-recordatorio <titulo> [<vence>]") }
    exigir(.reminder)
    let r = EKReminder(eventStore: almacen)
    r.title = args[1]
    guard let lista = almacen.defaultCalendarForNewReminders() else { fallar("No hay lista de recordatorios por defecto") }
    r.calendar = lista
    if args.count >= 3, !args[2].isEmpty {
        let vence = fecha(args[2])
        r.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: vence)
        r.addAlarm(EKAlarm(absoluteDate: vence)) // así también suena en el iPhone
    }
    do { try almacen.save(r, commit: true) } catch { fallar("No se pudo guardar el recordatorio: \(error.localizedDescription)") }
    salir(["ok": true] .merging(json(r)) { a, _ in a })

case "completar-recordatorio":
    guard args.count >= 2 else { fallar("Uso: agenda completar-recordatorio <id>") }
    exigir(.reminder)
    guard let r = almacen.calendarItem(withIdentifier: args[1]) as? EKReminder else { fallar("Recordatorio no encontrado") }
    r.isCompleted = true
    do { try almacen.save(r, commit: true) } catch { fallar("No se pudo completar: \(error.localizedDescription)") }
    salir(["ok": true, "titulo": r.title ?? ""])

default:
    fallar("Orden desconocida: \(orden)")
}
