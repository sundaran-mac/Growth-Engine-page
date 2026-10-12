import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BestWindowPanel } from './BestWindowPanel';
import { makeSummary } from './fixtures';

describe('BestWindowPanel', () => {
  it('shows the starting rule in weeks 1 to 4', () => {
    render(<BestWindowPanel summary={makeSummary(true)} />);
    expect(screen.getByText('Starting rule')).toBeInTheDocument();
    expect(screen.getByText(/reels 6 to 9 am or 7 to 10 pm/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Best window per channel' })).toBeNull();
  });

  it('shows the learned window per channel from week 5', () => {
    const summary = makeSummary(true);
    summary.bestWindow = {
      rule: 'learned',
      text: 'Learned from your own posts, Asia/Kolkata time: Instagram 19:00 to 21:00 (90 value per 1k reach).',
      windows: [
        { platform: 'instagram', audienceTz: 'Asia/Kolkata', rule: 'learned', startHour: 19, endHour: 21, valuePer1kReach: 90, posts: 8 },
        { platform: 'linkedin', audienceTz: 'Asia/Kolkata', rule: 'starting', startHour: null, endHour: null, valuePer1kReach: null, posts: 0 },
      ],
    };
    render(<BestWindowPanel summary={summary} />);
    expect(screen.getByText('Learned')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Best window per channel' });
    const [ig, li] = within(list).getAllByRole('listitem');
    expect(ig).toHaveTextContent('Instagram19:00 to 21:0090 per 1k reach · 8 postslearned');
    expect(li).toHaveTextContent('LinkedInstarting');
  });
});
