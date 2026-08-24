import React from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '../context/LanguageContext';

interface Project {
  title: string;
  description: string;
  logoSrc: string;
  isPlaceholder?: boolean;
  link?: string;
  bgClass?: string;
  pClass?: string;
}

export const Projects: React.FC = () => {
  const { t } = useLanguage();

  const projectsList: Project[] = [
    {
      title: 'LukApp',
      description: t.projects.lukappDesc,
      logoSrc: '/lukapp-icon-512.png',
      link: 'https://lukapp.app',
      bgClass: 'bg-[#18181b]',
      pClass: 'p-1 rounded-lg',
    },
    {
      title: 'AutoSuite',
      description: t.projects.autosuiteDesc,
      logoSrc: '/logoautosuite.webp',
      link: 'https://autosuite.online/',
      bgClass: 'bg-white',
      pClass: 'p-2',
    },
    {
      title: 'World Business Services',
      description: t.projects.wbsDesc,
      logoSrc: '/logowbs.webp',
      link: 'https://www.worldbusinessservicesfl.com/',
      bgClass: 'bg-transparent',
      pClass: 'p-0',
    },
    {
      title: 'Monkey Man Project',
      description: t.projects.monkeymanDesc,
      logoSrc: '/logomonkeyman.jpg',
      link: 'https://monkeymanproject.com',
      bgClass: 'bg-transparent',
      pClass: 'p-0',
    },
  ];

  return (
    <section 
      id="proyectos" 
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
          {t.projects.title}
        </motion.h2>
        <motion.span 
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="mt-2 text-xs font-bold tracking-[0.5em] text-gradient uppercase"
          dangerouslySetInnerHTML={{ __html: t.projects.subtitle }}
        />
      </div>

      {/* Projects Grid */}
      <div className="grid gap-8 md:grid-cols-2">
        {projectsList.map((project, idx) => {
          const CardComponent = project.link ? motion.a : motion.div;
          const linkProps = project.link 
            ? { href: project.link, target: '_blank', rel: 'noopener noreferrer' } 
            : {};

          return (
            <CardComponent
              key={project.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              whileHover={{ y: -8, transition: { duration: 0.2 } }}
              className={`flex items-center gap-6 rounded-2xl border border-white/[0.06] bg-neutral-950 p-6 shadow-xl transition-colors duration-300 hover:border-white/10 ${
                project.isPlaceholder ? 'opacity-80' : ''
              } ${project.link ? 'cursor-pointer hover:bg-neutral-900/40' : ''}`}
              {...linkProps}
            >
              {/* Logo / Placeholder Icon */}
              <div 
                className={`relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 ${project.bgClass}`}
              >
                <img
                  src={project.logoSrc}
                  alt={`${project.title} Logo`}
                  className={`h-full w-full object-contain ${project.pClass}`}
                />
              </div>

              {/* Text Info */}
              <div className="flex flex-col justify-center">
                <h3 className="font-display text-lg font-bold tracking-wide text-white">
                  {project.title}
                </h3>
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-neutral-400">
                  {project.description}
                </p>
              </div>
            </CardComponent>
          );
        })}
      </div>
    </section>
  );
};
