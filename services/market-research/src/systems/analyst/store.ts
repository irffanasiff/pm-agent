/**
 * Analyst Research Store
 * Typed store layer for analyst system artifacts
 */

import type { IStore } from "../../shared/store/types.js";
import type { AnalystOutput } from "./types.js";

// ============================================
// VERSIONED RESEARCH OUTPUT
// ============================================

/**
 * Versioned research document
 */
export interface VersionedResearch extends AnalystOutput {
  /** Schema version for migrations */
  schemaVersion: "research_v1";

  /** When this research was saved */
  savedAt: string;

  /** Hash of content for change detection */
  contentHash?: string;
}

// ============================================
// RESEARCH STORE INTERFACE
// ============================================

/**
 * Typed store interface for research artifacts
 */
export interface IResearchStore {
  /**
   * Load research output for a target
   */
  loadResearch(targetId: string): Promise<AnalystOutput | null>;

  /**
   * Save research output for a target
   */
  saveResearch(targetId: string, output: AnalystOutput): Promise<void>;

  /**
   * Check if research exists
   */
  hasResearch(targetId: string): Promise<boolean>;

  /**
   * Delete research for a target
   */
  deleteResearch(targetId: string): Promise<boolean>;

  /**
   * List all targets with research
   */
  listTargets(): Promise<string[]>;

  /**
   * Get the file path for a target's research
   */
  getResearchPath(targetId: string): string;
}

// ============================================
// IMPLEMENTATION
// ============================================

/**
 * File-based research store
 */
export class ResearchStore implements IResearchStore {
  private readonly store: IStore;
  private readonly namespace: string;

  constructor(store: IStore, namespace: string = "analyst") {
    this.store = store;
    this.namespace = namespace;
  }

  /**
   * Load research output
   */
  async loadResearch(targetId: string): Promise<AnalystOutput | null> {
    const key = this.researchKey(targetId);
    const data = await this.store.read<VersionedResearch>(key);

    if (!data) {
      return null;
    }

    // Strip versioning metadata when returning
    const { schemaVersion, savedAt, contentHash, ...output } = data;
    return output as AnalystOutput;
  }

  /**
   * Save research output
   */
  async saveResearch(targetId: string, output: AnalystOutput): Promise<void> {
    const versioned: VersionedResearch = {
      ...output,
      schemaVersion: "research_v1",
      savedAt: new Date().toISOString(),
      contentHash: this.hashContent(output),
    };

    await this.store.write(this.researchKey(targetId), versioned);
  }

  /**
   * Check if research exists
   */
  async hasResearch(targetId: string): Promise<boolean> {
    return this.store.exists(this.researchKey(targetId));
  }

  /**
   * Delete research
   */
  async deleteResearch(targetId: string): Promise<boolean> {
    return this.store.delete(this.researchKey(targetId));
  }

  /**
   * List all targets
   */
  async listTargets(): Promise<string[]> {
    const keys = await this.store.list(`${this.namespace}/*/research`);
    return keys.map((key) => {
      const match = key.match(new RegExp(`${this.namespace}/([^/]+)/research`));
      return match ? match[1] : "";
    }).filter(Boolean);
  }

  /**
   * Get research file path
   */
  getResearchPath(targetId: string): string {
    return this.store.getPath(this.researchKey(targetId));
  }

  /**
   * Build storage key
   */
  private researchKey(targetId: string): string {
    return `${this.namespace}/${targetId}/research`;
  }

  /**
   * Simple content hash for change detection
   */
  private hashContent(output: AnalystOutput): string {
    const str = JSON.stringify({
      summary: output.summary,
      conclusion: output.assessment.conclusion,
      confidence: output.assessment.confidence,
      sourceCount: output.sources.length,
    });
    // Simple hash - replace with crypto.subtle in production
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}

/**
 * Create a research store
 */
export function createResearchStore(store: IStore, namespace?: string): IResearchStore {
  return new ResearchStore(store, namespace);
}
