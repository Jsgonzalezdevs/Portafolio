import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider, useLanguage } from './LanguageContext';

const Consumer = () => {
  const { language, t, toggleLanguage } = useLanguage();
  return (
    <div>
      <span data-testid="language">{language}</span>
      <span data-testid="role">{t.hero.role}</span>
      <button onClick={toggleLanguage}>toggle</button>
    </div>
  );
};

/**
 * jsdom hardcodes `navigator.language` to 'en-US', which is not a neutral
 * starting point for a site that defaults to Spanish — every test has to state
 * the browser language it is actually exercising.
 */
const setBrowserLanguage = (value: string) => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(value);
};

const renderApp = () =>
  render(
    <LanguageProvider>
      <Consumer />
    </LanguageProvider>
  );

describe('LanguageContext', () => {
  beforeEach(() => {
    localStorage.clear();
    setBrowserLanguage('es-CO');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to Spanish', () => {
    renderApp();

    expect(screen.getByTestId('language')).toHaveTextContent('es');
  });

  it('switches translations when toggled', () => {
    renderApp();

    fireEvent.click(screen.getByText('toggle'));

    expect(screen.getByTestId('language')).toHaveTextContent('en');
    expect(screen.getByTestId('role')).toHaveTextContent('Software Developer');
  });

  it('starts in English when the browser is English', () => {
    setBrowserLanguage('en-US');

    renderApp();

    expect(screen.getByTestId('language')).toHaveTextContent('en');
  });

  it('falls back to Spanish for a language it does not translate', () => {
    setBrowserLanguage('de-DE');

    renderApp();

    expect(screen.getByTestId('language')).toHaveTextContent('es');
  });

  it('remembers a deliberate switch across reloads', () => {
    const first = renderApp();
    fireEvent.click(screen.getByText('toggle'));
    first.unmount();

    renderApp();

    expect(screen.getByTestId('language')).toHaveTextContent('en');
  });

  it('lets a stored preference override the browser language', () => {
    setBrowserLanguage('en-US');
    localStorage.setItem('portafolio:idioma', 'es');

    renderApp();

    expect(screen.getByTestId('language')).toHaveTextContent('es');
  });

  it('ignores a corrupted stored value', () => {
    localStorage.setItem('portafolio:idioma', 'klingon');

    renderApp();

    expect(screen.getByTestId('language')).toHaveTextContent('es');
  });

  it('keeps the document lang attribute in sync', () => {
    renderApp();
    expect(document.documentElement.lang).toBe('es');

    fireEvent.click(screen.getByText('toggle'));

    expect(document.documentElement.lang).toBe('en');
  });

  it('survives localStorage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: private mode');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError: private mode');
    });

    renderApp();
    fireEvent.click(screen.getByText('toggle'));

    expect(screen.getByTestId('language')).toHaveTextContent('en');
  });
});
