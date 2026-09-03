import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Flower2, Heart, Music2, Sparkles, Volume2, VolumeX } from 'lucide-react';
import './EllaYYo.css';

const YOUTUBE_ID = 'WEBiMXDRd7Y';
const SONG_PREVIEW = 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview112/v4/b7/b4/9f/b7b49f81-e619-9611-d84b-8c8c9923c140/mzaf_16495839980082110831.plus.aac.p.m4a';

const photos = [
  { src: '/ellayyo/juntos.webp', alt: 'Kamila y Julián sonriendo juntos', note: 'Tu sonrisa y la mía, en el mismo lugar.' },
  { src: '/ellayyo/beso.webp', alt: 'Kamila y Julián dándose un beso', note: 'De todos mis lugares favoritos, siempre tú.' },
  { src: '/ellayyo/cumple.webp', alt: 'Kamila y Julián celebrando juntos', note: 'Los detalles importan. Tú me lo enseñaste.' },
  { src: '/ellayyo/sonrisas.webp', alt: 'Kamila y Julián abrazados y sonriendo', note: 'Contigo hasta una foto movida se siente perfecta.' },
  { src: '/ellayyo/primer-plano.webp', alt: 'Kamila y Julián tomándose una selfie', note: 'Dos loquitos, un montón de recuerdos.' },
  { src: '/ellayyo/abrazo.webp', alt: 'Kamila y Julián abrazándose', note: 'Quiero que mis brazos vuelvan a sentirse como paz.' },
];

const stitchPhotos = [
  { src: '/ellayyo/stitch/stitch-live-bed.webp', alt: 'Stitch con un collar de flores', note: 'Stitch vino bonito porque la ocasión lo merece.' },
  { src: '/ellayyo/stitch/stitch-chair.webp', alt: 'Stitch descansando con gafas de sol', note: 'Esperando pacientemente a que presiones el botón azul.' },
  { src: '/ellayyo/stitch/stitch-live-soda.webp', alt: 'Stitch cantando con mucha emoción', note: 'Prométeme, versión experimento 626.' },
  { src: '/ellayyo/stitch/stitch-family.webp', alt: 'Stitch sonriendo en la playa', note: 'Esa es la cara que pondré si dices que sí.' },
  { src: '/ellayyo/stitch/stitch-elvis.webp', alt: 'Stitch tocando guitarra en la playa', note: 'Una serenata intergaláctica para ti.' },
  { src: '/ellayyo/stitch/stitch-glitch.webp', alt: 'Lilo y Stitch compartiendo un momento juntos', note: 'Ohana también es reparar lo que importa.' },
  { src: '/ellayyo/stitch/stitch-hero.webp', alt: 'Lilo y Stitch bailando juntos', note: 'Y después del perdón, un bailecito potito.' },
];

const escapeLabels = [
  'No',
  '¿Cómo que no? 🥺',
  'Piénsalo un potito',
  'Stitch no acepta ese no 💙',
  'Ajá… inténtalo otra vez',
  'Ese botón no sirve 👀',
  '¿Y si te digo porfis?',
  'No me rindo tan fácil',
  'Mira el botón azulito',
  'Stitch votó que sí',
  'Te amo, piénsalo otra vez',
  'Nop, por aquí tampoco',
];

