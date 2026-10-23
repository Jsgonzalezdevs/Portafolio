import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { Birthday, BIRTHDAY_AT, birthdayCountdown } from './Birthday';

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => { cleanup(); vi.useRealTimers(); window.history.replaceState({}, '', '/'); vi.restoreAllMocks(); });
describe('birthday surprise', () => {
  it('allows an explicit preview before midnight without changing the normal countdown', () => {
    vi.useFakeTimers(); vi.setSystemTime(BIRTHDAY_AT - 3600000);
    window.history.replaceState({}, '', '/cumpleanos-mi-princesa?preview=1');
    render(<Birthday />);
    expect(screen.getByText('Abrir mi cartita')).toBeInTheDocument();
    expect(screen.getAllByRole('button').filter(button => button.classList.contains('bday-polaroid'))).toHaveLength(12);
    expect(birthdayCountdown(Date.now()).unlocked).toBe(false);
  });
  it('unlocks exactly at midnight in Colombia and stays unlocked', () => {
    expect(new Date(BIRTHDAY_AT).toISOString()).toBe('2026-10-23T05:00:00.000Z');
    expect(birthdayCountdown(BIRTHDAY_AT - 1000)).toEqual({ unlocked: false, units: [0, 0, 0, 1] });
    expect(birthdayCountdown(BIRTHDAY_AT)).toEqual({ unlocked: true, units: [0, 0, 0, 0] });
    expect(birthdayCountdown(BIRTHDAY_AT + 86400000).unlocked).toBe(true);
  });
  it('keeps the surprise closed before midnight and reveals it without reloading', () => {
    vi.useFakeTimers(); vi.setSystemTime(BIRTHDAY_AT - 1000);
    render(<Birthday />);
    expect(screen.queryByText('Abrir mi sorpresa')).not.toBeInTheDocument();
    expect(document.querySelectorAll('audio')).toHaveLength(0);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(screen.queryByText('Abrir mi cartita')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.click(screen.getByText('Abrir mi sorpresa'));
    expect(screen.getByText('Abrir mi cartita')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Abrir mi cartita'));
    expect(screen.getByText('Mi Kamila, mi princesa:')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ya pedí mi deseo · soplar las velitas'));
    expect(screen.getByText('Que eso que acabas de pedir encuentre el camino hasta ti. ♡')).toBeInTheDocument();
  });
});
