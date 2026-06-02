/**
 * Typed facade over the consensus / multi-angle / voting tunables. These are the
 * same localStorage keys the run engine, the generation-consensus path, and the
 * heuristics already read — centralised here so the Settings UI and the consumers
 * stay in sync. All values are clamped to safe ranges on read and write.
 */

export interface ConsensusSettings {
  /** Generation-time consensus on/off (owf_gen_consensus). */
  genEnabled: boolean;
  /** Candidate blueprints generated per complex request (owf_gen_candidates). */
  genCandidates: number;
  /** Default fan-out / sample count for a consensus node (owf_consensus_default_samples). */
  voteSamples: number;
  /** Show the "convert to consensus" suggestion on complex agent nodes (owf_consensus_autosuggest). */
  autoSuggest: boolean;
  /** Max independent calls run at once — also caps consensus fan-out (owf_run_concurrency). */
  concurrency: number;
  /** Max concurrent calls after a route is classified as slow. */
  slowConcurrency: number;
  /** Max concurrent calls after a route is classified as standard speed. */
  standardConcurrency: number;
  /** Max concurrent calls after a route is classified as fast. */
  fastConcurrency: number;
  /**
   * Quantity-for-quality tunables. Each feature is a (min,max) PAIR: `min` is the
   * starting agent/sample count, `max` is the divergence-escalation ceiling
   * (count doubles min→…→max while disagreement stays high). Defaults min=2 /
   * max=16 (out of the box every covered node cross-checks with 2 agents and
   * escalates only on real disagreement). Set a feature's *Max to 1 to disable it.
   */
  /**
   * Master switch for divergence-driven adaptive escalation (the
   * 2→4→8→16-on-disagreement behaviour). Default ON. When OFF, every covered
   * node still runs its starting `min` samples and votes once, but NEVER doubles
   * on high disagreement — a hard cap at `min`, regardless of the *Max ceilings.
   */
  adaptiveEscalation: boolean;
  /** Multi-angle research before generation. */
  researchAnglesMin: number;
  researchAnglesMax: number;
  /** Candidate voters when escalating a complex node to consensus during generation. */
  nodeGenCandidatesMin: number;
  nodeGenCandidatesMax: number;
  /** Run-time adversarial verify+vote for a complex node. */
  runtimeVoteSamplesMin: number;
  runtimeVoteSamplesMax: number;
  /** Run-time adversarial verify+vote for a terminal node (may exceed the complex-node count). */
  terminalVoteSamplesMin: number;
  terminalVoteSamplesMax: number;
  /** Multiplier that scales the STARTING count within [min,max] by node complexity (1 = no scaling). */
  complexityScaling: number;
}

export const CONSENSUS_LIMITS = {
  genCandidates: { min: 2, max: 5, def: 3 },
  voteSamples: { min: 2, max: 7, def: 3 },
  concurrency: { min: 1, max: 16, def: 10 },
  slowConcurrency: { min: 1, max: 16, def: 4 },
  standardConcurrency: { min: 1, max: 16, def: 5 },
  fastConcurrency: { min: 1, max: 16, def: 10 },
  // Quantity-for-quality (min,max) pairs. min:1/def:2 ⇒ a fresh install starts
  // with 2 cross-checking agents; max def:16 is the escalation ceiling. Setting
  // a *Max to 1 disables that feature (single call, no voting).
  researchAnglesMin: { min: 1, max: 16, def: 2 },
  researchAnglesMax: { min: 1, max: 16, def: 16 },
  nodeGenCandidatesMin: { min: 1, max: 16, def: 2 },
  nodeGenCandidatesMax: { min: 1, max: 16, def: 16 },
  runtimeVoteSamplesMin: { min: 1, max: 16, def: 2 },
  runtimeVoteSamplesMax: { min: 1, max: 16, def: 16 },
  terminalVoteSamplesMin: { min: 1, max: 16, def: 2 },
  terminalVoteSamplesMax: { min: 1, max: 16, def: 16 },
  complexityScaling: { min: 1, max: 4, def: 1 },
} as const;

const KEYS = {
  genEnabled: 'owf_gen_consensus',
  genCandidates: 'owf_gen_candidates',
  voteSamples: 'owf_consensus_default_samples',
  autoSuggest: 'owf_consensus_autosuggest',
  adaptiveEscalation: 'owf_adaptive_escalation',
  concurrency: 'owf_run_concurrency',
  slowConcurrency: 'owf_run_concurrency_slow',
  standardConcurrency: 'owf_run_concurrency_standard',
  fastConcurrency: 'owf_run_concurrency_fast',
  researchAnglesMin: 'owf_research_angles_min',
  researchAnglesMax: 'owf_research_angles_max',
  nodeGenCandidatesMin: 'owf_nodegen_candidates_min',
  nodeGenCandidatesMax: 'owf_nodegen_candidates_max',
  runtimeVoteSamplesMin: 'owf_runtime_vote_samples_min',
  runtimeVoteSamplesMax: 'owf_runtime_vote_samples_max',
  terminalVoteSamplesMin: 'owf_terminal_vote_samples_min',
  terminalVoteSamplesMax: 'owf_terminal_vote_samples_max',
  complexityScaling: 'owf_complexity_scaling',
} as const;

