import React, { useEffect } from 'react';
import { LanguageProvider } from './context/LanguageContext';
import { registrarVisita } from './lib/visita';
import { activarProteccionCodigo } from './lib/proteccionCodigo';
import { WavesBackground } from './components/WavesBackground';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { AboutMe } from './components/AboutMe';
import { Experience } from './components/Experience';
import { Projects } from './components/Projects';
import { Footer } from './components/Footer';
import { EllaYYo } from './components/EllaYYo';

const Portfolio: React.FC = () => {
  // Una sola vez por carga. El portafolio es una página con secciones ancladas,
  // no rutas, así que no hay navegación que volver a contar.
  useEffect(() => {
    registrarVisita();
    activarProteccionCodigo();
  }, []);

  return (
    <LanguageProvider>
      <div className="relative min-h-screen bg-transparent text-white selection:bg-white/25 selection:text-white">
        {/* 3D Undulating Waves Background */}
        <WavesBackground />

        {/* Sticky Navbar */}
        <Navbar />

        {/* Main Content Layout */}
        <main className="relative z-10 mx-auto max-w-5xl">
          <Hero />
          <AboutMe />
          <Experience />
          <Projects />
        </main>

        {/* Footer / Contact Section */}
        <Footer />
      </div>
    </LanguageProvider>
  );
};

const App: React.FC = () => {
  const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  return path === '/ellayyo' ? <EllaYYo /> : <Portfolio />;
};

export default App;
