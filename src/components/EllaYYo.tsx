import { useCallback, useEffect, useRef, useState } from 'react';
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

const FIRST_KISS_YEAR = 2024;
const BOGOTA_TIME_ZONE = 'America/Bogota';

function anniversaryDate(year: number) {
  return new Date(Date.UTC(year, 8, 3, 22, 0, 0));
}

function getAnniversaryCountdown(now: Date) {
  const bogotaYear = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: BOGOTA_TIME_ZONE,
    year: 'numeric',
  }).format(now));
  let targetYear = Math.max(2026, bogotaYear);
  let target = anniversaryDate(targetYear);

  // Keep the four zeroes visible for one full second before starting the next year.
  if (now.getTime() > target.getTime() + 999) {
    targetYear += 1;
    target = anniversaryDate(targetYear);
  }

  const totalSeconds = Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const bogotaDateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOGOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const getDatePart = (type: Intl.DateTimeFormatPartTypes) => bogotaDateParts.find((part) => part.type === type)?.value ?? '';
  const bogotaDay = `${getDatePart('year')}-${getDatePart('month')}-${getDatePart('day')}`;

  return { days, hours, minutes, seconds, targetYear, bogotaDay };
}

function AnniversaryCountdown({ onSecret }: { onSecret: (message: string) => void }) {
  const [countdown, setCountdown] = useState(() => getAnniversaryCountdown(new Date()));

  useEffect(() => {
    const timer = window.setInterval(() => setCountdown(getAnniversaryCountdown(new Date())), 250);
    return () => window.clearInterval(timer);
  }, []);

  const anniversaryNumber = countdown.targetYear - FIRST_KISS_YEAR;
  const isTomorrow = countdown.bogotaDay === `${countdown.targetYear}-09-02`;
  const isToday = countdown.bogotaDay === `${countdown.targetYear}-09-03`;
  const helper = countdown.targetYear === 2026
    ? `${isTomorrow ? 'Mañana' : isToday ? 'Hoy' : 'El 3 de septiembre'} a las 5 de la tarde se cumplen dos años exactos`
    : `Ahora cada segundo cuenta para celebrar ${anniversaryNumber} años de ese momento`;

  const units = [
    { value: countdown.days, label: 'Días' },
    { value: countdown.hours, label: 'Horas' },
    { value: countdown.minutes, label: 'Minutos' },
    { value: countdown.seconds, label: 'Segundos' },
  ];

  return (
    <section className="anniversary-section">
      <div className="anniversary-copy">
        <span className="anniversary-kicker">Nuestro primer beso · 03 09 2024</span>
        <h2>El 3 de septiembre cumplimos dos años de nuestro primer beso</h2>
        <p>{helper}</p>
        <small>Próximo beso-versario · 3 de septiembre de {countdown.targetYear} · 5:00 p m</small>
      </div>
      <div className="countdown-clock" aria-live="polite" aria-label={`Faltan ${countdown.days} días ${countdown.hours} horas ${countdown.minutes} minutos y ${countdown.seconds} segundos`}>
        {units.map((unit) => (
          <div className="countdown-unit" key={unit.label}>
            <strong>{String(unit.value).padStart(2, '0')}</strong>
            <span>{unit.label}</span>
          </div>
        ))}
      </div>
      <div className="anniversary-heart" aria-hidden="true" onDoubleClick={() => onSecret('Nuestro primer beso sigue siendo uno de mis lugares favoritos 🤍')}>♡</div>
    </section>
  );
}

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