/** Fired after any consensus setting changes, so open UI / consumers can refresh. */
export const CONSENSUS_SETTINGS_EVENT = 'owf:consensus-settings-changed';

function ls(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readBool(key: string, def: boolean): boolean {
  const raw = ls()?.getItem(key);
  if (raw == null) return def;
  return raw !== '0';
}

function readInt(key: string, lim: { min: number; max: number; def: number }): number {
  const raw = ls()?.getItem(key);
  if (raw == null) return lim.def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return lim.def;
  return Math.min(lim.max, Math.max(lim.min, n));
}

export function getConsensusSettings(): ConsensusSettings {
  return {
    genEnabled: readBool(KEYS.genEnabled, true),
    genCandidates: readInt(KEYS.genCandidates, CONSENSUS_LIMITS.genCandidates),
    voteSamples: readInt(KEYS.voteSamples, CONSENSUS_LIMITS.voteSamples),
    autoSuggest: readBool(KEYS.autoSuggest, true),
    adaptiveEscalation: readBool(KEYS.adaptiveEscalation, true),
    concurrency: readInt(KEYS.concurrency, CONSENSUS_LIMITS.concurrency),
    slowConcurrency: readInt(
      KEYS.slowConcurrency,
      CONSENSUS_LIMITS.slowConcurrency,
    ),
    standardConcurrency: readInt(
      KEYS.standardConcurrency,
      CONSENSUS_LIMITS.standardConcurrency,
    ),
    fastConcurrency: readInt(
      KEYS.fastConcurrency,
      CONSENSUS_LIMITS.fastConcurrency,
    ),
    researchAnglesMin: readInt(KEYS.researchAnglesMin, CONSENSUS_LIMITS.researchAnglesMin),
    researchAnglesMax: readInt(KEYS.researchAnglesMax, CONSENSUS_LIMITS.researchAnglesMax),
    nodeGenCandidatesMin: readInt(
      KEYS.nodeGenCandidatesMin,
      CONSENSUS_LIMITS.nodeGenCandidatesMin,
    ),
    nodeGenCandidatesMax: readInt(
      KEYS.nodeGenCandidatesMax,
      CONSENSUS_LIMITS.nodeGenCandidatesMax,
    ),
    runtimeVoteSamplesMin: readInt(
      KEYS.runtimeVoteSamplesMin,
      CONSENSUS_LIMITS.runtimeVoteSamplesMin,
    ),
    runtimeVoteSamplesMax: readInt(
      KEYS.runtimeVoteSamplesMax,
      CONSENSUS_LIMITS.runtimeVoteSamplesMax,
    ),
    terminalVoteSamplesMin: readInt(
      KEYS.terminalVoteSamplesMin,
      CONSENSUS_LIMITS.terminalVoteSamplesMin,
    ),
    terminalVoteSamplesMax: readInt(
      KEYS.terminalVoteSamplesMax,
      CONSENSUS_LIMITS.terminalVoteSamplesMax,
    ),
    complexityScaling: readInt(
      KEYS.complexityScaling,
      CONSENSUS_LIMITS.complexityScaling,
    ),
  };
}

/** Generation candidate count, clamped (used by the AI-改图 consensus path). */
export function genCandidateCount(): number {
  return readInt(KEYS.genCandidates, CONSENSUS_LIMITS.genCandidates);
}

/** Whether the convert-to-consensus suggestion chip is enabled. */
export function autoSuggestEnabled(): boolean {
  return readBool(KEYS.autoSuggest, true);
}

/** A starting count + escalation ceiling for an adaptive-escalation feature. */
export interface SampleRange {
  /** Starting agent/sample count (default 2). */
  min: number;
  /** Escalation ceiling (default 16). max<=1 ⇒ the feature is OFF. */
  max: number;
}

/** Read a (min,max) pair, clamping each and enforcing min<=max. */
function readRange(
  minKey: string,
  minLim: { min: number; max: number; def: number },
  maxKey: string,
  maxLim: { min: number; max: number; def: number },
): SampleRange {
  const max = readInt(maxKey, maxLim);
  const min = Math.min(readInt(minKey, minLim), max);
  return { min, max };
}

/** Parallel research lenses before generation ({min,max}; max<=1 = off). */
export function researchAngleRange(): SampleRange {
  return readRange(
    KEYS.researchAnglesMin,
    CONSENSUS_LIMITS.researchAnglesMin,
    KEYS.researchAnglesMax,
    CONSENSUS_LIMITS.researchAnglesMax,
  );
}

/** Voters when escalating a complex node to consensus at generation ({min,max}). */
export function nodeGenCandidateRange(): SampleRange {
  return readRange(
    KEYS.nodeGenCandidatesMin,
    CONSENSUS_LIMITS.nodeGenCandidatesMin,
    KEYS.nodeGenCandidatesMax,
    CONSENSUS_LIMITS.nodeGenCandidatesMax,
  );
}

/** Run-time adversarial-vote range for a complex node ({min,max}; max<=1 = off). */
export function runtimeVoteSampleRange(): SampleRange {
  return readRange(
    KEYS.runtimeVoteSamplesMin,
    CONSENSUS_LIMITS.runtimeVoteSamplesMin,
    KEYS.runtimeVoteSamplesMax,
    CONSENSUS_LIMITS.runtimeVoteSamplesMax,
  );
}

/** Run-time adversarial-vote range for a terminal node ({min,max}; max<=1 = off). */
export function terminalVoteSampleRange(): SampleRange {
  return readRange(
    KEYS.terminalVoteSamplesMin,
    CONSENSUS_LIMITS.terminalVoteSamplesMin,
    KEYS.terminalVoteSamplesMax,
    CONSENSUS_LIMITS.terminalVoteSamplesMax,
  );
}

function rangeStart(range: SampleRange): number {
  return range.max <= 1 ? 1 : Math.max(1, range.min);
}

/** Starting research lens count for callers that do not need the max ceiling. */
export function researchAngleCount(): number {
  return rangeStart(researchAngleRange());
}

/** Starting generation-time node candidate count. */
export function nodeGenCandidates(): number {
  return rangeStart(nodeGenCandidateRange());
}

/** Starting run-time vote sample count for complex nodes. */
export function runtimeVoteSamples(): number {
  return rangeStart(runtimeVoteSampleRange());
}

/** Starting run-time vote sample count for terminal nodes. */
export function terminalVoteSamples(): number {
  return rangeStart(terminalVoteSampleRange());
}

/** Complexity multiplier applied to the STARTING count (1 = no scaling). */
export function complexityScaling(): number {
  return readInt(KEYS.complexityScaling, CONSENSUS_LIMITS.complexityScaling);
}

/** Master switch for divergence-driven escalation (default ON). */
export function adaptiveEscalationEnabled(): boolean {
  return readBool(KEYS.adaptiveEscalation, true);
}

function limitsForSetting(key: keyof ConsensusSettings): {
  min: number;
  max: number;
  def: number;
} {
  return key === 'genCandidates'
    ? CONSENSUS_LIMITS.genCandidates
    : key === 'voteSamples'
      ? CONSENSUS_LIMITS.voteSamples
      : key === 'slowConcurrency'
        ? CONSENSUS_LIMITS.slowConcurrency
        : key === 'standardConcurrency'
          ? CONSENSUS_LIMITS.standardConcurrency
          : key === 'fastConcurrency'
            ? CONSENSUS_LIMITS.fastConcurrency
            : key === 'researchAnglesMin'
              ? CONSENSUS_LIMITS.researchAnglesMin
              : key === 'researchAnglesMax'
                ? CONSENSUS_LIMITS.researchAnglesMax
                : key === 'nodeGenCandidatesMin'
                  ? CONSENSUS_LIMITS.nodeGenCandidatesMin
                  : key === 'nodeGenCandidatesMax'
                    ? CONSENSUS_LIMITS.nodeGenCandidatesMax
                    : key === 'runtimeVoteSamplesMin'
                      ? CONSENSUS_LIMITS.runtimeVoteSamplesMin
                      : key === 'runtimeVoteSamplesMax'
                        ? CONSENSUS_LIMITS.runtimeVoteSamplesMax
                        : key === 'terminalVoteSamplesMin'
                          ? CONSENSUS_LIMITS.terminalVoteSamplesMin
                          : key === 'terminalVoteSamplesMax'
                            ? CONSENSUS_LIMITS.terminalVoteSamplesMax
                            : key === 'complexityScaling'
                              ? CONSENSUS_LIMITS.complexityScaling
                              : CONSENSUS_LIMITS.concurrency;
}

export function runConcurrencyCapForTier(
  tier: 'slow' | 'standard' | 'fast',
): number {
  const key =
    tier === 'slow'
      ? 'slowConcurrency'
      : tier === 'standard'
        ? 'standardConcurrency'
        : 'fastConcurrency';
  return readInt(KEYS[key], CONSENSUS_LIMITS[key]);
}

export function setConsensusSetting<K extends keyof ConsensusSettings>(
  key: K,
  value: ConsensusSettings[K],
): void {
  const store = ls();
  if (!store) return;
  if (key === 'genEnabled' || key === 'autoSuggest' || key === 'adaptiveEscalation') {
    store.setItem(KEYS[key], value ? '1' : '0');
  } else {
    const lim = limitsForSetting(key);
    const n = Math.min(lim.max, Math.max(lim.min, Math.floor(value as number) || lim.def));
    store.setItem(KEYS[key], String(n));
  }
  try {
    window.dispatchEvent(new CustomEvent(CONSENSUS_SETTINGS_EVENT));
  } catch {
    /* ignore */
  }
}
