/**
 * File Store
 * File system implementation of IStore
 */

import fs from "fs/promises";
import path from "path";
import type { IStore, StoreOptions } from "./types.js";

/**
 * File system based store
 */
export class FileStore implements IStore {
  private readonly basePath: string;
  private readonly prettyPrint: boolean;

  constructor(options: StoreOptions) {
    this.basePath = options.basePath;
    this.prettyPrint = options.prettyPrint ?? true;
  }

  /**
   * Get full path for a key
   */
  getPath(key: string): string {
    // Ensure key ends with .json if no extension
    const normalizedKey = key.endsWith(".json") ? key : `${key}.json`;
    return path.join(this.basePath, normalizedKey);
  }

  /**
   * Read data from file
   */
  async read<T>(key: string): Promise<T | null> {
    const filePath = this.getPath(key);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Write data to file
   */
  async write<T>(key: string, data: T): Promise<void> {
    const filePath = this.getPath(key);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write file
    const content = this.prettyPrint
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);

    await fs.writeFile(filePath, content, "utf-8");
  }

  /**
   * Check if file exists
   */
  async exists(key: string): Promise<boolean> {
    const filePath = this.getPath(key);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete file
   */
  async delete(key: string): Promise<boolean> {
    const filePath = this.getPath(key);

    try {
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List files matching pattern
   */
  async list(pattern?: string): Promise<string[]> {
    const keys: string[] = [];

    async function walk(dir: string, baseDir: string): Promise<void> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(baseDir, fullPath);

          if (entry.isDirectory()) {
            await walk(fullPath, baseDir);
          } else if (entry.isFile() && entry.name.endsWith(".json")) {
            // Remove .json extension for key
            const key = relativePath.replace(/\.json$/, "");

            if (!pattern || key.includes(pattern)) {
              keys.push(key);
            }
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    await walk(this.basePath, this.basePath);
    return keys;
  }
}

/**
 * Create a file store
 */
export function createFileStore(basePath: string, options?: Partial<StoreOptions>): IStore {
  return new FileStore({
    basePath,
    prettyPrint: options?.prettyPrint ?? true,
  });
}
