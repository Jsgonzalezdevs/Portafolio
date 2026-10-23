import { useEffect, useRef, useState } from 'react';
import { Music2, Pause, Play } from 'lucide-react';

// Official Apple Music preview; replace with the supplied full audio when available.
const BACKGROUND_SONG = 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/ed/3b/73/ed3b73a4-fb24-e935-37c3-0fbc9b3c1d60/mzaf_11744097457782634357.plus.aac.p.m4a';
export function BirthdayMusic({ personalPlaying, onBackgroundPlay }: { personalPlaying: boolean; onBackgroundPlay: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const resumeAfterSong = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { if (audio.current) audio.current.volume = 0.15; }, []);
  useEffect(() => {
    const song = audio.current;
    if (!song) return;
    if (personalPlaying) { resumeAfterSong.current = !song.paused; song.pause(); }
    else if (resumeAfterSong.current) { resumeAfterSong.current = false; void song.play().catch(() => setPlaying(false)); }
  }, [personalPlaying]);
  const toggle = () => {
    const song = audio.current; if (!song) return;
    if (song.paused) { setError(false); void song.play().catch(() => setError(true)); }
    else song.pause();
  };
  return <>
    <audio ref={audio} src={BACKGROUND_SONG} loop preload="none" onPlay={() => { setPlaying(true); onBackgroundPlay(); }} onPause={() => setPlaying(false)} onError={() => { setError(true); setPlaying(false); }} />
    <button className="bday-floating-music" onClick={toggle} aria-label={playing ? 'Pausar Te encontré' : 'Reproducir Te encontré'} title="Te encontré · El Vega · adelanto oficial · volumen 15%"><Music2 size={18} /><span>Te encontré<small>{error ? 'Toca para reintentar' : playing ? 'El Vega · sonando bajito' : 'El Vega · tocar para escuchar'}</small></span>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
  </>;
}
