/**
 * Type declarations for fossil-delta
 * Binary delta compression library
 * @see https://github.com/nickg/fossil-delta-js
 */

declare module 'fossil-delta' {
  /**
   * Create a delta (patch) from source to target
   * @param source - Original data as array of bytes
   * @param target - Target data as array of bytes
   * @returns Delta as array of bytes
   */
  export function create(source: number[], target: number[]): number[];

  /**
   * Apply a delta to source to produce target
   * @param source - Original data as array of bytes
   * @param delta - Delta to apply
   * @returns Reconstructed target as array of bytes
   */
  export function apply(source: number[], delta: number[]): number[];

  /**
   * Calculate the size of the output from applying a delta
   * @param delta - Delta to analyze
   * @returns Size of the output that would result from applying the delta
   */
  export function outputSize(delta: number[]): number;
}