function LoveLetter({ onSecret }: { onSecret: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const signatureClicks = useRef(0);

  return (
    <section className="letter-section" id="carta">
      <div className="section-tag" onDoubleClick={() => onSecret('Secreto 02: esta carta tenía mucho más que código')}><span>02</span> Lo que sí tenía que decir</div>
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
          <p
            className="letter-signature"
            onClick={() => {
              signatureClicks.current += 1;
              if (signatureClicks.current === 3) onSecret('Firmado tres veces porque te escogería tres y mil veces más 💙');
            }}
          >— Tu gordito Julián</p>
        </article>
      </div>
    </section>
  );
}

export function EllaYYo() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const stitchVoiceRef = useRef<HTMLAudioElement>(null);
  const resumeMusicAfterStitchRef = useRef(false);
  const [accepted, setAccepted] = useState(false);
  const [musicOn, setMusicOn] = useState(false);
  const [finalMessage, setFinalMessage] = useState(false);
  const [, setEasterEggs] = useState(0);
  const [heroPrompt, setHeroPrompt] = useState(false);
  const [stitch626Secret, setStitch626Secret] = useState(false);
  const [activeStitchPhoto, setActiveStitchPhoto] = useState<number | null>(null);
  const [secretMessage, setSecretMessage] = useState<string | null>(null);
  const secretTimerRef = useRef<number | undefined>(undefined);
  const seenPhotosRef = useRef(new Set<number>());
  const seenStitchPhotosRef = useRef(new Set<number>());
  const musicClicksRef = useRef(0);
  const footerClicksRef = useRef(0);

  const revealSecret = useCallback((message: string) => {
    setSecretMessage(message);
    if (secretTimerRef.current) window.clearTimeout(secretTimerRef.current);
    secretTimerRef.current = window.setTimeout(() => setSecretMessage(null), 5200);
  }, []);

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

  useEffect(() => {
    if (!accepted) return;

    let keyboardBuffer = '';
    const discoverTypedSecret = (event: KeyboardEvent) => {
      if (event.key.length !== 1) return;
      keyboardBuffer = `${keyboardBuffer}${event.key.toLowerCase()}`.slice(-12);
      if (keyboardBuffer.endsWith('ohana')) {
        revealSecret('Escribiste OHANA: tú siempre vas a ser parte de mi familia elegida 💙');
        keyboardBuffer = '';
      } else if (keyboardBuffer.endsWith('1111')) {
        revealSecret('Deseo secreto desbloqueado: volver a encontrarnos siempre a las 11:11 ✨');
        keyboardBuffer = '';
      } else if (keyboardBuffer.endsWith('potito')) {
        revealSecret('Contraseña correcta: mi potito corazón siempre te reconoce 🤍');
        keyboardBuffer = '';
      }
    };

    window.addEventListener('keydown', discoverTypedSecret);
    return () => window.removeEventListener('keydown', discoverTypedSecret);
  }, [accepted, revealSecret]);

  useEffect(() => () => {
    if (secretTimerRef.current) window.clearTimeout(secretTimerRef.current);
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

  const toggleMusicWithSecret = () => {
    musicClicksRef.current += 1;
    if (musicClicksRef.current === 4) {
      revealSecret('La canción se puede pausar pero lo que siento por ti no 💙');
    }
    toggleMusic();
  };

  const collectPhotoSecret = (index: number) => {
    seenPhotosRef.current.add(index);
    if (seenPhotosRef.current.size === photos.length) {
      revealSecret('Miraste todos nuestros recuerdos y todavía nos faltan muchísimos por guardar 📸');
    }
  };

  const collectStitchSecret = (index: number) => {
    seenStitchPhotosRef.current.add(index);
    if (seenStitchPhotosRef.current.size === stitchPhotos.length) {
      revealSecret('Stitch confirma que completaste la misión intergaláctica 626 💙');
    }
  };

  const makeWish = () => {
    setEasterEggs((value) => {
      const next = value + 1;
      revealSecret(next === 1 ? 'Deseo guardado: que volvamos a ser paz 💫' : 'Encontraste otro secreto: te escogería en todas las galaxias 💙');
      return next;
    });
  };

  const revealStitch626 = (event: React.MouseEvent<HTMLButtonElement>) => {
    setStitch626Secret(true);
    event.currentTarget.blur();

    const music = audioRef.current;
    const voice = stitchVoiceRef.current;
    if (!voice) return;

    if (music && !music.paused) {
      resumeMusicAfterStitchRef.current = true;
    }
    music?.pause();
    voice.pause();
    voice.currentTime = 0;

    const resumeMusic = () => {
      if (resumeMusicAfterStitchRef.current && music) {
        resumeMusicAfterStitchRef.current = false;
        void music.play().catch(() => setMusicOn(false));
      }
    };

    voice.onended = resumeMusic;
    voice.onerror = resumeMusic;
    void voice.play().catch(resumeMusic);
  };

  const soundtrack = (
    <>
      <audio
        ref={audioRef}
        src={SONG_PREVIEW}
        loop
        preload="none"
        onPlay={() => setMusicOn(true)}
        onPause={() => setMusicOn(false)}
      />
      <audio ref={stitchVoiceRef} src="/ellayyo/stitch/meega-nala-kweesta.mp3" preload="auto" />
    </>
  );

  return (
    <>
      {soundtrack}
      {!accepted ? <ForgivenessGate onYes={accept} /> : <div className="ellayyo">
      <MusicControl playing={musicOn} onToggle={toggleMusicWithSecret} />
      <div className="floating-hearts" aria-hidden="true"><span>♡</span><span>✦</span><span>♡</span><span>✿</span></div>

      <header className="love-hero">
        <img src="/ellayyo/abrazo.webp" alt="Kamila y Julián abrazándose frente a la ciudad" />
        <div className="hero-shade" />
        <div className="hero-copy">
          <span className="eyebrow">Para María Kamila, con todo mi corazón</span>
          <h1 onDoubleClick={() => revealSecret('Plot twist: yo sigo eligiendo a ella en todas las versiones de esta historia 💙')}>Ella y yo.</h1>
          <p>Una historia imperfecta, bonita y muy nuestra.</p>
          <a href="#carta" onClick={(event) => { event.preventDefault(); setHeroPrompt(true); }}>
            {heroPrompt ? 'Desliza un poco más' : 'Hay algo que quiero decirte'} <ChevronDown size={20} />
          </a>
        </div>
        <button className="eleven-eleven" type="button" onClick={makeWish} aria-label="Pedir un deseo a las 11:11">
          <span>11:11</span><small>pide un deseo</small>
        </button>
      </header>

      <main>
        <section className="truth-section">
          <div className="section-tag" onDoubleClick={() => revealSecret('Secreto 01: contigo prefiero la paz antes que tener la razón')}><span>01</span> Primero, la verdad</div>
          <p className="big-truth">No quiero tener la razón.<br /><em>Quiero entenderte mejor.</em></p>
          <div className="truth-grid">
            <p>Una buena intención pierde su valor cuando la forma hiere.</p>
            <p>Escucharte también significa no interrumpir tu dolor con mis defensas.</p>
            <p>Cuidarte no es decidir por ti. Es preguntarte cómo puedo acompañarte.</p>
          </div>
        </section>

        <LoveLetter onSecret={revealSecret} />

        <section className="promises-section">
          <div className="section-tag light" onDoubleClick={() => revealSecret('Secreto 03: quiero cumplirlo bonito y sin excusas')}><span>03</span> Menos palabras, más acciones</div>
          <h2>No te prometo ser perfecto.<br />Sí me comprometo a esto:</h2>
          <div className="promise-list">
            <article><span>01</span><div><h3>Escuchar antes de solucionar</h3><p>Preguntarte: «¿quieres que te escuche o pensamos juntos qué hacer?»</p></div></article>
            <article><span>02</span><div><h3>Cuidar también la forma</h3><p>No usar mi preocupación como permiso para regañarte, insistir o minimizar lo que sientes.</p></div></article>
            <article><span>03</span><div><h3>Volver a los detalles</h3><p>Más flores, más cartas, más tiempo pensado para ti. Porque sé que para ti los detalles sí hablan.</p></div></article>
          </div>
        </section>

        <section className="gallery-section">
          <div className="section-tag" onDoubleClick={() => revealSecret('Secreto 04: todavía faltan muchos recuerdos por guardar')}><span>04</span> Nosotros, en momentos bonitos</div>
          <div className="gallery-heading">
            <h2>Un pedacito de<br />todo lo nuestro.</h2>
            <p>Toca cada foto. Algunas cosas bonitas merecen volver a mirarse sin prisa.</p>
          </div>
          <div className="photo-grid">
            {photos.map((photo, index) => (
              <button className={`photo-card photo-${index + 1}`} type="button" key={photo.src} onClick={() => collectPhotoSecret(index)}>
                <img src={photo.src} alt={photo.alt} loading={index > 1 ? 'lazy' : 'eager'} />
                <span>{photo.note}</span>
              </button>
            ))}
          </div>
        </section>

        <AnniversaryCountdown onSecret={revealSecret} />

        <section className="stitch-section">
          <button
            className={`stitch-626-secret ${stitch626Secret ? 'is-revealed' : ''}`}
            type="button"
            onClick={revealStitch626}
            aria-label={stitch626Secret ? 'Repetir Meega nala kweesta' : 'Descubrir la palabra secreta de Stitch'}
          >
            <img
              src={stitch626Secret ? '/ellayyo/stitch/stitch-angry.png' : '/ellayyo/stitch/stitch-transparent.png'}
              alt={stitch626Secret ? 'Stitch enfadado y rodeado de fuego' : 'Stitch enamorado'}
            />
            <span>{stitch626Secret ? 'Meega nala kweesta' : 'Dame click'}</span>
          </button>
          <div className="section-tag" onDoubleClick={() => revealSecret('Experimento secreto: J + K también significa ohana')}><span>06</span> El comité intergaláctico del perdón</div>
          <div className="stitch-heading">
            <div>
              <span className="eyebrow">Stitch también vino a insistir</span>
              <h2>Ohana significa que nadie se rinde con quien ama.</h2>
            </div>
            <p>Reuní un pequeño ejército azul para recordarte que mi lugar favorito sigue siendo contigo.</p>
          </div>
          <div className="stitch-grid">
            {stitchPhotos.map((photo, index) => (
              <button
                type="button"
                className={`stitch-card stitch-card-${index + 1} ${activeStitchPhoto === index ? 'is-caption-open' : ''}`}
                key={photo.src}
                onClick={() => {
                  collectStitchSecret(index);
                  setActiveStitchPhoto((current) => current === index ? null : index);
                }}
                aria-expanded={activeStitchPhoto === index}
                aria-label={`${photo.alt}. ${activeStitchPhoto === index ? 'Ocultar mensaje' : 'Mostrar mensaje'}`}
              >
                <img src={photo.src} alt={photo.alt} loading="lazy" />
                <span>{photo.note}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="final-section">
          <Flower2 className="final-flower" size={46} onDoubleClick={() => revealSecret('Hasta esta flor sabe que tú sigues siendo mi detalle favorito 🌸')} />
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
        <span onClick={() => {
          footerClicksRef.current += 1;
          if (footerClicksRef.current === 3) revealSecret('J + K: una historia con errores pero también con mucho amor');
        }}>J + K</span>
        <p>Hecho a mano, con amor, errores de ortografía y mucho potito corazón.<small>Stitch PNG: PNGimg · CC BY-NC 4.0</small></p>
        <a href={`https://www.youtube.com/watch?v=${YOUTUBE_ID}`} target="_blank" rel="noreferrer"><Music2 size={16} /> Escuchar Prométeme</a>
      </footer>

      {secretMessage && (
        <div className="egg-toast" role="status" onClick={() => setSecretMessage(null)}>
          {secretMessage}
        </div>
      )}
      </div>}
    </>
  );
}
