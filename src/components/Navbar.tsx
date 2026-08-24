import React, { useEffect, useId, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogIn, Menu, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useSmoothScroll } from '../hooks/useSmoothScroll';

/** Matches Tailwind's `md`, the breakpoint the desktop links appear at. */
const DESKTOP_QUERY = '(min-width: 48rem)';

export const Navbar: React.FC = () => {
  const { language, toggleLanguage, t } = useLanguage();
  const { scrollToSection } = useSmoothScroll();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();

  // The panel is only reachable below `md`, so growing past that breakpoint has
  // to close it — otherwise the toggle unmounts while open and the menu is
  // stuck rendered with no control left to dismiss it.
  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const close = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener('change', close);
    return () => desktop.removeEventListener('change', close);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const navigate = (e: React.MouseEvent<HTMLAnchorElement>, targetId: string) => {
    setMenuOpen(false);
    scrollToSection(e, targetId);
  };

  const languageToggle = (
    <button
      onClick={toggleLanguage}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-neutral-950/40 px-3.5 py-1.5 text-[10px] font-bold tracking-wider text-neutral-400 hover:bg-white/5 hover:text-white transition-all cursor-pointer uppercase"
      aria-label={language === 'es' ? 'Switch to English' : 'Cambiar a Español'}
    >
      <span className={language === 'es' ? 'text-white' : 'text-neutral-500'}>ES</span>
      <span className="text-neutral-700">|</span>
      <span className={language === 'en' ? 'text-white' : 'text-neutral-500'}>EN</span>
    </button>
  );

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.08] bg-black/60 backdrop-blur-md">
      <div className="mx-auto flex h-20 max-w-5xl items-center justify-between gap-3 px-6 md:px-12">
        {/* Monogram Logo on Left. `shrink-0` is load-bearing: as a flex child the
            image would otherwise be compressed to a sliver on narrow screens. */}
        <a href="#hero" className="flex shrink-0 items-center gap-2 outline-none group" aria-label="Julian Gonzalez Portfolio Home">
          <img
            src="/imagenarribaJulianGonzalez.webp"
            alt="Julian Gonzalez Monogram"
            className="h-7 w-auto object-contain brightness-100 transition-opacity group-hover:opacity-80"
          />
        </a>

        <nav className="flex items-center gap-3 md:gap-4" aria-label="Navegación principal">
          {languageToggle}

          {/* A plain href, not a scroll handler: /finanzas is a separate HTML
              entry with its own bundle, so a client-side transition would only
              hand it to the portfolio's router and land back here. */}
          <a
            href="https://lukapp.app" target="_blank" rel="noopener noreferrer"
            aria-label={t.navbar.login}
            title={t.navbar.login}
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-neutral-950/40 p-2 text-neutral-400 transition-colors hover:border-white/25 hover:text-white"
          >
            <LogIn className="h-4 w-4" strokeWidth={2.5} />
          </a>

          {/* Full-width links from `md`. Below that the labels cannot share the
              row with the logo and toggle without wrapping, so they move into
              the panel behind the toggle button. */}
          <a
            href="#sobre-mi"
            onClick={(e) => navigate(e, 'sobre-mi')}
            className="hidden md:inline-flex items-center justify-center whitespace-nowrap rounded-full border border-white/20 bg-transparent px-5 py-2 text-xs font-semibold tracking-wider text-white transition-all duration-300 hover:border-white hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black uppercase"
          >
            {t.navbar.about}
          </a>
          <motion.a
            href="#contacto"
            onClick={(e) => navigate(e, 'contacto')}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="hidden md:inline-flex items-center justify-center whitespace-nowrap rounded-full bg-white px-6 py-2.5 text-xs font-bold tracking-wider text-black transition-colors hover:bg-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black uppercase"
          >
            {t.navbar.contact}
          </motion.a>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/20 p-2.5 text-white transition-colors hover:bg-white/5 md:hidden"
            aria-label={t.navbar.menu}
            aria-expanded={menuOpen}
            aria-controls={menuId}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </nav>
      </div>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            id={menuId}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden border-t border-white/[0.08] bg-black/90 backdrop-blur-md md:hidden"
          >
            <div className="flex flex-col gap-3 px-6 py-5">
              <a
                href="#sobre-mi"
                onClick={(e) => navigate(e, 'sobre-mi')}
                className="inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-3 text-xs font-semibold tracking-wider text-white transition-all hover:border-white hover:bg-white/5 uppercase"
              >
                {t.navbar.about}
              </a>
              <a
                href="#contacto"
                onClick={(e) => navigate(e, 'contacto')}
                className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-xs font-bold tracking-wider text-black transition-colors hover:bg-neutral-200 uppercase"
              >
                {t.navbar.contact}
              </a>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
};
