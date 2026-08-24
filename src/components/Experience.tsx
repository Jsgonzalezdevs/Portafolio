import React from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '../context/LanguageContext';

export const Experience: React.FC = () => {
  const { t } = useLanguage();
  const badges = ['React Native', 'PHP', 'CSS', 'Docker', 'GitHub'];

  return (
    <section 
      id="experiencia" 
      className="mx-auto max-w-4xl px-6 py-20 md:px-12 md:py-28"
    >
      {/* Header and Subheader */}
      <div className="mb-16 flex flex-col items-center text-center">
        <motion.h2 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="font-display text-4xl font-extrabold tracking-widest text-white sm:text-5xl uppercase"
        >
          {t.experience.title}
        </motion.h2>
        <motion.span 
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="mt-2 text-xs font-bold tracking-[0.5em] text-gradient uppercase"
          dangerouslySetInnerHTML={{ __html: t.experience.subtitle }}
        />
      </div>

      {/* Timeline Entry */}
      <div className="relative border-l border-white/10 pl-6 md:pl-10">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="absolute -left-[6px] top-1.5 h-3 w-3 rounded-full bg-white ring-4 ring-black"
        />

        {/* Title and Date Row */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="flex flex-col gap-2 md:flex-row md:items-baseline md:justify-between"
        >
          <h3 className="text-lg font-bold tracking-tight text-white sm:text-xl">
            AutoSuite <span className="font-light text-neutral-400">/ {t.experience.role}</span>
          </h3>
          <span className="text-xs font-semibold tracking-wider text-neutral-400 uppercase md:text-sm">
            {t.experience.date}
          </span>
        </motion.div>

        {/* Timeline Body Text */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-6 space-y-4 text-xs leading-relaxed text-neutral-400 sm:text-sm"
        >
          <p>{t.experience.p1}</p>
          <p>{t.experience.p2}</p>
        </motion.div>

        {/* Tech Badges */}
        <motion.div 
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="mt-8 flex flex-wrap gap-3"
        >
          {badges.map((badge) => (
            <motion.span
              key={badge}
              whileHover={{ scale: 1.05, borderColor: '#ffffff', backgroundColor: 'rgba(255, 255, 255, 0.05)' }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              className="rounded-full border border-white/10 px-4 py-1.5 text-[10px] font-medium tracking-wider text-neutral-300 uppercase transition-colors"
            >
              {badge}
            </motion.span>
          ))}
        </motion.div>
      </div>
    </section>
  );
};
