import { useEffect, useRef, useState } from 'react';
import { Music2, Pause, Play } from 'lucide-react';

type Player = { playVideo: () => void; pauseVideo: () => void; setVolume: (volume: number) => void; destroy: () => void };
type YoutubeAPI = { Player: new (element: HTMLElement, options: Record<string, unknown>) => Player };
const VIDEO = '8g3KHA8ROiA';
let apiPromise: Promise<YoutubeAPI> | undefined;
function loadAPI() {
  if (!apiPromise) apiPromise = new Promise((resolve, reject) => {
    const win = window as typeof window & { YT?: YoutubeAPI; onYouTubeIframeAPIReady?: () => void };
    if (win.YT?.Player) { resolve(win.YT); return; }
    win.onYouTubeIframeAPIReady = () => { if (win.YT) resolve(win.YT); };
    const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.onerror = reject; document.head.append(script);
  });
  return apiPromise;
}
export function BirthdayMusic({ personalPlaying, onBackgroundPlay }: { personalPlaying: boolean; onBackgroundPlay: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const pausedForSong = useRef(false);
  const playingRef = useRef(false);
  const onPlayRef = useRef(onBackgroundPlay);
  onPlayRef.current = onBackgroundPlay;
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [volume, setVolume] = useState(15);
  useEffect(() => {
    let disposed = false;
    void loadAPI().then(api => {
      if (disposed || !container.current) return;
      const element = document.createElement('div'); container.current.append(element);
      player.current = new api.Player(element, { width: '100%', height: 220, videoId: VIDEO, playerVars: { playsinline: 1, loop: 1, playlist: VIDEO, origin: window.location.origin }, events: {
        onReady: () => { if (disposed) return; player.current?.setVolume(15); setReady(true); },
        onStateChange: ({ data }: { data: number }) => { if (disposed) return; playingRef.current = data === 1; setPlaying(data === 1); if (data === 1) onPlayRef.current(); },
        onError: () => { if (!disposed) { setError(true); setPlaying(false); } },
      } });
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; player.current?.destroy(); player.current = null; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const start = () => { if (!personalPlaying) player.current?.playVideo(); };
    document.addEventListener('pointerdown', start, { once: true });
    return () => document.removeEventListener('pointerdown', start);
  }, [ready, personalPlaying]);
  useEffect(() => {
    if (personalPlaying) { pausedForSong.current = playingRef.current; player.current?.pauseVideo(); }
    else if (pausedForSong.current) { pausedForSong.current = false; player.current?.playVideo(); }
  }, [personalPlaying]);
  const toggle = () => { if (playing) player.current?.pauseVideo(); else player.current?.playVideo(); };
  return <section className="bday-background-song" aria-label="Música de fondo">
    <div><span className="bday-eyebrow">PARA ACOMPAÑAR ESTE RATITO</span><h3>Te encontré · El Vega</h3><p>Una canción bajita, para disfrutar lo nuestro.</p><label>Volumen <input aria-label="Volumen de la música de fondo" type="range" min="0" max="100" value={volume} onChange={event => { const next = Number(event.target.value); setVolume(next); player.current?.setVolume(next); }} /> {volume}%</label>{error && <p role="status">Puedes <a href={`https://www.youtube.com/watch?v=${VIDEO}`} target="_blank" rel="noreferrer">escuchar la canción en YouTube</a>.</p>}</div>
    <div className="bday-youtube" ref={container} />
    <button className="bday-floating-music" disabled={!ready || error} onClick={toggle} aria-label={playing ? 'Pausar Te encontré' : 'Reproducir Te encontré'}><Music2 size={18} /><span>Te encontré<small>{playing ? 'El Vega · sonando bajito' : 'El Vega · tocar para escuchar'}</small></span>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
  </section>;
}
