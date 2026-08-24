import React from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '../context/LanguageContext';

export const AboutMe: React.FC = () => {
  const { t } = useLanguage();

  return (
    <section 
      id="sobre-mi" 
      className="mx-auto max-w-4xl px-6 py-20 text-center md:px-12 md:py-28"
    >
      {/* Header and Subheader */}
      <div className="mb-12 flex flex-col items-center">
        <motion.h2 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="font-display text-4xl font-extrabold tracking-widest text-white sm:text-5xl uppercase"
        >
          {t.about.title}
        </motion.h2>
        <motion.span 
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="mt-2 text-xs font-bold tracking-[0.5em] text-gradient uppercase"
          dangerouslySetInnerHTML={{ __html: t.about.subtitle }}
        />
      </div>

      {/* Description Paragraphs */}
      <div className="mx-auto max-w-2xl space-y-6 text-sm leading-relaxed text-neutral-400 sm:text-base">
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          {t.about.p1}
        </motion.p>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          {t.about.p2}
        </motion.p>
      </div>

      {/* Solid White Button */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.6, delay: 0.5 }}
        className="mt-12"
      >
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="inline-flex items-center justify-center rounded-full bg-white px-8 py-3.5 text-xs font-bold tracking-widest text-black transition-colors hover:bg-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black uppercase"
          onClick={() => {
            const expSection = document.getElementById('experiencia');
            if (expSection) {
              const offset = 80;
              const bodyRect = document.body.getBoundingClientRect().top;
              const elementRect = expSection.getBoundingClientRect().top;
              const elementPosition = elementRect - bodyRect;
              const offsetPosition = elementPosition - offset;
              window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
            }
          }}
        >
          {t.about.moreBtn}
        </motion.button>
      </motion.div>
    </section>
  );
};
