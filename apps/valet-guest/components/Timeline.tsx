'use client';

import { useLang } from '@/lib/i18n';

/**
 * Where the car is, as a journey rather than a sentence.
 *
 * The page already says what is happening right now, but a single line of
 * status answers "what now?" and not "how much longer?" — a guest who has
 * asked for their car wants to see that the request landed, that someone is
 * walking to it, and how far that is from the kerb. Four stages, always all
 * four visible, so the remaining distance is legible at a glance.
 *
 * This is also what the WhatsApp link opens onto, which is why the stage
 * mapping below is pinned by a test against the status image's own copy: the
 * picture in the chat thread and the page it links to must never disagree.
 */

const STAGES = ['checkedIn', 'requested', 'onTheWay', 'atTheDoor'] as const;

export const STAGE_COUNT = STAGES.length;

const STAGE_OF: Record<string, number> = {
  parked: 0,
  // A car re-parked after an uncollected arrival is genuinely back at the
  // start — the guest has to ask again.
  parked_again: 0,
  retrieval_requested: 1,
  en_route: 2,
  arrived: 3,
  // Out with a multi-day guest: the last pickup completed the journey.
  with_guest: 3,
};

/**
 * An unrecognised status resolves to the *first* stage, never the last.
 * Being wrong at the start of the journey leaves a guest waiting a moment
 * longer; being wrong at the end sends them out to an empty kerb.
 */
export function stageOf(status: string): number {
  return STAGE_OF[status] ?? 0;
}

/** Statuses where the car is no longer on a journey worth drawing. */
const FINISHED = ['final_closed', 'expired'];

const LABEL: Record<(typeof STAGES)[number], Record<string, string>> = {
  checkedIn: { en: 'Checked in', hi: 'चेक-इन', kn: 'ಚೆಕ್-ಇನ್' },
  requested: { en: 'Requested', hi: 'अनुरोध', kn: 'ವಿನಂತಿ' },
  onTheWay: { en: 'On the way', hi: 'रास्ते में', kn: 'ದಾರಿಯಲ್ಲಿ' },
  atTheDoor: { en: 'At the door', hi: 'दरवाज़े पर', kn: 'ಬಾಗಿಲಲ್ಲಿ' },
};

export default function Timeline({ status }: { status: string }) {
  const [lang] = useLang();

  // Handed over, or long gone. The thank-you message stands on its own.
  if (FINISHED.includes(status)) return null;

  const current = stageOf(status);

  return (
    <ol role="list" className="flex items-start mt-6 mb-7" data-testid="timeline">
      {STAGES.map((key, i) => {
        const done = i <= current;
        const isNow = i === current;
        return (
          <li
            key={key}
            data-testid={`stage-${i}`}
            data-done={String(done)}
            data-current={String(isNow)}
            aria-current={isNow ? 'step' : undefined}
            className="flex-1 flex flex-col items-center relative"
          >
            {/* The connector is drawn by the stage on its right, reaching
                back, so the last stage never trails a line into nothing. */}
            {i > 0 && (
              <span
                aria-hidden
                className={`absolute top-[7px] right-1/2 w-full h-[2px] ${
                  i <= current ? 'bg-teal-400' : 'bg-white/15'
                }`}
              />
            )}
            <span
              {...(done ? { 'data-testid': `stage-${i}-done` } : {})}
              aria-hidden
              className={`relative z-10 rounded-full transition-colors ${
                isNow
                  ? 'w-4 h-4 bg-teal-400 ring-4 ring-teal-400/25'
                  : done
                    ? 'w-2.5 h-2.5 mt-[3px] bg-teal-400'
                    : 'w-2.5 h-2.5 mt-[3px] bg-white/20'
              }`}
            />
            <span
              className={`mt-2.5 text-[11px] leading-tight text-center px-1 ${
                isNow ? 'text-white font-semibold' : 'text-white/45'
              }`}
            >
              {LABEL[key][lang] ?? LABEL[key].en}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
