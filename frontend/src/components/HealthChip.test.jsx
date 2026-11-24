import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HealthChip from './HealthChip';
import { renderWithProviders } from '../test/render';

describe('HealthChip', () => {
  it.each([['green', 'On track'], ['amber', 'At risk'], ['red', 'Off track']])('shows %s as %s', (level, label) => {
    renderWithProviders(<HealthChip level={level} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('renders nothing for projects without health', () => {
    const { container } = renderWithProviders(<HealthChip level={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains the reasons on hover', async () => {
    renderWithProviders(<HealthChip level="red" reasons={[{ message: 'Past its target end date by 3 days' }, { message: '2 deliverables blocked' }]} />);
    await userEvent.hover(screen.getByText('Off track'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Past its target end date by 3 days. 2 deliverables blocked');
  });
});
