'use client';

import { Fragment, useId, type KeyboardEvent, type ReactNode } from 'react';
import { Gamepad2, Image as ImageIcon, Map as MapIcon, ScanFace, SlidersHorizontal } from 'lucide-react';
import {
  CHANGED_LINE,
  CREATE_CARDS,
  CREATE_FRAMINGS,
  CREATE_VIEWS,
  FAST_THREE_QUARTER_LINE,
  FINE_TUNE_LINK,
  GREYED_CARDS_LINE,
  RAW_ROWS_LINE,
  UNDER_CARDS_LINE,
  WAIST_LINE,
  cardChoice,
  changedInFineTune,
  effectiveRows,
  fastThreeQuarter,
  pickFraming,
  pickView,
  waistAllowed,
  type CreateCardId,
  type CreateChoice,
} from '@/lib/createCards';
import type { GenerationStyle } from '@/lib/styleRegistry';
import type { BadgeState } from '@/lib/generateTabs';
import StepBadge, { StepWord } from './StepBadge';

/**
 * Create Sprite's step 2, "What's it for?", with its fine-tune rows (G2;
 * DESIGN, generate-pass.md 2.2 and 2.3). Four cards in a 2 by 2 grid at every
 * width, each a radio; two rows of chips under "Fine-tune view and framing",
 * each a radio group. Arrow keys move and choose; a greyed choice takes the
 * focus but is never chosen. The words the choices add are not here: the
 * "Adds" line shows them, from the private service (createCards.ts).
 */

const CARD_ICONS: Record<CreateCardId, ReactNode> = {
  platformer: <Gamepad2 size={18} aria-hidden="true" />,
  topdown: <MapIcon size={18} aria-hidden="true" />,
  portrait: <ScanFace size={18} aria-hidden="true" />,
  raw: <ImageIcon size={18} aria-hidden="true" />,
};

interface WhatsItForProps {
  choice: CreateChoice;
  onChoose: (next: CreateChoice) => void;
  style: GenerationStyle;
  /** The cards apply to this style (createCards.ts cardsApply). */
  applies: boolean;
  /** The cards and rows are greyed: a style they do not apply to
   *  (createCards.ts cardsGreyed). */
  greyed: boolean;
  badge: BadgeState;
  fineTuneOpen: boolean;
  onToggleFineTune: () => void;
}

export default function WhatsItFor({ choice, onChoose, style, applies, greyed, badge, fineTuneOpen, onToggleFineTune }: WhatsItForProps) {
  const labelId = useId();
  const rowsId = useId();
  const viewLabelId = useId();
  const framingLabelId = useId();
  const waistLineId = useId();
  const rows = effectiveRows(choice, style.id);
  const changed = changedInFineTune(choice, style.id);
  const rowsGreyed = greyed || choice.card === 'raw';
  const waistOff = !waistAllowed(style.id);

  return (
    <div>
      <p id={labelId} className="flex items-center gap-2 text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
        <StepBadge n={2} state={badge} />
        <span>
          <StepWord n={2} />
          What&apos;s it for?
        </span>
      </p>

      <RadioGroup
        labelledBy={labelId}
        className="grid grid-cols-2 gap-2"
        value={choice.card}
        options={CREATE_CARDS.map((c) => ({ id: c.id, disabled: greyed }))}
        onPick={(id) => onChoose(cardChoice(id as CreateCardId))}
        render={(opt, props) => {
          const card = CREATE_CARDS.find((c) => c.id === opt.id)!;
          const checked = choice.card === card.id;
          const on = checked && !greyed;
          return (
            <button
              {...props}
              data-create-card={card.id}
              className={`flex flex-col items-start gap-1.5 p-3 rounded-[10px] border text-left min-h-11 font-mono transition-colors
                focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-amber
                ${on ? 'border-accent-amber bg-accent-amber-glow' : 'border-border-default bg-bg-elevated'}
                ${greyed ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-bg-hover'}`}
            >
              <span className={on ? 'text-accent-amber' : 'text-text-secondary'}>{CARD_ICONS[card.id]}</span>
              <span className={`text-[13px] font-semibold leading-snug ${on ? 'text-accent-amber' : greyed ? 'text-text-secondary' : 'text-text-primary'}`}>
                {card.name}
              </span>
              {/* Both lines take the same cell, so the card keeps the taller
                  one's height when a row changes (AUDIT g2-page-r1 M1); a
                  greyed card never reads as changed (L13). */}
              <span className="grid text-xs leading-normal text-text-secondary">
                <span className={`[grid-area:1/1] ${checked && changed && !greyed ? '' : 'invisible'}`}>{CHANGED_LINE}</span>
                <span className={`[grid-area:1/1] ${checked && changed && !greyed ? 'invisible' : ''}`}>{card.line}</span>
              </span>
            </button>
          );
        }}
      />
      {!applies && <p className="text-xs font-mono text-text-secondary mt-2.5 leading-normal">{GREYED_CARDS_LINE}</p>}

      <div className="mt-3">
        <button
          type="button"
          aria-expanded={fineTuneOpen}
          aria-controls={fineTuneOpen ? rowsId : undefined}
          onClick={onToggleFineTune}
          className="inline-flex items-center gap-1.5 min-h-7 pointer-coarse:min-h-11 text-[13px] font-mono text-accent-amber underline underline-offset-[3px] cursor-pointer
            hover:text-accent-amber-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-amber rounded"
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          {FINE_TUNE_LINK}
        </button>
        {fineTuneOpen && (
          <div id={rowsId}>
            <div className="grid grid-cols-1 sm:grid-cols-[88px_1fr] gap-x-2.5 gap-y-1.5 items-center mt-3">
              <span id={viewLabelId} className="text-xs font-mono text-text-secondary">View</span>
              <RadioGroup
                labelledBy={viewLabelId}
                className="flex flex-wrap gap-2"
                value={rows?.view ?? null}
                options={CREATE_VIEWS.map((v) => ({ id: v.id, disabled: rowsGreyed }))}
                onPick={(id) => onChoose(pickView(choice, id as (typeof CREATE_VIEWS)[number]['id']))}
                render={(opt, props) => (
                  <Chip props={props} checked={!rowsGreyed && rows?.view === opt.id} greyed={rowsGreyed} data={`view-${opt.id}`}>
                    {CREATE_VIEWS.find((v) => v.id === opt.id)!.label}
                  </Chip>
                )}
              />
              <span id={framingLabelId} className="text-xs font-mono text-text-secondary">Framing</span>
              <RadioGroup
                labelledBy={framingLabelId}
                className="flex flex-wrap gap-2"
                value={rows?.framing ?? null}
                options={CREATE_FRAMINGS.map((f) => ({ id: f.id, disabled: rowsGreyed || (f.id === 'waist' && waistOff) }))}
                onPick={(id) => onChoose(pickFraming(choice, id as (typeof CREATE_FRAMINGS)[number]['id'], style.id))}
                render={(opt, props) => (
                  <Chip
                    props={{ ...props, 'aria-describedby': opt.id === 'waist' && waistOff && !rowsGreyed ? waistLineId : undefined }}
                    checked={!rowsGreyed && rows?.framing === opt.id}
                    greyed={opt.disabled}
                    data={`framing-${opt.id}`}
                  >
                    {CREATE_FRAMINGS.find((f) => f.id === opt.id)!.label}
                  </Chip>
                )}
              />
            </div>
            {choice.card === 'raw' && applies && !greyed && (
              <p className="text-xs font-mono text-text-secondary mt-2 leading-normal">{RAW_ROWS_LINE}</p>
            )}
            {waistOff && !rowsGreyed && (
              <p id={waistLineId} className="text-xs font-mono text-text-secondary mt-2 leading-normal">{WAIST_LINE}</p>
            )}
          </div>
        )}
        {/* Shown with the rows open or closed: the card's own view can be
            three-quarter (AUDIT g2-page-r1 L13). */}
        {fastThreeQuarter(style, choice) && !greyed && (
          <p className="text-xs font-mono text-accent-teal mt-2 leading-normal">{FAST_THREE_QUARTER_LINE}</p>
        )}
      </div>
      <p className="text-xs font-mono text-text-secondary mt-2.5 leading-normal">{UNDER_CARDS_LINE}</p>
    </div>
  );
}

