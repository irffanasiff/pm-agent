/**
 * Store Types
 * Interface for data persistence layer
 */

// ============================================
// STORE INTERFACE
// ============================================

/**
 * Store interface - abstracts data persistence
 */
export interface IStore {
  /**
   * Read data from store
   */
  read<T>(key: string): Promise<T | null>;

  /**
   * Write data to store
   */
  write<T>(key: string, data: T): Promise<void>;

  /**
   * Check if key exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * Delete data
   */
  delete(key: string): Promise<boolean>;

  /**
   * List keys matching pattern
   */
  list(pattern?: string): Promise<string[]>;

  /**
   * Get the actual path/location for a key
   * Useful for passing to agents that need file paths
   */
  getPath(key: string): string;
}

// ============================================
// STORE OPTIONS
// ============================================

/**
 * Options for creating a store
 */
export interface StoreOptions {
  /** Base directory or namespace */
  basePath: string;

  /** Pretty print JSON */
  prettyPrint?: boolean;
}
