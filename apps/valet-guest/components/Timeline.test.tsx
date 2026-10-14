import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Timeline, { stageOf, STAGE_COUNT } from './Timeline';

describe('which stage a status sits at', () => {
  it('treats a re-parked car as parked, not as a new journey', () => {
    // A guest whose car was re-parked after an uncollected arrival is back at
    // the beginning. Showing them "at the door" would send them outside.
    expect(stageOf('parked_again')).toBe(stageOf('parked'));
  });

  it('orders the journey the way it actually happens', () => {
    expect(stageOf('parked')).toBeLessThan(stageOf('retrieval_requested'));
    expect(stageOf('retrieval_requested')).toBeLessThan(stageOf('en_route'));
    expect(stageOf('en_route')).toBeLessThan(stageOf('arrived'));
    expect(stageOf('arrived')).toBe(STAGE_COUNT - 1);
  });

  it('puts a status it has never seen at the start rather than at the end', () => {
    // An unknown status must never render as "your car is at the door".
    expect(stageOf('something_new')).toBe(0);
  });

  it('agrees with the WhatsApp status image', () => {
    // The image sent to WhatsApp and the page its link opens are the same
    // four stages. If these drift, a guest sees one thing in the chat and
    // another when they tap it.
    const fromImageRoute: Record<string, number> = {
      parked: 0, parked_again: 0, retrieval_requested: 1, en_route: 2, arrived: 3,
    };
    for (const [status, stage] of Object.entries(fromImageRoute)) {
      expect(stageOf(status)).toBe(stage);
    }
  });
});

describe('what the guest sees', () => {
  it('marks the current stage and everything before it as reached', () => {
    render(<Timeline status="en_route" />);

    const done = screen.getAllByTestId(/^stage-\d-done$/);
    // Checked in, Requested, On the way -- but not At the door.
    expect(done).toHaveLength(3);
    expect(screen.getByTestId('stage-3')).toHaveAttribute('data-done', 'false');
  });

  it('names the stage the car is at now', () => {
    render(<Timeline status="retrieval_requested" />);
    expect(screen.getByTestId('stage-1')).toHaveAttribute('data-current', 'true');
    expect(screen.getByTestId('stage-0')).toHaveAttribute('data-current', 'false');
  });

  it('renders every stage even at the start, so the guest knows what is coming', () => {
    render(<Timeline status="parked" />);
    expect(screen.getAllByTestId(/^stage-\d$/)).toHaveLength(STAGE_COUNT);
  });

  it('describes the journey to a screen reader as a list with a current step', () => {
    render(<Timeline status="en_route" />);
    expect(screen.getByRole('list')).toBeTruthy();
    expect(screen.getByTestId('stage-2')).toHaveAttribute('aria-current', 'step');
  });

  it('shows nothing once the car has gone', () => {
    // A closed ticket's timeline is noise above a thank-you message.
    const { container } = render(<Timeline status="final_closed" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('language', () => {
  it('renders the stage names in the chosen language', async () => {
    // tsc caught what these tests did not: useLang returns a tuple, and
    // destructuring it as an object left `lang` undefined, so every guest saw
    // English however they had set the page.
    localStorage.setItem('dwaar_valet_guest_lang', 'hi');
    render(<Timeline status="parked" />);
    expect(await screen.findByText('चेक-इन')).toBeTruthy();
    localStorage.clear();
  });
});