function ForgivenessGate({ onYes }: { onYes: () => void }) {
  const arenaRef = useRef<HTMLDivElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  const lastEscapeRef = useRef(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [escapes, setEscapes] = useState(0);
  const [needsTime, setNeedsTime] = useState(false);
  const [secret, setSecret] = useState(false);

  const moveNo = () => {
    if (needsTime) return;

    const now = performance.now();
    if (now - lastEscapeRef.current < 180) return;
    lastEscapeRef.current = now;

    if (escapes >= escapeLabels.length - 1) {
      setPosition({ x: 0, y: 0 });
      setNeedsTime(true);
      return;
    }

    const arena = arenaRef.current;
    const yesButton = yesRef.current;
    const noButton = noRef.current;

    if (arena && yesButton && noButton) {
      const arenaBox = arena.getBoundingClientRect();
      const yesBox = yesButton.getBoundingClientRect();
      const noBox = noButton.getBoundingClientRect();
      const baseLeft = noBox.left - position.x;
      const baseTop = noBox.top - position.y;
      const minX = arenaBox.left + 8 - baseLeft;
      const maxX = arenaBox.right - 8 - noBox.width - baseLeft;
      const minY = arenaBox.top + 8 - baseTop;
      const maxY = arenaBox.bottom - 8 - noBox.height - baseTop;
      let nextPosition = position;

      for (let attempt = 0; attempt < 24; attempt += 1) {
        const x = minX + Math.random() * Math.max(0, maxX - minX);
        const y = minY + Math.random() * Math.max(0, maxY - minY);
        const candidate = {
          left: baseLeft + x,
          right: baseLeft + x + noBox.width,
          top: baseTop + y,
          bottom: baseTop + y + noBox.height,
        };
        const overlapsYes = candidate.left < yesBox.right + 10
          && candidate.right > yesBox.left - 10
          && candidate.top < yesBox.bottom + 10
          && candidate.bottom > yesBox.top - 10;

        if (!overlapsYes) {
          nextPosition = { x, y };
          break;
        }
      }

      setPosition(nextPosition);
    }
    setEscapes((value) => value + 1);
  };

  return (
    <div className="forgiveness-gate">
      <div className="gate-stars" aria-hidden="true">✦ · ✧ · ✦ · ✧ · ✦</div>
      <button className="gate-stitch-cutout" type="button" onClick={() => setSecret(true)} aria-label="Descubrir un mensaje secreto de Stitch">
        <img src="/ellayyo/stitch/stitch-transparent.png" alt="Stitch enamorado" />
      </button>
      <div className="gate-card">
        <span className="eyebrow">Una preguntita antes de entrar…</span>
        <h1>¿Me perdonas,<br /><em>mi 11:11?</em></h1>
        <p>No porque una página borre lo que pasó, sino porque quiero empezar por reconocerlo de verdad.</p>

        <div className="button-arena" ref={arenaRef}>
          <button className="yes-button" type="button" onClick={onYes} ref={yesRef}>
            Sí, ven acá <Heart size={18} fill="currentColor" />
          </button>
          <button
            className="no-button"
            type="button"
            ref={noRef}
            style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
            onPointerEnter={moveNo}
            onPointerDown={(event) => {
              event.preventDefault();
              moveNo();
            }}
            onFocus={moveNo}
            aria-label="Todavía no"
          >
            {needsTime ? 'Si todavía no también lo entiendo' : escapeLabels[escapes]}
          </button>
        </div>

        {needsTime && (
          <div className="soft-message" role="status">
            Está bien, mi vida. No tienes que responder ahora. Voy a respetar tu tiempo y seguir trabajando en hacerlo mejor. 🤍
          </div>
        )}
        {secret && <div className="secret-toast" role="status">Stitch encontró un secreto: eres mi persona favorita en toda la galaxia 💙</div>}
      </div>
      <p className="gate-signature">Hecho con el corazón y un poquito de código — Julián</p>
    </div>
  );
}

function MusicControl({ playing, onToggle }: { playing: boolean; onToggle: () => void }) {
  return (
    <button className="music-control" type="button" onClick={onToggle} aria-label={playing ? 'Pausar canción' : 'Reproducir canción'}>
      <span className={playing ? 'music-pulse' : ''}>{playing ? <Volume2 size={19} /> : <VolumeX size={19} />}</span>
      <span><strong>Prométeme</strong><small>Andrés Cepeda</small></span>
    </button>
  );
}

function LoveLetter() {
  const [open, setOpen] = useState(false);

  return (
    <section className="letter-section" id="carta">
      <div className="section-tag"><span>02</span> Lo que sí tenía que decir</div>
      <div className={`letter-envelope ${open ? 'is-open' : ''}`}>
        {!open && (
          <button type="button" onClick={() => setOpen(true)}>
            <span>Para: mi niña tonsentida</span>
            <Heart size={28} fill="currentColor" />
            <small>Toca para abrir</small>
          </button>
        )}
        <article className="letter-paper">
          <p className="letter-date">2 de septiembre de 2026</p>
          <h2>Ojitos</h2>
          <p>Hoy no necesitabas un regaño ni una lista de soluciones</p>
          <p>Necesitabas sentir que tu novio estaba de tu lado y que te escuchaba de verdad</p>
          <p>Me preocupé por ti pero eso no justifica cómo te hablé</p>
          <p>Insistí cuando ya me habías explicado y te hice sentir juzgada</p>
          <p>Cuando dijiste que no querías hablar respondí desde la rabia y decirte "váyase entonces" estuvo mal</p>
          <p>No era la forma de cuidar a la persona que amo</p>
          <p>Tampoco quiero defenderme enumerando todo lo bueno que hago</p>
          <p>Lo que sentiste importa aunque mi intención haya sido otra</p>
          <p>Me duele saber que cuando buscabas refugio en mí soné como las voces que ya te lastiman en casa</p>
          <p>No hice esto para comprar tu perdón</p>
          <p>Lo hice porque quería detenerme y pensar en ti para decirte con calma lo que en una pelea no supe decir</p>
          <p><strong>Te escucho y reconozco mi error</strong></p>
          <p><strong>Quiero aprender a amarte de una manera que también se sienta como amor para ti</strong></p>
          <p>Te amo mucho mi 11:11</p>
          <p className="letter-signature">— Tu gordito Julián</p>
        </article>
      </div>
    </section>
  );
}

export function EllaYYo() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [accepted, setAccepted] = useState(false);
  const [musicOn, setMusicOn] = useState(false);
  const [finalMessage, setFinalMessage] = useState(false);
  const [easterEggs, setEasterEggs] = useState(0);
  const [heroPrompt, setHeroPrompt] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Ella y yo 💙 | Para Kamila';
    document.documentElement.classList.add('ellayyo-page');

    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = 'noindex, nofollow, noarchive';

    return () => {
      document.title = previousTitle;
      document.documentElement.classList.remove('ellayyo-page');
    };
  }, []);

  const accept = () => {
    void audioRef.current?.play().catch(() => setMusicOn(false));
    setAccepted(true);
    setMusicOn(true);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
  };

  const toggleMusic = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().then(() => setMusicOn(true)).catch(() => setMusicOn(false));
    } else {
      audio.pause();
      setMusicOn(false);
    }
  };

  const soundtrack = (
    <audio
      ref={audioRef}
      src={SONG_PREVIEW}
      loop
      preload="none"
      onPlay={() => setMusicOn(true)}
      onPause={() => setMusicOn(false)}
    />
  );

  return (
    <>
      {soundtrack}
      {!accepted ? <ForgivenessGate onYes={accept} /> : <div className="ellayyo">
      <MusicControl playing={musicOn} onToggle={toggleMusic} />
      <div className="floating-hearts" aria-hidden="true"><span>♡</span><span>✦</span><span>♡</span><span>✿</span></div>

      <header className="love-hero">
        <img src="/ellayyo/abrazo.webp" alt="Kamila y Julián abrazándose frente a la ciudad" />
        <div className="hero-shade" />
        <div className="hero-copy">
          <span className="eyebrow">Para María Kamila, con todo mi corazón</span>
          <h1>Ella y yo.</h1>
          <p>Una historia imperfecta, bonita y muy nuestra.</p>
          <a href="#carta" onClick={(event) => { event.preventDefault(); setHeroPrompt(true); }}>
            {heroPrompt ? 'Desliza un poco más' : 'Hay algo que quiero decirte'} <ChevronDown size={20} />
          </a>
        </div>
        <button className="eleven-eleven" type="button" onClick={() => setEasterEggs((value) => value + 1)} aria-label="Pedir un deseo a las 11:11">
          <span>11:11</span><small>pide un deseo</small>
        </button>
      </header>

      <main>
        <section className="truth-section">
          <div className="section-tag"><span>01</span> Primero, la verdad</div>
          <p className="big-truth">No quiero tener la razón.<br /><em>Quiero entenderte mejor.</em></p>
          <div className="truth-grid">
            <p>Una buena intención pierde su valor cuando la forma hiere.</p>
            <p>Escucharte también significa no interrumpir tu dolor con mis defensas.</p>
            <p>Cuidarte no es decidir por ti. Es preguntarte cómo puedo acompañarte.</p>
          </div>
        </section>

        <LoveLetter />

        <section className="promises-section">
          <div className="section-tag light"><span>03</span> Menos palabras, más acciones</div>
          <h2>No te prometo ser perfecto.<br />Sí me comprometo a esto:</h2>
          <div className="promise-list">
            <article><span>01</span><div><h3>Escuchar antes de solucionar</h3><p>Preguntarte: «¿quieres que te escuche o pensamos juntos qué hacer?»</p></div></article>
            <article><span>02</span><div><h3>Cuidar también la forma</h3><p>No usar mi preocupación como permiso para regañarte, insistir o minimizar lo que sientes.</p></div></article>
            <article><span>03</span><div><h3>Volver a los detalles</h3><p>Más flores, más cartas, más tiempo pensado para ti. Porque sé que para ti los detalles sí hablan.</p></div></article>
          </div>
        </section>

        <section className="gallery-section">
          <div className="section-tag"><span>04</span> Nosotros, en momentos bonitos</div>
          <div className="gallery-heading">
            <h2>Un pedacito de<br />todo lo nuestro.</h2>
            <p>Toca cada foto. Algunas cosas bonitas merecen volver a mirarse sin prisa.</p>
          </div>
          <div className="photo-grid">
            {photos.map((photo, index) => (
              <button className={`photo-card photo-${index + 1}`} type="button" key={photo.src}>
                <img src={photo.src} alt={photo.alt} loading={index > 1 ? 'lazy' : 'eager'} />
                <span>{photo.note}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="stitch-section">
          <div className="section-tag"><span>05</span> El comité intergaláctico del perdón</div>
          <div className="stitch-heading">
            <div>
              <span className="eyebrow">Stitch también vino a insistir</span>
              <h2>Ohana significa que nadie se rinde con quien ama.</h2>
            </div>
            <p>Reuní un pequeño ejército azul para recordarte que mi lugar favorito sigue siendo contigo.</p>
          </div>
          <div className="stitch-grid">
            {stitchPhotos.map((photo, index) => (
              <button type="button" className={`stitch-card stitch-card-${index + 1}`} key={photo.src} onClick={() => setEasterEggs((value) => value + 1)}>
                <img src={photo.src} alt={photo.alt} loading="lazy" />
                <span>{photo.note}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="final-section">
          <Flower2 className="final-flower" size={46} />
          <span className="eyebrow">Una promesa que empieza hoy</span>
          <h2>Quiero que mis acciones<br />te den la paz que mis palabras no supieron darte.</h2>
          {!finalMessage ? (
            <button type="button" onClick={() => setFinalMessage(true)}>¿Me dejas intentarlo mejor? <Heart size={19} fill="currentColor" /></button>
          ) : (
            <div className="final-reveal">
              <Sparkles size={22} />
              <p>Gachas, mi vida. Te amo con toda mi alma. Ahora me toca demostrártelo bonito.</p>
              <Sparkles size={22} />
            </div>
          )}
          <p className="tiny-note">No tienes que responder ya. Esta página se queda aquí para ti.</p>
        </section>
      </main>

      <footer className="love-footer">
        <span>J + K</span>
        <p>Hecho a mano, con amor, errores de ortografía y mucho potito corazón.<small>Stitch PNG: PNGimg · CC BY-NC 4.0</small></p>
        <a href={`https://www.youtube.com/watch?v=${YOUTUBE_ID}`} target="_blank" rel="noreferrer"><Music2 size={16} /> Escuchar Prométeme</a>
      </footer>

      {easterEggs > 0 && (
        <div className="egg-toast" role="status" onClick={() => setEasterEggs(0)}>
          {easterEggs === 1 ? 'Deseo guardado: que volvamos a ser paz 💫' : 'Encontraste otro secreto: te escogería en todas las galaxias 💙'}
        </div>
      )}
      </div>}
    </>
  );
}
