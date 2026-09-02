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

const escapeLabels = [
  'No',
  '¿Segura? 🥺',
  'Piénsalo un potito',
  'Stitch dice que sí 💙',
  'Última oportunidad 👀',
  'Bueno, te doy tiempo',
];

function StitchFriend({ onSecret }: { onSecret?: () => void }) {
  return (
    <button className="stitch-friend" type="button" onClick={onSecret} aria-label="Descubrir un mensaje secreto de Stitch">
      <span className="stitch-ear stitch-ear-left" />
      <span className="stitch-ear stitch-ear-right" />
      <span className="stitch-head">
        <span className="stitch-eye stitch-eye-left" />
        <span className="stitch-eye stitch-eye-right" />
        <span className="stitch-nose" />
        <span className="stitch-smile" />
      </span>
      <span className="stitch-flower">✿</span>
    </button>
  );
}

function ForgivenessGate({ onYes }: { onYes: () => void }) {
  const arenaRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [escapes, setEscapes] = useState(0);
  const [needsTime, setNeedsTime] = useState(false);
  const [secret, setSecret] = useState(false);

  const moveNo = () => {
    if (escapes >= escapeLabels.length - 1) {
      setNeedsTime(true);
      return;
    }

    const arena = arenaRef.current;
    const maxX = Math.max(90, (arena?.clientWidth ?? 360) / 2 - 72);
    const maxY = Math.max(55, (arena?.clientHeight ?? 210) / 2 - 30);
    const direction = escapes % 2 === 0 ? 1 : -1;
    setPosition({
      x: direction * (40 + Math.random() * maxX),
      y: (Math.random() * 2 - 1) * maxY,
    });
    setEscapes((value) => value + 1);
  };

  return (
    <div className="forgiveness-gate">
      <div className="gate-stars" aria-hidden="true">✦ · ✧ · ✦ · ✧ · ✦</div>
      <StitchFriend onSecret={() => setSecret(true)} />
      <div className="gate-card">
        <span className="eyebrow">Una preguntita antes de entrar…</span>
        <h1>¿Me perdonas,<br /><em>mi 11:11?</em></h1>
        <p>No porque una página borre lo que pasó, sino porque quiero empezar por reconocerlo de verdad.</p>

        <div className="button-arena" ref={arenaRef}>
          <button className="yes-button" type="button" onClick={onYes}>
            Sí, ven acá <Heart size={18} fill="currentColor" />
          </button>
          <button
            className="no-button"
            type="button"
            style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
            onPointerEnter={moveNo}
            onPointerDown={(event) => {
              event.preventDefault();
              moveNo();
            }}
            onFocus={moveNo}
            aria-label="Todavía no"
          >
            {escapeLabels[Math.min(escapes, escapeLabels.length - 1)]}
          </button>
        </div>

        <button className="time-link" type="button" onClick={() => setNeedsTime(true)}>
          Si todavía no, también lo entiendo
        </button>

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
          <h2>Kamila, perdóname.</h2>
          <p>Hoy no necesitabas un regaño ni una lista de soluciones. Necesitabas sentir que tu novio estaba de tu lado, que te escuchaba y que entendía por qué estabas cansada.</p>
          <p>Me preocupé por ti, sí, pero eso no justifica cómo te hablé. Insistí cuando ya me habías explicado, te hice sentir juzgada y, cuando dijiste que no querías hablar, respondí desde la rabia. Decirte «váyase entonces» estuvo mal. No era la forma de cuidar a la persona que amo.</p>
          <p>Tampoco quiero defenderme enumerando todo lo bueno que hago. Lo que sentiste importa, aunque mi intención haya sido otra. Y me duele saber que, cuando buscabas refugio en mí, soné como las voces que ya te lastiman en casa.</p>
          <p>No hice esto para comprar tu perdón. Lo hice porque quería detenerme, pensar en ti y decirte con calma lo que en una pelea no supe decir: <strong>te escucho, reconozco mi error y quiero aprender a amarte de una manera que también se sienta como amor para ti.</strong></p>
          <p>Te amo mucho, mi 11:11.</p>
          <p className="letter-signature">— Tu gordito, Julián</p>
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
          <a href="#carta">Hay algo que quiero decirte <ChevronDown size={20} /></a>
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
          <StitchFriend onSecret={() => setEasterEggs((value) => value + 1)} />
          <div>
            <span className="eyebrow">Mensaje intergaláctico</span>
            <h2>Mi lugar favorito sigue siendo contigo.</h2>
            <p>Incluso cuando toca reparar, aprender y volver a intentarlo con más amor.</p>
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
        <p>Hecho a mano, con amor, errores de ortografía y mucho potito corazón.</p>
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
