import React from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '../context/LanguageContext';
import { useSmoothScroll } from '../hooks/useSmoothScroll';

export const Hero: React.FC = () => {
  const { t } = useLanguage();
  const { scrollToSection } = useSmoothScroll();

  return (
    <section 
      id="hero" 
      className="relative flex min-h-[calc(100vh-80px)] items-center justify-center px-6 py-12 text-center md:px-12"
    >
      <div className="flex flex-col items-center max-w-2xl">
        {/* Circular 3D Developer Avatar Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="relative mb-8 h-36 w-36 overflow-hidden rounded-full border border-white/10 bg-neutral-900 shadow-2xl md:h-40 md:w-40"
        >
          <img 
            src="/picture-profile.webp" 
            alt="Julian Gonzalez Avatar" 
            className="h-full w-full object-cover rounded-full"
          />
        </motion.div>

        {/* Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="font-display text-4xl font-extrabold tracking-tight text-white sm:text-5xl md:text-6xl"
        >
          Julian Gonzalez
        </motion.h1>

        {/* Subtitle */}
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-3 font-sans text-lg font-semibold tracking-wider text-neutral-400 uppercase sm:text-xl"
        >
          {t.hero.role}
        </motion.h2>

        {/* Description */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-6 text-sm leading-relaxed text-neutral-400 sm:text-base md:text-lg"
        >
          {t.hero.description}
        </motion.p>

        {/* Elegant Outline Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-8"
        >
          <motion.a
            href="#contacto"
            onClick={(e) => scrollToSection(e, 'contacto')}
            whileHover={{ scale: 1.05, borderColor: '#ffffff', backgroundColor: 'rgba(255, 255, 255, 0.05)' }}
            whileTap={{ scale: 0.95 }}
            className="inline-flex items-center justify-center rounded-full border border-white/20 px-8 py-3.5 text-xs font-semibold tracking-widest text-white transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black uppercase"
          >
            {t.hero.contactBtn}
          </motion.a>
        </motion.div>
      </div>
    </section>
  );
};
