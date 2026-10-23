import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Heart, Pause, Play, Sparkles, X } from 'lucide-react';
import './Birthday.css';
import { BirthdayMusic, type BackgroundControl } from './BirthdayMusic';
import stitchCelebracion from '../assets/stitch-celebracion.png';
import stitchFlores from '../assets/stitch-flores.webp';
import stitchSerenata from '../assets/stitch-serenata.webp';
import stitchSonrisa from '../assets/stitch-sonrisa.webp';
import stitchFiesta from '../assets/stitch-fiesta.webp';

export const BIRTHDAY_AT = new Date('2026-10-23T00:00:00-05:00').getTime();
export function birthdayCountdown(now: number) {
  const remaining = Math.max(0, Math.ceil((BIRTHDAY_AT - now) / 1000));
  return { unlocked: now >= BIRTHDAY_AT, units: [Math.floor(remaining / 86400), Math.floor(remaining % 86400 / 3600), Math.floor(remaining % 3600 / 60), remaining % 60] };
}
const memories = [
  { src: '/cumpleanos/recuerdo-10.webp', caption: 'Tu carita de sorpresa. Mi regalo favorito.' },
  { src: '/cumpleanos/recuerdo-11.webp', caption: 'Un paseíto contigo y ya soy feliz.' },
  { src: '/cumpleanos/recuerdo-12.webp', caption: 'Celebrarte siempre va a ser un plan bonito.' },
  { src: '/cumpleanos/recuerdo-13.webp', caption: 'De esos días que nos quedan para contar.' },
  { src: '/cumpleanos/recuerdo-14.webp', caption: 'Una sonrisa tuya y se me alegra todo.' },
  { src: '/cumpleanos/recuerdo-15.webp', caption: 'Cerquita de ti, desde nuestros primeros recuerdos.' },
  { src: '/cumpleanos/recuerdo-07.webp', caption: 'Mi lugar favorito siempre eres tú.' },
  { src: '/cumpleanos/recuerdo-06.webp', caption: 'Un besito y el mundo se siente más bonito.' },
  { src: '/cumpleanos/recuerdo-04.webp', caption: 'Qué bonita es la vida contigo.' },
  { src: '/cumpleanos/recuerdo-08.webp', caption: 'Aquí quiero quedarme un ratito más.' },
  { src: '/cumpleanos/recuerdo-01.webp', caption: 'Contigo, hasta el camino es un plan bonito.' },
  { src: '/cumpleanos/recuerdo-02.webp', caption: 'Tú haciendo pucheros, yo sonriendo por ti.' },
  { src: '/cumpleanos/recuerdo-03.webp', caption: 'Esos días que se vuelven recuerdos favoritos.' },
  { src: '/cumpleanos/recuerdo-05.webp', caption: 'Los planes sencillitos también se quedan.' },
  { src: '/cumpleanos/recuerdo-09.webp', caption: 'Así, cerquita. Sin necesitar nada más.' },
  { src: '/ellayyo/beso.webp', caption: 'Uno de esos besos que lo dicen todo.' },
  { src: '/ellayyo/sonrisas.webp', caption: 'Nuestra colección de sonrisas.' },
  { src: '/ellayyo/abrazo.webp', caption: 'Y que nunca nos falten estos abrazos.' },
];
export function Birthday() {
  const [now, setNow] = useState(Date.now);
  const [preview] = useState(() => new URLSearchParams(window.location.search).get('preview') === '1');
  const [entered, setEntered] = useState(preview);
  const [letter, setLetter] = useState(false);
  const [wish, setWish] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [musicError, setMusicError] = useState(false);
  const [photo, setPhoto] = useState<number | null>(null);
  const [stitch, setStitch] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const backgroundAudio = useRef<BackgroundControl>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const countdown = birthdayCountdown(now);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    const refresh = () => setNow(Date.now());
    document.addEventListener('visibilitychange', refresh);
    const title = document.title;
    document.title = 'Feliz cumpleaños, mi princesa · Para Kamila';
    const previousRobots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const robots = previousRobots ?? document.createElement('meta');
    const previousContent = robots.content;
    robots.name = 'robots'; robots.content = 'noindex, nofollow, noarchive';
    if (!previousRobots) document.head.append(robots);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh); document.title = title; if (previousRobots) robots.content = previousContent; else robots.remove(); };
  }, []);
  useEffect(() => { if (photo !== null) dialog.current?.showModal(); }, [photo]);
  const toggleMusic = () => {
    if (!audio.current) return;
    if (!audio.current.paused) audio.current.pause();
    else { backgroundAudio.current?.pause(); video.current?.pause(); setMusicError(false); void audio.current.play().catch(() => setMusicError(true)); }
  };
  return <div className="birthday">
    <div className="bday-grain" aria-hidden="true" />
    <nav className="bday-nav"><a href={preview ? "/cumpleanos-mi-princesa?preview=1" : "/cumpleanos-mi-princesa"} aria-label="Inicio de la sorpresa">J <Heart size={13} fill="currentColor" /> K<span>UN RINCONCITO PARA TI</span></a><span>23 OCTUBRE · 2026 <Sparkles size={14} /></span></nav>
    {(!countdown.unlocked && !preview) || !entered ? <main className="bday-gate">
      <div className="bday-orbit" aria-hidden="true">✧</div>
      <span className="bday-eyebrow">UNA FECHA FAVORITA EN EL UNIVERSO</span>
      <h1>Algo bonito<br />está por <em>comenzar.</em></h1>
      <p>Mi princesa, hay una pequeña sorpresa esperando por ti.<br />Porque el mundo es más bonito desde que tú estás en él.</p>
      <div className="bday-countdown" role="timer" aria-label="Tiempo para el cumpleaños">{countdown.units.map((value, i) => <div key={i}><strong>{String(value).padStart(2, '0')}</strong><span>{['DÍAS', 'HORAS', 'MINUTOS', 'SEGUNDOS'][i]}</span></div>)}</div>
      <div className="bday-gate-bottom"><img src={stitchCelebracion} width="508" height="544" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = '/ellayyo/stitch/stitch-family.webp'; }} alt="Stitch acompaña la espera" /><span>{countdown.unlocked ? 'Stitch dice que… ¡ya es tu día!' : 'Hasta Stitch está contando los segundos.'}</span></div>
      {countdown.unlocked ? <button className="bday-primary" onClick={() => setEntered(true)}>Abrir mi sorpresa <Heart size={17} /></button> : <div className="bday-sealed">♡ Sellado con amor hasta el 23 de octubre · 12:00 a. m.<small>Hora de Colombia</small></div>}
      <span className="bday-handwritten">Para Kamila, de tu gordito.</span>
    </main> : <>
      <audio ref={audio} src="/ellayyo/eres-tu.mp4" preload="metadata" onPlay={() => { backgroundAudio.current?.pause(); video.current?.pause(); setPlaying(true); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setMusicError(true)} />
      <main>
        <section className="bday-hero">
          <div className="bday-hero-copy"><span className="bday-eyebrow"><span className="bday-dot" /> HOY EL UNIVERSO CELEBRA CONTIGO</span><h1>Feliz cumpleaños,<br />mi <em>princesa.</em><span className="bday-title-star" aria-hidden="true">✧</span></h1><p>Hoy se celebra tu vida.<br />Y yo celebro la suerte de tenerte en la mía.</p><span className="bday-handwritten">Con todo mi potito corazón, Julián ♡</span></div>
          <div className="bday-hero-art" id="primer-recuerdo"><span className="bday-art-note">mi persona favorita.</span><div className="bday-hero-photo"><img src="/cumpleanos/recuerdo-10.webp" alt="Kamila sorprendida con las flores y el globo rosa que Julián le regaló" fetchPriority="high" /><span>tú, yo y todo lo bonito que viene ♡</span></div><img className="bday-stitch-hero" src={stitchCelebracion} width="508" height="544" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = '/ellayyo/stitch/stitch-family.webp'; }} alt="Stitch también vino a celebrar" /><span className="bday-date-stamp">23<br /><small>OCTUBRE</small></span><span className="bday-art-heart" aria-hidden="true">♡</span></div>
        </section>
        <div className="bday-ribbon" aria-hidden="true">HOY TODO ES POR TI <span>✦</span> MI NIÑA CONSENTIDA <span>✦</span> FELIZ VUELTA AL SOL <span>✦</span> TE AMO, MI 11:11 <span>✦</span></div>
        <section className="bday-section bday-gifts" id="regalitos"><div className="bday-section-heading"><span className="bday-eyebrow">01 / COSITAS HECHAS CON AMOR</span><h2>No cabías en un regalo.<br /><em>Así que te hice un universo.</em></h2><p>Sin afán, mi vida. Cada cosita tiene un poquito de nosotros.</p></div><div className="bday-gift-grid">
          <article className="bday-letter-card"><span className="bday-card-number">UNAS PALABRITAS PARA TI</span><div className={`bday-envelope ${letter ? 'opened' : ''}`} aria-hidden="true"><Heart fill="currentColor" /></div><h3>De mi corazón al tuyo</h3><p>Hay cosas que se sienten más bonitas cuando se escriben pensando en ti.</p><button onClick={() => setLetter(!letter)} aria-expanded={letter}>{letter ? 'Guardar mi cartita' : 'Abrir mi cartita'} <ArrowUpRight size={17} /></button>{letter && <div className="bday-letter"><p>Mi Kamila, mi princesa:</p><p>Feliz cumpleaños, mi vida. Hoy quiero recordarte lo especial que eres para mí. Tu sonrisa, tus ocurrencias, tu forma de hacer que un momento cualquiera se convierta en un recuerdo bonito.</p><p>Deseo que este nuevo año de tu vida te traiga tranquilidad, sueños cumplidos y muchas razones para sonreír. Que te sientas querida, acompañada y orgullosa de la persona que eres.</p><p>Me encanta poder mirarte y pensar que entre tantas personas tuve la suerte de encontrarte a ti. A mi niña de los ojitos bonitos, la de las ocurrencias que me hacen reír y los abrazos en los que quisiera quedarme un potito más.</p><p>Quiero seguir celebrando tus alegrías contigo. Escucharte cuando tengas mil cosas que contarme y acompañarte también cuando el día no haya salido como esperabas. Que sepas que puedes venir a mí, ser tú y sentirte amada sin tener que hacer nada más.</p><p>Ojalá hoy puedas verte un momentico como yo te veo. Tan bonita, tan especial y con tantas cosas por vivir. No dejes de creer en ti, mi vida. Yo quiero verte cumplir eso que tanto sueñas y estar cerquita para decirte que sabía que podías.</p><p>Me hace feliz compartir esta vida contigo y seguir guardando momentos de los dos. Hoy todos los detallitos de este rinconcito son para ti.</p><p>Esta paginita es un detallito, pero cada foto, cada palabra y cada cosita la hice pensando en sacarte una sonrisa. Porque te mereces sentirte consentida hoy y también en los días que no tienen una fecha especial.</p><p>Gachas por los besitos, por las risas y por todos esos momentos que ya son nuestros. Nos faltan muchas fotos por tomar, muchos planes por inventarnos y muchos cumpleaños en los que quiero decirte lo feliz que me hace tenerte.</p><p>Te amo mucho, mi 11:11. Que nunca te falten motivos para pedir un deseo.</p><span className="bday-handwritten">Tu gordito, Julián ♡</span></div>}</article>
          <article className="bday-song-card"><span className="bday-card-number">NUESTRA BANDA SONORA</span><div className={`bday-record ${playing ? 'spinning' : ''}`} aria-hidden="true"><div><Heart size={23} fill="currentColor" /></div></div><h3>Eres tú</h3><p>La canción que te dediqué.<br />Porque entre tantas personas… eres tú.</p><button onClick={toggleMusic}>{playing ? <Pause size={17} /> : <Play size={17} />} {playing ? 'Pausar nuestra canción' : 'Escuchar nuestra canción'}</button>{musicError && <p role="status">No pudimos reproducirla. <a href="/ellayyo/eres-tu.mp4">Abrir la canción</a></p>}</article>
        </div></section>
        <BirthdayMusic audioRef={backgroundAudio} personalPlaying={playing} onBackgroundPlay={() => { audio.current?.pause(); video.current?.pause(); }} />
        <section className="bday-section bday-memories"><div className="bday-section-heading"><span className="bday-eyebrow">02 / NUESTRO PEQUEÑO ÁLBUM</span><h2>Momentitos nuestros.<br /><em>De mis favoritos.</em></h2><p>Toca una foto y quédate un ratito en ese recuerdo.</p></div><div className="bday-photo-grid">{memories.map((memory, i) => <button className="bday-polaroid" key={memory.src} onClick={() => setPhoto(i)}><span className="bday-tape" aria-hidden="true" /><img src={memory.src} alt={memory.caption} loading="lazy" /><span>{memory.caption}</span><small>J + K · recuerdo {String(i + 1).padStart(2, '0')}</small></button>)}</div></section>
        <section className="bday-video-memory" aria-labelledby="video-memory-title"><div><span className="bday-eyebrow">UN RECUERDITO EN MOVIMIENTO</span><h2 id="video-memory-title">Hay momentos que<br /><em>merecen volver a vivirse.</em></h2><p>Una foto guarda la sonrisa. Un video nos deja quedarnos un ratito más.</p></div><div className="bday-video-frame"><video ref={video} controls playsInline preload="none" poster="/cumpleanos/video-portada.webp" onPlay={() => { audio.current?.pause(); backgroundAudio.current?.pause(); }}><source src="/cumpleanos/nuestro-recuerdo.mp4" type="video/mp4" />Tu navegador no puede reproducir este video.</video><span className="bday-handwritten">Un pedacito de nosotros ♡</span></div></section>
        <section className="bday-section bday-wish"><span className="bday-eyebrow">03 / CIERRA LOS OJITOS</span><h2>Un deseo, mi princesa.<br /><em>El universo te escucha.</em></h2><div className={`bday-cake ${wish ? 'blown' : ''}`} aria-hidden="true"><div className="bday-candles">{[0,1,2].map(i => <span key={i}><i /></span>)}</div><div className="bday-cake-top" /><div className="bday-cake-base">♡ &nbsp; ♡ &nbsp; ♡</div><div className="bday-cake-plate" /></div><button className="bday-primary" onClick={() => setWish(!wish)}>{wish ? 'Encender las velitas otra vez' : 'Ya pedí mi deseo · soplar las velitas'} <Sparkles size={17} /></button><p role="status">{wish ? 'Que eso que acabas de pedir encuentre el camino hasta ti. ♡' : 'Pídelo bajito. No tienes que contárselo a nadie.'}</p>{wish && <div className="bday-confetti" aria-hidden="true">{Array.from({length: 24}, (_, i) => <span key={i} style={{left: `${i * 4.3}%`, animationDelay: `${i % 5 * .13}s`, background: ['#b79ae0','#ed9fbb','#eac783'][i % 3]}} />)}</div>}</section>
        <section className="bday-stitch-album" aria-labelledby="stitch-album-title">
          <div className="bday-section-heading"><span className="bday-eyebrow">INVITADOS DE OTRA GALAXIA</span><h2 id="stitch-album-title">Stitch se puso bonito<br /><em>para celebrar contigo.</em></h2><p>Flores, una serenata y mucho amor para la cumpleañera.</p></div>
          <div className="bday-stitch-photos">{[
            { src: stitchFlores, alt: 'Stitch con un collar de flores', note: 'Flores para mi princesa ♡' },
            { src: stitchSerenata, alt: 'Stitch vestido de Elvis tocando guitarra', note: 'Una serenata solo para ti.' },
            { src: stitchSonrisa, alt: 'Stitch sonriendo en la playa', note: 'Así de feliz por tu cumpleaños.' },
            { src: stitchFiesta, alt: 'Stitch descansando con gafas de sol', note: 'Hoy la consentida eres tú.' },
          ].map(item => <figure key={item.src}><span className="bday-tape" aria-hidden="true" /><img src={item.src} alt={item.alt} loading="lazy" width="400" height="400" /><figcaption>{item.note}</figcaption></figure>)}</div>
        </section>
        <section className="bday-ohana"><button onClick={() => setStitch(!stitch)} aria-label="Descubrir el mensaje de Stitch" aria-expanded={stitch}><img src={stitchCelebracion} width="508" height="544" alt="Stitch te tiene un mensajito" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = '/ellayyo/stitch/stitch-family.webp'; }} /></button><div><span className="bday-eyebrow">UN INVITADO MUY ESPECIAL</span><h2>Ohana, mi niña.</h2><p>{stitch ? 'Misión 626: recordarte que eres la cumpleañera más bonita de toda la galaxia. ¡Te amamos! ♡' : 'Stitch también quería estar aquí. Tócalo, tiene algo que decirte.'}</p></div><span className="bday-ohana-star" aria-hidden="true">✧</span></section>
      </main><footer className="bday-footer"><Heart size={22} /><h2>Qué suerte que naciste.<br /><em>Qué suerte coincidir contigo.</em></h2><p>Feliz cumpleaños, María Kamila.</p><span className="bday-handwritten">Siempre tuyo, Julián.</span><small>23 de octubre de 2026 · Hecho con muchísimo amor.<br />Stitch: PNGimg · CC BY-NC 4.0</small></footer>

      <dialog className="bday-dialog" ref={dialog} onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }} onClose={() => setPhoto(null)}><button autoFocus aria-label="Cerrar foto" onClick={() => dialog.current?.close()}><X /></button>{photo !== null && <><img src={memories[photo].src} alt={memories[photo].caption} /><p>{memories[photo].caption}</p></>}</dialog>
    </>}
  </div>;
}