function Chip({ props, checked, greyed, data, children }: {
  props: Record<string, unknown>;
  checked: boolean;
  greyed: boolean;
  data: string;
  children: ReactNode;
}) {
  return (
    <button
      {...props}
      data-create-chip={data}
      className={`inline-flex items-center h-8 pointer-coarse:h-11 pointer-coarse:min-w-11 px-3 rounded-2xl border text-xs font-mono whitespace-nowrap transition-colors
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-amber
        ${checked ? 'border-accent-amber text-accent-amber bg-accent-amber-glow' : greyed ? 'border-border-default text-text-secondary bg-transparent' : 'border-border-default text-text-primary bg-bg-elevated hover:bg-bg-hover'}
        ${greyed ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {children}
    </button>
  );
}

interface Option {
  id: string;
  disabled: boolean;
}

/**
 * A radio group of buttons: the checked one (or the first, when none is)
 * takes the Tab stop; arrow keys, Home and End move the focus and choose,
 * except a greyed option, which takes the focus only.
 */
function RadioGroup({ labelledBy, className, value, options, onPick, render }: {
  labelledBy: string;
  className: string;
  value: string | null;
  options: Option[];
  onPick: (id: string) => void;
  render: (opt: Option, props: Record<string, unknown>) => ReactNode;
}) {
  const stop = Math.max(0, options.findIndex((o) => o.id === value));
  const allGreyed = options.every((o) => o.disabled);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const k = e.key;
    let n: number;
    if (k === 'ArrowRight' || k === 'ArrowDown') n = i + 1;
    else if (k === 'ArrowLeft' || k === 'ArrowUp') n = i - 1;
    else if (k === 'Home') n = 0;
    else if (k === 'End') n = options.length - 1;
    else return;
    e.preventDefault();
    n = (n + options.length) % options.length;
    const radios = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(':scope > [role="radio"]');
    radios?.[n]?.focus();
    if (!options[n].disabled) onPick(options[n].id);
  };
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} aria-disabled={allGreyed || undefined} className={className}>
      {options.map((opt, i) => (
        <Fragment key={opt.id}>
          {render(opt, {
          type: 'button',
          role: 'radio',
          'aria-checked': opt.id === value && !opt.disabled,
          'aria-disabled': opt.disabled || undefined,
          tabIndex: i === stop ? 0 : -1,
          onClick: () => {
            if (!opt.disabled) onPick(opt.id);
          },
          onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => onKeyDown(e, i),
          })}
        </Fragment>
      ))}
    </div>
  );
}
