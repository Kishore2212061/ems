import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Signup from './Signup';

const renderAt = () => {
  const loc = memoryLocation({ path: '/signup', record: true });
  render(
    <Router hook={loc.hook}>
      <Signup />
    </Router>,
  );
  return loc;
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('Signup page', () => {
  it('blocks submit with field errors and makes no API call', async () => {
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText('Enter your full name')).toBeTruthy();
    expect(screen.getByText('Enter your email')).toBeTruthy();
    expect(screen.getByText('Enter your mobile number')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the mobile field cannot hold more than 10 digits', async () => {
    renderAt();
    const phone = screen.getByLabelText(/mobile number/i) as HTMLInputElement;
    await userEvent.type(phone, '98765432109999');
    expect(phone.value).toBe('9876543210');
  });

  it('valid form → API call → OTP screen', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ otpRequired: true, otpToken: 't', email: 'asha@nec.edu', resendAfterSec: 60 }), { status: 201 }),
    );
    const loc = renderAt();
    await userEvent.type(screen.getByLabelText(/full name/i), 'Asha Kumar');
    await userEvent.type(screen.getByLabelText(/email address/i), 'asha@nec.edu');
    await userEvent.type(screen.getByLabelText(/mobile number/i), '9876543210');
    await userEvent.type(screen.getByLabelText(/college/i), 'NEC');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'Passw0rd123');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await vi.waitFor(() => expect(loc.history.at(-1)).toBe('/verify-otp'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/auth/signup');
    expect(JSON.parse(init.body)).toEqual({
      fullName: 'Asha Kumar',
      email: 'asha@nec.edu',
      phone: '9876543210',
      college: 'NEC',
      password: 'Passw0rd123',
    });
  });
});
