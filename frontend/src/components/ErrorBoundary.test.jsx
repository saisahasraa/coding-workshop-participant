import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from './ErrorBoundary';

let shouldThrow = true;
function Flaky() {
  if (shouldThrow) throw new Error('boom');
  return <p>Recovered</p>;
}

describe('ErrorBoundary', () => {
  it('shows a fallback and recovers on "Try again"', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Flaky /></ErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    shouldThrow = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Recovered')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
