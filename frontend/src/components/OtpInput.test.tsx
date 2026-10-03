import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OtpInput } from './OtpInput';

function Harness({ onComplete = () => {} }: { onComplete?: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <OtpInput
      value={v}
      onChange={(next) => {
        setV(next);
        if (next.length === 6) onComplete(next);
      }}
    />
  );
}

const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[];

describe('OtpInput', () => {
  it('renders 6 numeric boxes with one-time-code autofill on the first', () => {
    render(<Harness />);
    expect(boxes()).toHaveLength(6);
    expect(boxes()[0].getAttribute('autocomplete')).toBe('one-time-code');
    expect(boxes().every((b) => b.inputMode === 'numeric')).toBe(true);
  });

  it('typing fills boxes left to right and completes the code', async () => {
    const done = vi.fn();
    render(<Harness onComplete={done} />);
    await userEvent.click(boxes()[0]);
    await userEvent.keyboard('482913');
    expect(boxes().map((b) => b.value).join('')).toBe('482913');
    expect(done).toHaveBeenCalledWith('482913');
  });

  it('ignores letters', async () => {
    render(<Harness />);
    await userEvent.click(boxes()[0]);
    await userEvent.keyboard('a1b2');
    expect(boxes().map((b) => b.value).join('')).toBe('12');
  });

  it('pasting a whole code (even with spaces) fills every box', () => {
    const done = vi.fn();
    render(<Harness onComplete={done} />);
    fireEvent.paste(boxes()[0], { clipboardData: { getData: () => ' 12 34 56 ' } });
    expect(boxes().map((b) => b.value).join('')).toBe('123456');
    expect(done).toHaveBeenCalledWith('123456');
  });

  it('backspace on an empty box clears the previous digit', async () => {
    render(<Harness />);
    await userEvent.click(boxes()[0]);
    await userEvent.keyboard('12');
    await userEvent.keyboard('{Backspace}');
    expect(boxes().map((b) => b.value).join('')).toBe('1');
  });
});
