import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'es' | 'en';

interface Translations {
  navbar: {
    about: string;
    contact: string;
    menu: string;
    login: string;
  };
  hero: {
    role: string;
    description: string;
    contactBtn: string;
  };
  about: {
    title: string;
    subtitle: string;
    p1: string;
    p2: string;
    moreBtn: string;
  };
  experience: {
    title: string;
    subtitle: string;
    role: string;
    date: string;
    p1: string;
    p2: string;
  };
  projects: {
    title: string;
    subtitle: string;
    lukappDesc: string;
    autosuiteDesc: string;
    wbsDesc: string;
    monkeymanDesc: string;
    proximamenteTitle: string;
    proximamenteDesc: string;
  };
  footer: {
    tagline1: string;
    tagline2: string;
    copyright: string;
  };
}

const translations: Record<Language, Translations> = {
  es: {
    navbar: {
      about: 'Sobre Mi',
      contact: 'Contacto',
      menu: 'Abrir menú de navegación',
      login: 'LukApp — Finanzas',
    },
    hero: {
      role: 'Software Developer',
      description: 'Técnico en sistemas apasionado por la tecnología, programación y ciberseguridad. Desarrollador Full Stack.',
      contactBtn: 'Contáctame',
    },
    about: {
      title: 'SOBRE MI',
      subtitle: 'E X P L O R A &nbsp; A H O R A',
      p1: 'Como desarrollador de software apasionado, combino la lógica de la programación con una base sólida en diseño gráfico, lo que me permite crear interfaces intuitivas y visualmente impactantes. Actualmente enfocado en el desarrollo web, mi experiencia se centra en React, PHP y CSS, donde fusiono la funcionalidad con una visión estética orientada al usuario.',
      p2: 'Con el objetivo de crear soluciones elegantes, navego en el mundo del desarrollo de software con curiosidad constante. Mi camino consiste en transformar conceptos en código, construyendo experiencias de usuario fluidas y desafiando los límites de lo que es posible mediante una ejecución técnica precisa y un enfoque creativo.',
      moreBtn: 'Más Sobre Mi',
    },
    experience: {
      title: 'EXPERIENCIA',
      subtitle: 'E X P L O R E &nbsp; A H O R A',
      role: 'Desarrollador de Software',
      date: '2026 - PRESENTE',
      p1: 'Actualmente, lidero el desarrollo de AutoSuite, una plataforma integral diseñada para la gestión automatizada de talleres automotrices, facilitando el control de inventarios, roles de usuario y órdenes de servicio. Como desarrollador enfocado en soluciones escalables, he construido una base sólida en el desarrollo de aplicaciones web dinámicas y responsivas.',
      p2: 'Mi experiencia con React me ha permitido desarrollar interfaces de usuario intuitivas y funcionales que optimizan el flujo de trabajo en talleres de mecánica y pintura. Además, mi dominio de PHP y CSS me ha dotado de las habilidades para crear sistemas robustos en el lado del servidor y experiencias visuales coherentes. Cuento con una comprensión profunda de la arquitectura basada en componentes, la gestión de datos y las buenas prácticas de desarrollo moderno.',
    },
    projects: {
      title: 'PROYECTOS',
      subtitle: 'E X P L O R E &nbsp; P R O Y E C T O S',
      lukappDesc: 'Plataforma SaaS de finanzas personales asistida por IA, comandos de voz y analítica en tiempo real.',
      autosuiteDesc: 'Plataforma integral diseñada para la gestión automatizada de talleres automotrices, optimizando el control de inventarios, órdenes de servicio y roles de usuario.',
      wbsDesc: 'Proveedor líder de equipos médicos de alta calidad: bombas de infusión, monitores de pacientes, desfibriladores y sistemas de soporte vital en Colombia.',
      monkeymanDesc: 'Experiencia digital interactiva y portafolio para un estudio creativo, con una interfaz web innovadora estilo sistema operativo de escritorio.',
      proximamenteTitle: 'Próximamente',
      proximamenteDesc: 'Nuevos proyectos y soluciones en desarrollo. Próximamente se añadirán más detalles.',
    },
    footer: {
      tagline1: 'Julian Gonzalez | Desarrollador de Software & Frontend Designer.',
      tagline2: 'Transformando ideas en soluciones tecnológicas escalables.',
      copyright: '© 2026. Diseñado y desarrollado por Julian Gonzalez.',
    },
  },
  en: {
    navbar: {
      about: 'About Me',
      contact: 'Contact',
      menu: 'Open navigation menu',
      login: 'LukApp — Finance',
    },
    hero: {
      role: 'Software Developer',
      description: 'Systems technician passionate about technology, programming, and cybersecurity. Full Stack Developer.',
      contactBtn: 'Contact Me',
    },
    about: {
      title: 'ABOUT ME',
      subtitle: 'E X P L O R E &nbsp; N O W',
      p1: 'As a passionate software developer, I blend programming logic with a solid background in graphic design, allowing me to build intuitive and visually compelling user interfaces. Currently focused on web development, my core expertise centers on React, PHP, and CSS, merging functional architecture with an aesthetic user-centered design approach.',
      p2: 'Driven by the desire to build elegant solutions, I navigate the world of software development with relentless curiosity. My journey is about translating ideas into code, creating seamless user experiences, and pushing the boundaries of what is possible through precise technical execution and creative problem-solving.',
      moreBtn: 'More About Me',
    },
    experience: {
      title: 'EXPERIENCE',
      subtitle: 'E X P L O R E &nbsp; N O W',
      role: 'Software Developer',
      date: '2026 - PRESENT',
      p1: 'Currently, I lead the development of AutoSuite, a comprehensive platform designed for the automated management of automotive workshops, facilitating inventory control, user roles, and service orders. As a developer focused on scalable solutions, I have built a solid foundation in developing dynamic and responsive web applications.',
      p2: 'My experience with React has enabled me to develop intuitive and functional user interfaces that optimize the workflow in mechanic and paint workshops. Additionally, my proficiency in PHP and CSS has equipped me with the skills to create robust server-side systems and cohesive visual experiences. I have a deep understanding of component-based architecture, data management, and modern development best practices.',
    },
    projects: {
      title: 'PROJECTS',
      subtitle: 'E X P L O R E &nbsp; P R O J E C T S',
      lukappDesc: 'AI-powered personal finance SaaS platform featuring voice command logging and real-time insights.',
      autosuiteDesc: 'Comprehensive platform designed for the automated management of automotive workshops, optimizing inventory control, service orders, and user roles.',
      wbsDesc: 'Leading provider of high-quality medical equipment: infusion pumps, patient monitors, defibrillators, and life support systems in Colombia.',
      monkeymanDesc: 'Interactive digital experience and portfolio for a creative studio, featuring an innovative desktop OS style web interface.',
      proximamenteTitle: 'Coming Soon',
      proximamenteDesc: 'New projects and solutions in development. More details will be added soon.',
    },
    footer: {
      tagline1: 'Julian Gonzalez | Software Developer & Frontend Designer.',
      tagline2: 'Transforming ideas into scalable technological solutions.',
      copyright: '© 2026. Designed and developed by Julian Gonzalez.',
    },
  },
};

interface LanguageContextType {
  language: Language;
  t: Translations;
  toggleLanguage: () => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = 'portafolio:idioma';

const isLanguage = (value: unknown): value is Language => value === 'es' || value === 'en';

const initialLanguage = (): Language => {
  if (typeof window === 'undefined') return 'es';

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Storage unavailable
  }

  return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'es';
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>(initialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const toggleLanguage = () => {
    setLanguage((prev) => {
      const next = prev === 'es' ? 'en' : 'es';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Storage unavailable
      }
      return next;
    });
  };

  return (
    <LanguageContext.Provider value={{ language, t: translations[language], toggleLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
