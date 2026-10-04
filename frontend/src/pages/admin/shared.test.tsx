import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { Department } from '@/lib/ems-api';
import { DepartmentPicker } from './shared';

const dept = (code: string): Department => ({ id: code.toLowerCase(), code, name: code, associationName: null, active: true, sortOrder: 0 });

describe('DepartmentPicker', () => {
  it('rapid clicks accumulate instead of overwriting each other (stale-closure regression)', () => {
    let latest: string[] = [];
    function H() {
      const [v, setV] = useState<string[]>([]);
      latest = v;
      return <DepartmentPicker departments={['CSE', 'IT', 'ECE', 'MECH'].map(dept)} value={v} onChange={(u) => setV(u)} />;
    }
    render(<H />);
    // All four clicks land in ONE batch, before React re-renders (what fast clicking / scripts do).
    const buttons = ['CSE', 'IT', 'ECE', 'MECH'].map((c) => screen.getByRole('button', { name: c }));
    act(() => buttons.forEach((b) => b.click()));
    expect(latest.sort()).toEqual(['cse', 'ece', 'it', 'mech']);
    fireEvent.click(screen.getByRole('button', { name: 'IT' }));
    expect(latest.sort()).toEqual(['cse', 'ece', 'mech']);
  });
});
