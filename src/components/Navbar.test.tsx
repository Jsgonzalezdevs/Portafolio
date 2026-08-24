import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { LanguageProvider } from '../context/LanguageContext';
import { Navbar } from './Navbar';

const renderNavbar = () =>
  render(
    <LanguageProvider>
      <Navbar />
    </LanguageProvider>
  );

const menuButton = () => screen.getByRole('button', { name: /men[uú]/i });

/** The panel is the only place the nav links appear twice; scope to it. */
const panel = () => document.getElementById(menuButton().getAttribute('aria-controls') ?? '');

describe('Navbar', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-CO');
    // jsdom has no layout, so getElementById targets exist but scrolling is a
    // no-op — stub it to assert intent rather than pixels.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with the mobile menu closed', () => {
    renderNavbar();

    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).toBeNull();
  });

  it('opens the menu and exposes the nav links', () => {
    renderNavbar();

    fireEvent.click(menuButton());

    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');
    const opened = panel();
    expect(opened).not.toBeNull();
    expect(within(opened!).getByText('Sobre Mi')).toBeInTheDocument();
    expect(within(opened!).getByText('Contacto')).toBeInTheDocument();
  });

  it('closes the menu after choosing a destination', () => {
    renderNavbar();
    fireEvent.click(menuButton());

    fireEvent.click(within(panel()!).getByText('Sobre Mi'));

    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('scrolls to the section a menu link points at', () => {
    const section = document.createElement('section');
    section.id = 'sobre-mi';
    document.body.appendChild(section);

    renderNavbar();
    fireEvent.click(menuButton());
    fireEvent.click(within(panel()!).getByText('Sobre Mi'));

    expect(window.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' })
    );

    section.remove();
  });

  it('closes the menu on Escape', () => {
    renderNavbar();
    fireEvent.click(menuButton());

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the menu when the viewport grows to desktop', () => {
    const listeners = new Set<() => void>();
    // One shared instance: the component reads `matches` off the very object it
    // subscribed to, so a fresh object per call would leave the flip invisible.
    const mql = {
      matches: false,
      media: '(min-width: 48rem)',
      onchange: null,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    vi.spyOn(window, 'matchMedia').mockReturnValue(mql);

    renderNavbar();
    fireEvent.click(menuButton());
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');

    act(() => {
      (mql as { matches: boolean }).matches = true;
      listeners.forEach((fn) => fn());
    });

    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles the language from the always-visible switch', () => {
    renderNavbar();

    expect(screen.getByText('Contacto')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /switch to english/i }));

    expect(screen.getByText('Contact')).toBeInTheDocument();
  });
});
