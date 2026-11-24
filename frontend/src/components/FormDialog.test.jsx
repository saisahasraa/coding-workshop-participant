import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FormDialog from './FormDialog';
import { ApiError } from '../api/client';
import { renderWithProviders } from '../test/render';

const FIELDS = [
  { name: 'name', label: 'Name', required: true },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'hours', label: 'Hours', type: 'number', min: 0, max: 10 },
  { name: 'kind', label: 'Kind', type: 'select', required: true, options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }], defaultValue: 'a' },
  { name: 'owner_id', label: 'Owner', type: 'select', numeric: true, options: [{ value: 3, label: 'Sam' }] },
  { name: 'active', label: 'Active', type: 'switch' },
  { name: 'secret', label: 'Secret', type: 'password', minLength: 8 },
];

const open = (props) => renderWithProviders(
  <FormDialog open title="Thing" fields={FIELDS} onClose={props.onClose || vi.fn()} onSubmit={props.onSubmit} {...props} />,
);

describe('FormDialog', () => {
  it('validates required, email, range and length before submitting', async () => {
    const onSubmit = vi.fn();
    open({ onSubmit });
    await userEvent.type(screen.getByLabelText(/email/i), 'nope');
    await userEvent.type(screen.getByLabelText(/hours/i), '11');
    await userEvent.type(screen.getByLabelText(/secret/i), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Must be at most 10')).toBeInTheDocument();
    expect(screen.getByText('Must be at least 8 characters')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits typed values on create and closes', async () => {
    const onSubmit = vi.fn().mockResolvedValue();
    const onClose = vi.fn();
    open({ onSubmit, onClose });
    await userEvent.type(screen.getByLabelText(/name/i), 'Widget');
    await userEvent.type(screen.getByLabelText(/hours/i), '4.5');
    await userEvent.click(screen.getByLabelText(/owner/i));
    await userEvent.click(screen.getByRole('option', { name: 'Sam' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Active' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Widget', email: null, hours: 4.5, kind: 'a', owner_id: 3, active: true });
    expect(onClose).toHaveBeenCalled();
  });

  it('sends only changed, editable fields on edit', async () => {
    const onSubmit = vi.fn().mockResolvedValue();
    open({ onSubmit, initialValues: { id: 1, name: 'Old', hours: 2, kind: 'b' }, editableFields: ['hours', 'kind'] });
    expect(screen.getByLabelText(/name/i)).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/hours/i));
    await userEvent.type(screen.getByLabelText(/hours/i), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith({ hours: 3 });
  });

  it('closes without a request when nothing changed', async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    open({ onSubmit, onClose, initialValues: { id: 1, name: 'Same', kind: 'a' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows server validation errors next to fields and other errors on top', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new ApiError({
      status: 400, code: 'validation_error', message: 'Request validation failed', details: { name: 'already taken', project_id: 'missing' },
    })).mockRejectedValueOnce(new Error('Network down'));
    open({ onSubmit });
    await userEvent.type(screen.getByLabelText(/name/i), 'Dup');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('already taken')).toBeInTheDocument();
    expect(screen.getByText(/project_id missing/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Network down')).toBeInTheDocument();
  });
});

describe('FormDialog date bounds', () => {
  it('rejects dates outside min/max before submitting', async () => {
    const onSubmit = vi.fn().mockResolvedValue();
    renderWithProviders(
      <FormDialog open title="D" onClose={vi.fn()} onSubmit={onSubmit}
        fields={[{ name: 'due', label: 'Due', type: 'date', min: '2026-01-01', max: '2026-06-30' }]} />,
    );
    const input = screen.getByLabelText(/due/i);
    await userEvent.type(input, '2026-07-15');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Must be on or before 2026-06-30')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, '2025-12-31');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Must be on or after 2026-01-01')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, '2026-06-30');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith({ due: '2026-06-30' });
  });
});
