/**
 * Evidence Aggregator
 * Combines multiple research results into a unified evidence package
 * Used by Forecaster to analyze combined evidence from multiple research questions
 */

import type { EvidencePackage } from "../agents/forecaster/types.js";
import type { FilterOutput } from "../agents/filter/types.js";
import type { Finding, TimelineEvent, OpenQuestion, Source } from "../agents/researcher/types.js";

// ============================================
// TYPES
// ============================================

export interface AggregatedEvidence {
  /**
   * Combined summary from all research
   */
  summary: string;

  /**
   * All unique findings, deduplicated by claim similarity
   */
  findings: AggregatedFinding[];

  /**
   * Merged timeline from all research
   */
  timeline: TimelineEvent[];

  /**
   * Combined open questions
   */
  openQuestions: OpenQuestion[];

  /**
   * All unique sources
   */
  sources: Source[];

  /**
   * Metadata about aggregation
   */
  meta: AggregationMeta;
}

export interface AggregatedFinding extends Finding {
  /**
   * Which research questions contributed to this finding
   */
  sourceQuestions: string[];

  /**
   * Number of times this claim appeared across research
   */
  occurrences: number;
}

export interface AggregationMeta {
  /**
   * Total evidence packages aggregated
   */
  packagesAggregated: number;

  /**
   * Total research cost
   */
  totalResearchCostUsd: number;

  /**
   * Total filter cost
   */
  totalFilterCostUsd: number;

  /**
   * Total duration
   */
  totalDurationMs: number;

  /**
   * Findings before deduplication
   */
  rawFindingsCount: number;

  /**
   * Findings after deduplication
   */
  dedupedFindingsCount: number;

  /**
   * Sources before deduplication
   */
  rawSourcesCount: number;

  /**
   * Sources after deduplication
   */
  dedupedSourcesCount: number;

  /**
   * Questions that were answered
   */
  questionsAnswered: string[];
}

// ============================================
// AGGREGATION FUNCTIONS
// ============================================

/**
 * Aggregate multiple evidence packages into unified evidence
 */
export function aggregateEvidence(packages: EvidencePackage[]): AggregatedEvidence {
  if (packages.length === 0) {
    return createEmptyAggregation();
  }

  // Extract all filtered research outputs
  const filteredOutputs = packages.map((p) => p.filteredResearch);

  // Aggregate each component
  const { findings, rawCount: rawFindingsCount, dedupedCount: dedupedFindingsCount } =
    aggregateFindings(filteredOutputs, packages);

  const timeline = aggregateTimeline(filteredOutputs);
  const openQuestions = aggregateOpenQuestions(filteredOutputs);

  const { sources, rawCount: rawSourcesCount, dedupedCount: dedupedSourcesCount } =
    aggregateSources(filteredOutputs);

  const summary = aggregateSummaries(filteredOutputs);

  // Calculate totals
  const totalResearchCostUsd = packages.reduce((sum, p) => sum + p.meta.researchCostUsd, 0);
  const totalFilterCostUsd = packages.reduce((sum, p) => sum + p.meta.filterCostUsd, 0);
  const totalDurationMs = packages.reduce((sum, p) => sum + p.meta.durationMs, 0);

  return {
    summary,
    findings,
    timeline,
    openQuestions,
    sources,
    meta: {
      packagesAggregated: packages.length,
      totalResearchCostUsd,
      totalFilterCostUsd,
      totalDurationMs,
      rawFindingsCount,
      dedupedFindingsCount,
      rawSourcesCount,
      dedupedSourcesCount,
      questionsAnswered: packages.map((p) => p.questionId),
    },
  };
}

/**
 * Create empty aggregation (no evidence)
 */
function createEmptyAggregation(): AggregatedEvidence {
  return {
    summary: "No research evidence available.",
    findings: [],
    timeline: [],
    openQuestions: [],
    sources: [],
    meta: {
      packagesAggregated: 0,
      totalResearchCostUsd: 0,
      totalFilterCostUsd: 0,
      totalDurationMs: 0,
      rawFindingsCount: 0,
      dedupedFindingsCount: 0,
      rawSourcesCount: 0,
      dedupedSourcesCount: 0,
      questionsAnswered: [],
    },
  };
}

/**
 * Aggregate and deduplicate findings
 */
function aggregateFindings(
  outputs: FilterOutput[],
  packages: EvidencePackage[]
): { findings: AggregatedFinding[]; rawCount: number; dedupedCount: number } {
  const findingsMap = new Map<string, AggregatedFinding>();
  let rawCount = 0;

  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i];
    const questionId = packages[i].questionId;

    for (const finding of output.findings) {
      rawCount++;

      // Create normalized key for deduplication (lowercase claim)
      const key = normalizeClaim(finding.claim);

      if (findingsMap.has(key)) {
        // Merge with existing finding
        const existing = findingsMap.get(key)!;
        existing.occurrences++;
        existing.sourceQuestions.push(questionId);

        // Merge sources (dedupe by URL)
        existing.supportingSources = dedupeStrings([
          ...existing.supportingSources,
          ...finding.supportingSources,
        ]);
        existing.opposingSources = dedupeStrings([
          ...existing.opposingSources,
          ...finding.opposingSources,
        ]);

        // Keep the more conservative status
        existing.status = moreConservativeStatus(existing.status, finding.status);

        // Append notes if different
        if (finding.notes && finding.notes !== existing.notes) {
          existing.notes = existing.notes
            ? `${existing.notes}; ${finding.notes}`
            : finding.notes;
        }
      } else {
        // Add new finding
        findingsMap.set(key, {
          ...finding,
          sourceQuestions: [questionId],
          occurrences: 1,
        });
      }
    }
  }

  // Sort by occurrences (most common first), then by status confidence
  const findings = Array.from(findingsMap.values()).sort((a, b) => {
    if (b.occurrences !== a.occurrences) {
      return b.occurrences - a.occurrences;
    }
    return statusWeight(b.status) - statusWeight(a.status);
  });

  return {
    findings,
    rawCount,
    dedupedCount: findings.length,
  };
}

