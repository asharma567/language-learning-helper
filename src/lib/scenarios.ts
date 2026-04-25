import type { ScenarioId, LexiconEntry } from './lexicon';

export type Scenario = {
  id: ScenarioId;
  title: string;
  description: string;
  order: number;
  defaultRecommended: boolean;
};

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'approach-greet',
    title: 'Approach & Greet',
    description: 'First-contact essentials: greetings, names, pleasantries.',
    order: 1,
    defaultRecommended: true,
  },
  {
    id: 'compliment-flirt',
    title: 'Compliment & Flirt',
    description: 'Build interest: beautiful, smart, you drive me crazy.',
    order: 2,
    defaultRecommended: false,
  },
  {
    id: 'romance-intimacy',
    title: 'Romance & Intimacy',
    description: 'Close the loop: I want you, kiss me, stay with me.',
    order: 3,
    defaultRecommended: false,
  },
  {
    id: 'practical-errands',
    title: 'Practical Errands',
    description: 'Get around: taxi, metro, bathroom, how much.',
    order: 4,
    defaultRecommended: false,
  },
  {
    id: 'confrontation-dominance',
    title: 'Confrontation & Dominance',
    description: 'Direct when needed: shut up, leave me alone, go home.',
    order: 5,
    defaultRecommended: false,
  },
  {
    id: 'reactions-filler',
    title: 'Reactions & Filler',
    description: 'Sound native: really?, of course, whatever, damn.',
    order: 6,
    defaultRecommended: false,
  },
  {
    id: 'numbers-time-money',
    title: 'Numbers, Time, Money',
    description: 'Transactional fluency: 1–10, now, today, money.',
    order: 7,
    defaultRecommended: false,
  },
  {
    id: 'mat-color',
    title: 'Mat & Color',
    description: 'The spicy register: хуй, блядь, пиздец, охуенно.',
    order: 8,
    defaultRecommended: false,
  },
  {
    id: 'davai-versatile',
    title: 'Давай — The Swiss Army Word',
    description: 'Master one word with a dozen uses: agree, encourage, "let\'s …", offer to help, casual goodbye.',
    order: 9,
    defaultRecommended: false,
  },
] as const;

const scenarioMap = new Map<ScenarioId, Scenario>(
  SCENARIOS.map((s) => [s.id, s]),
);

export function getScenario(id: ScenarioId): Scenario {
  const s = scenarioMap.get(id);
  if (!s) throw new Error(`Unknown scenario id: ${id}`);
  return s;
}

export function getScenarioForEntry(entry: LexiconEntry): Scenario {
  return getScenario(entry.scenario);
}

export function entriesInScenario(
  lexicon: LexiconEntry[],
  id: ScenarioId,
): LexiconEntry[] {
  return lexicon.filter((e) => e.scenario === id);
}
