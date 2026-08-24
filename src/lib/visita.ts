/**
 * Avisar que alguien está mirando el portafolio.
 *
 * Manda dos cosas y ninguna más: qué página y de qué dominio llegó. El país, el
 * tipo de dispositivo y la huella del día los deduce el borde de Vercel a
 * partir de encabezados que el navegador manda de todos modos — así el
 * navegador nunca tiene que entregar nada que no estuviera ya entregando.
 */

const RUTA = '/api/visita';

/**
 * Si esta visita se cuenta o no.
 *
 * "No me rastrees" es una respuesta, no una sugerencia: cuando el navegador lo
 * dice, no se cuenta y ya. Cuesta una línea y es exactamente lo que uno
 * esperaría de un sitio que promete no guardar nada personal.
 */
export const debeRegistrar = (
  doNotTrack: string | null | undefined,
  produccion: boolean,
): boolean => {
  if (doNotTrack === '1' || doNotTrack === 'yes') return false;

  // En desarrollo no hay función del borde que responda, y contar las recargas
  // de uno mismo mientras programa ensuciaría los números reales.
  return produccion;
};

export const registrarVisita = (): void => {
  if (!debeRegistrar(navigator.doNotTrack, import.meta.env.PROD)) return;

  const cuerpo = JSON.stringify({
    ruta: window.location.pathname,
    referente: document.referrer,
  });

  try {
    // `sendBeacon` sobrevive a que cierren la pestaña de inmediato, que es
    // justo cuando más se pierde una visita corta.
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(RUTA, new Blob([cuerpo], { type: 'application/json' }));
      return;
    }

    void fetch(RUTA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: cuerpo,
      keepalive: true,
    }).catch(() => {
      // Silencio a propósito: ver más abajo.
    });
  } catch {
    // Contar visitas jamás puede romper la página de nadie. Si falla, se
    // pierde el dato y no pasa nada más.
  }
};
