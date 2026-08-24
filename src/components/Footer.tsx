import React from 'react';
import { motion } from 'framer-motion';
import { Mail } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

// Custom GitHub Logo SVG component
const GithubIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={props.className}
    {...props}
  >
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
  </svg>
);

// Custom Instagram Logo SVG component
const InstagramIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={props.className}
    {...props}
  >
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

// Custom LinkedIn Logo SVG component
const LinkedinIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={props.className}
    {...props}
  >
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

// Custom Facebook Logo SVG component (matching stroke style)
const FacebookIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={props.className}
    {...props}
  >
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);

// Custom WhatsApp Logo SVG component
const WhatsappIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className={props.className}
    {...props}
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.704 1.459h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
  </svg>
);

export const Footer: React.FC = () => {
  const { t } = useLanguage();

  const socialLinks = [
    {
      name: 'Email',
      url: 'mailto:Jsgonzalezdevs@gmail.com',
      icon: <Mail className="h-5 w-5" strokeWidth={2} />
    },
    {
      name: 'GitHub',
      url: 'https://github.com/S4NS1605', 
      icon: <GithubIcon className="h-5 w-5" /> 
    },
    { 
      name: 'Instagram', 
      url: 'https://www.instagram.com/juliangon16/', 
      icon: <InstagramIcon className="h-5 w-5" /> 
    },
    { 
      name: 'LinkedIn', 
      url: 'https://www.linkedin.com/in/julian-gonzalez-299a81410/', 
      icon: <LinkedinIcon className="h-5 w-5" /> 
    },
    { 
      name: 'WhatsApp', 
      url: 'https://wa.me/573187865403', 
      icon: <WhatsappIcon className="h-5 w-5" /> 
    },
    { 
      name: 'Facebook', 
      url: 'https://www.facebook.com/profile.php?id=100065471632139', 
      icon: <FacebookIcon className="h-5 w-5" /> 
    },
  ];

  return (
    <footer 
      id="contacto" 
      className="border-t border-white/[0.06] bg-black px-6 py-16 text-center md:px-12"
    >
      <div className="mx-auto flex max-w-5xl flex-col items-center">
        
        {/* Social Icons Row */}
        <div className="mb-10 flex gap-4">
          {socialLinks.map((link) => {
            const isEmail = link.url.startsWith('mailto:');
            return (
              <motion.a
                key={link.name}
                href={link.url}
                target={isEmail ? undefined : '_blank'}
                rel={isEmail ? undefined : 'noopener noreferrer'}
                whileHover={{ scale: 1.15, y: -2 }}
                className="p-2 text-neutral-400 transition-colors hover:text-white"
                aria-label={link.name}
              >
                {link.icon}
              </motion.a>
            );
          })}
        </div>

        {/* Text and Copyright */}
        <div className="space-y-2 text-center text-xs tracking-wider text-neutral-500 md:text-sm">
          <p className="font-semibold text-neutral-400">
            {t.footer.tagline1}
          </p>
          <p className="font-light">
            {t.footer.tagline2}
          </p>
          <p className="mt-6 text-[10px] text-neutral-600 uppercase">
            {t.footer.copyright}
          </p>
        </div>


        
      </div>
    </footer>
  );
};
