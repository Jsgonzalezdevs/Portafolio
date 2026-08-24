import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../context/LanguageContext';
import { Footer } from './Footer';

const renderFooter = () =>
  render(
    <LanguageProvider>
      <Footer />
    </LanguageProvider>
  );

describe('Footer', () => {
  it('renders a mailto link to the developer email', () => {
    renderFooter();

    const emailLink = screen.getByLabelText('Email');
    expect(emailLink).toHaveAttribute('href', 'mailto:Jsgonzalezdevs@gmail.com');
  });

  it('renders social links pointing outside the site with safe rel attributes', () => {
    renderFooter();

    const githubLink = screen.getByLabelText('GitHub');
    expect(githubLink).toHaveAttribute('target', '_blank');
    expect(githubLink).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