/**
 * Aggregate and deduplicate timeline events
 */
function aggregateTimeline(outputs: FilterOutput[]): TimelineEvent[] {
  const eventsMap = new Map<string, TimelineEvent>();

  for (const output of outputs) {
    for (const event of output.timeline) {
      // Key by date + normalized event text
      const key = `${event.date}:${normalizeText(event.event)}`;

      if (eventsMap.has(key)) {
        // Merge sources
        const existing = eventsMap.get(key)!;
        existing.sources = dedupeStrings([...existing.sources, ...event.sources]);
      } else {
        eventsMap.set(key, { ...event });
      }
    }
  }

  // Sort by date (most recent first)
  return Array.from(eventsMap.values()).sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
}

/**
 * Aggregate open questions (dedupe by similarity)
 */
function aggregateOpenQuestions(outputs: FilterOutput[]): OpenQuestion[] {
  const questionsMap = new Map<string, OpenQuestion>();

  for (const output of outputs) {
    for (const question of output.openQuestions) {
      const key = normalizeText(question.question);

      if (!questionsMap.has(key)) {
        questionsMap.set(key, question);
      }
    }
  }

  return Array.from(questionsMap.values());
}

/**
 * Aggregate and deduplicate sources
 */
function aggregateSources(
  outputs: FilterOutput[]
): { sources: Source[]; rawCount: number; dedupedCount: number } {
  const sourcesMap = new Map<string, Source>();
  let rawCount = 0;

  for (const output of outputs) {
    for (const source of output.sources) {
      rawCount++;

      // Dedupe by URL
      if (!sourcesMap.has(source.url)) {
        sourcesMap.set(source.url, source);
      } else {
        // Keep the source with higher credibility/relevance
        const existing = sourcesMap.get(source.url)!;
        if (
          credibilityWeight(source.credibility) > credibilityWeight(existing.credibility) ||
          relevanceWeight(source.relevance) > relevanceWeight(existing.relevance)
        ) {
          sourcesMap.set(source.url, source);
        }
      }
    }
  }

  // Sort by credibility then relevance
  const sources = Array.from(sourcesMap.values()).sort((a, b) => {
    const credDiff = credibilityWeight(b.credibility) - credibilityWeight(a.credibility);
    if (credDiff !== 0) return credDiff;
    return relevanceWeight(b.relevance) - relevanceWeight(a.relevance);
  });

  return {
    sources,
    rawCount,
    dedupedCount: sources.length,
  };
}

/**
 * Combine summaries from all research
 */
function aggregateSummaries(outputs: FilterOutput[]): string {
  if (outputs.length === 0) {
    return "No research evidence available.";
  }

  if (outputs.length === 1) {
    return outputs[0].summary;
  }

  // Combine summaries with section headers
  const summaries = outputs.map((o, i) => `Research ${i + 1}: ${o.summary}`);
  return summaries.join("\n\n");
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function normalizeClaim(claim: string): string {
  return claim.toLowerCase().trim().replace(/\s+/g, " ");
}

function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ").slice(0, 100);
}

function dedupeStrings(strings: string[]): string[] {
  return Array.from(new Set(strings));
}

function moreConservativeStatus(
  a: "supported" | "contested" | "unclear",
  b: "supported" | "contested" | "unclear"
): "supported" | "contested" | "unclear" {
  const weights = { unclear: 0, contested: 1, supported: 2 };
  return weights[a] <= weights[b] ? a : b;
}

function statusWeight(status: "supported" | "contested" | "unclear"): number {
  const weights = { supported: 2, contested: 1, unclear: 0 };
  return weights[status];
}

function credibilityWeight(level: "high" | "medium" | "low"): number {
  const weights = { high: 2, medium: 1, low: 0 };
  return weights[level];
}

function relevanceWeight(level: "high" | "medium" | "low"): number {
  const weights = { high: 2, medium: 1, low: 0 };
  return weights[level];
}

// ============================================
// EXPORT FOR PROMPTS
// ============================================

/**
 * Format aggregated evidence for inclusion in prompts
 */
export function formatEvidenceForPrompt(evidence: AggregatedEvidence): string {
  return JSON.stringify(
    {
      summary: evidence.summary,
      findings: evidence.findings.map((f) => ({
        topic: f.topic,
        claim: f.claim,
        status: f.status,
        supportingSources: f.supportingSources,
        opposingSources: f.opposingSources,
        occurrences: f.occurrences,
      })),
      timeline: evidence.timeline.slice(0, 20), // Limit for prompt size
      openQuestions: evidence.openQuestions,
      sources: evidence.sources.map((s) => ({
        url: s.url,
        title: s.title,
        type: s.type,
        credibility: s.credibility,
        relevance: s.relevance,
      })),
      meta: {
        packagesAggregated: evidence.meta.packagesAggregated,
        questionsAnswered: evidence.meta.questionsAnswered,
        totalFindings: evidence.meta.dedupedFindingsCount,
        totalSources: evidence.meta.dedupedSourcesCount,
      },
    },
    null,
    2
  );
}
