import { useEffect, useRef, useState, type RefObject } from 'react';
import { Music2, Pause, Play } from 'lucide-react';

export const BACKGROUND_START_SECONDS = 12.5;
export type BackgroundControl = { pause: () => void };
type Player = { playVideo: () => void; pauseVideo: () => void; seekTo: (seconds: number, allowSeekAhead: boolean) => void; setVolume: (value: number) => void; getCurrentTime: () => number; destroy: () => void };
type YoutubeAPI = { Player: new (element: HTMLElement, options: Record<string, unknown>) => Player };
let apiPromise: Promise<YoutubeAPI> | undefined;
function loadAPI() {
  const win = window as typeof window & { YT?: YoutubeAPI; onYouTubeIframeAPIReady?: () => void };
  if (win.YT?.Player) return Promise.resolve(win.YT);
  if (!apiPromise) apiPromise = new Promise<YoutubeAPI>((resolve, reject) => {
    const previous = win.onYouTubeIframeAPIReady;
    win.onYouTubeIframeAPIReady = () => { previous?.(); if (win.YT) resolve(win.YT); };
    const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.onerror = reject; document.head.append(script);
  });
  return apiPromise;
}
export function BirthdayMusic({ audioRef, personalPlaying, onBackgroundPlay }: { audioRef: RefObject<BackgroundControl | null>; personalPlaying: boolean; onBackgroundPlay: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const onPlay = useRef(onBackgroundPlay);
  const personal = useRef(personalPlaying);
  onPlay.current = onBackgroundPlay;
  personal.current = personalPlaying;
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    audioRef.current = { pause: () => player.current?.pauseVideo() };
    void loadAPI().then(api => {
      if (disposed || !container.current) return;
      const element = document.createElement('div'); container.current.append(element);
      player.current = new api.Player(element, { width: 200, height: 200, videoId: 'oiGCL2Ld534', playerVars: { playsinline: 1, controls: 0, origin: window.location.origin }, events: {
        onReady: () => {
          if (disposed) return;
          player.current?.setVolume(15);
          player.current?.seekTo(BACKGROUND_START_SECONDS, true);
          setReady(true);
          if (!personal.current) player.current?.playVideo();
        },
        onStateChange: ({ data }: { data: number }) => {
          if (disposed) return;
          if (data === 1) { setPlaying(true); onPlay.current(); }
          else setPlaying(false);
          if (data === 0 && !personal.current) { player.current?.seekTo(BACKGROUND_START_SECONDS, true); player.current?.playVideo(); }
        },
        onError: () => { if (!disposed) { setError(true); setPlaying(false); } },
        onAutoplayBlocked: () => { if (!disposed) setPlaying(false); },
      } });
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; player.current?.destroy(); player.current = null; audioRef.current = null; };
  }, [audioRef]);
  useEffect(() => { if (personalPlaying) player.current?.pauseVideo(); }, [personalPlaying]);
  const toggle = () => {
    const song = player.current; if (!song || !ready) return;
    if (playing) song.pauseVideo();
    else { if (song.getCurrentTime() < BACKGROUND_START_SECONDS) song.seekTo(BACKGROUND_START_SECONDS, true); song.playVideo(); }
  };
  return <>
    <div className="bday-background-source" ref={container} aria-hidden="true" />
    <button className="bday-floating-music" onClick={toggle} disabled={!ready || error} aria-label={playing ? 'Pausar La boda' : 'Reproducir La boda'} title="La boda · Cosculluela · desde 0:12,5 · volumen 15%"><Music2 size={18} /><span>La boda<small>{error ? 'No se pudo cargar la canción' : playing ? 'Cosculluela · sonando bajito' : 'Cosculluela · tocar para escuchar'}</small></span>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
  </>;
}
