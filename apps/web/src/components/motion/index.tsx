/**
 * Shared motion for Growth Desk (library: `motion`, the successor of framer-motion).
 * One small set of timings keeps every screen consistent. All motion respects the
 * operating system "reduce motion" setting through MotionProvider (reducedMotion="user").
 *
 * Use:
 *   <FadeIn>...</FadeIn>                       one block that eases in
 *   <Stagger as="ul"> <StaggerItem as="li"> ... cards or rows that ease in one after another
 *   <MotionCard>                                a card that lifts a little on hover
 *   useCountUp(ref, "35.7k")                    a number counts up once on first mount
 */
import * as React from 'react';
import {
  MotionConfig,
  animate,
  motion,
  useReducedMotion,
  type HTMLMotionProps,
  type Transition,
  type Variants,
} from 'motion/react';
import { cn } from '@/lib/utils';

/** Standard easing (ease-out quint) and durations. Fast enough to never slow work down. */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const DURATION = { fast: 0.15, base: 0.22, slow: 0.32 } as const;
export const transition: Transition = { duration: DURATION.base, ease: EASE };

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={transition}>
      {children}
    </MotionConfig>
  );
}

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition },
};

export function FadeIn({
  className,
  delay = 0,
  ...rest
}: HTMLMotionProps<'div'> & { delay?: number }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={fadeUp}
      transition={{ ...transition, delay }}
      {...rest}
    />
  );
}

type StaggerTag = 'div' | 'ul' | 'ol' | 'section' | 'tbody';
type ItemTag = 'div' | 'li' | 'article' | 'tr';

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

/** Children wrapped in StaggerItem ease in one after another (max about 0.4 s for 10 items). */
export function Stagger({
  as = 'div',
  className,
  children,
  ...rest
}: { as?: StaggerTag; className?: string; children?: React.ReactNode } & Omit<
  HTMLMotionProps<'div'>,
  'children'
>) {
  const Comp = motion[as] as typeof motion.div;
  return (
    <Comp className={className} initial="hidden" animate="show" variants={container} {...rest}>
      {children}
    </Comp>
  );
}

export function StaggerItem({
  as = 'div',
  className,
  children,
  ...rest
}: { as?: ItemTag; className?: string; children?: React.ReactNode } & Omit<
  HTMLMotionProps<'div'>,
  'children'
>) {
  const Comp = motion[as] as typeof motion.div;
  return (
    <Comp className={className} variants={fadeUp} {...rest}>
      {children}
    </Comp>
  );
}

/** A card that lifts 2 px and deepens its shadow on hover. Use for clickable cards only. */
export const MotionCard = React.forwardRef<HTMLDivElement, HTMLMotionProps<'div'>>(
  function MotionCard({ className, ...rest }, ref) {
    return (
      <motion.div
        ref={ref}
        className={cn(
          'transition-shadow hover:shadow-[0_8px_24px_-12px_rgba(26,23,20,0.18)]',
          className,
        )}
        whileHover={{ y: -2 }}
        transition={{ duration: DURATION.fast, ease: EASE }}
        {...rest}
      />
    );
  },
);

/** Page enter: a short fade and rise when the route changes. Keyed by the caller. */
export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.base, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Splits "₹35.7k" into prefix "₹", number "35.7", suffix "k". */
const NUMBER_RE = /^(\D*?)(\d[\d,]*(?:\.\d+)?)([\s\S]*)$/;

/**
 * Counts the number inside `text` up from 0 once, on first mount, by writing to the element's
 * text directly (no re-renders). The element must render `text` as its only child, so the DOM
 * text is always the exact final value before and after (tests and screen readers read that).
 * Skipped when reduced motion is on, when the text has no number, and when the value changes.
 */
export function useCountUp(ref: React.RefObject<HTMLElement>, text: string | null) {
  const reduce = useReducedMotion();
  const latest = React.useRef(text);
  React.useLayoutEffect(() => {
    latest.current = text;
  }, [text]);
  const firstText = React.useRef(text);
  const finished = React.useRef(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || text === null || reduce || finished.current || text !== firstText.current)
      return undefined;
    const match = NUMBER_RE.exec(text);
    if (!match) return undefined;
    const [, prefix = '', digits = '', suffix = ''] = match;
    const target = Number(digits.replace(/,/g, ''));
    if (!Number.isFinite(target) || target === 0) return undefined;
    const decimals = digits.split('.')[1]?.length ?? 0;
    const format = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: digits.includes(','),
    });
    const controls = animate(0, target, {
      duration: DURATION.slow + 0.03,
      ease: EASE,
      onUpdate: (v) => {
        el.textContent = `${prefix}${format.format(v)}${suffix}`;
      },
      onComplete: () => {
        finished.current = true;
        el.textContent = latest.current ?? text;
      },
    });
    return () => {
      controls.stop();
      if (latest.current !== null) el.textContent = latest.current;
    };
  }, [ref, text, reduce]);
}
