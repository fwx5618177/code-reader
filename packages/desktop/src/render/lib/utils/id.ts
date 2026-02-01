// ================================
// Document ID Utilities
// Uses uuid_hash format for unique identification and version tracking
// Format: {uuid}_{hash} where uuid is stable and hash changes with content
// ================================

// ================================
// UUID Generation
// ================================

/**
 * Generate a UUID v4
 * Uses crypto.randomUUID if available, otherwise fallback
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ================================
// Content Hashing
// ================================

/**
 * Simple synchronous hash function (djb2 algorithm)
 * Fast and works in all environments (browser + Node.js)
 */
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0; // Convert to unsigned
}

/**
 * Generate a short hash from content
 * Uses djb2 algorithm for browser compatibility
 * Returns 8 character hex string
 */
export function hashContent(content: string): string {
  if (!content || content.length === 0) {
    return '00000000';
  }

  // Use djb2 hash combined with content length for better distribution
  const hash1 = djb2Hash(content);
  const hash2 = djb2Hash(content.slice(Math.floor(content.length / 2)));

  // Combine hashes for 8 hex characters
  const combined = ((hash1 ^ hash2) >>> 0).toString(16).padStart(8, '0');
  return combined.substring(0, 8);
}

// ================================
// Document ID Operations
// ================================

/**
 * Document ID format: {uuid}_{hash}
 * - uuid: Stable identifier that never changes
 * - hash: Content-based hash that changes with content
 */
export interface DocumentIdParts {
  uuid: string;
  hash: string;
}

/**
 * Generate a new document ID
 * Creates a fresh UUID with initial content hash
 */
export function generateDocumentId(content: string = ''): string {
  const uuid = generateUUID();
  const hash = hashContent(content);
  return `${uuid}_${hash}`;
}

/**
 * Parse a document ID into its parts
 * Returns null if invalid format
 */
export function parseDocumentId(id: string): DocumentIdParts | null {
  const lastUnderscoreIndex = id.lastIndexOf('_');
  if (lastUnderscoreIndex === -1) {
    // Legacy ID without hash - treat entire string as uuid
    return { uuid: id, hash: '00000000' };
  }

  const uuid = id.substring(0, lastUnderscoreIndex);
  const hash = id.substring(lastUnderscoreIndex + 1);

  // Validate UUID format (basic check)
  if (uuid.length < 8) {
    return null;
  }

  return { uuid, hash };
}

/**
 * Get the stable UUID part from a document ID
 * This is used for version tracking - all versions share the same UUID
 */
export function getDocumentUUID(id: string): string {
  const parts = parseDocumentId(id);
  return parts?.uuid ?? id;
}

/**
 * Get the content hash part from a document ID
 */
export function getDocumentHash(id: string): string {
  const parts = parseDocumentId(id);
  return parts?.hash ?? '00000000';
}

/**
 * Update a document ID with new content hash
 * Keeps the same UUID, updates the hash
 */
export function updateDocumentIdHash(id: string, newContent: string): string {
  const uuid = getDocumentUUID(id);
  const hash = hashContent(newContent);
  return `${uuid}_${hash}`;
}

/**
 * Check if two document IDs refer to the same document (same UUID)
 * They may have different content hashes (different versions)
 */
export function isSameDocument(id1: string, id2: string): boolean {
  return getDocumentUUID(id1) === getDocumentUUID(id2);
}

/**
 * Check if two document IDs have the same content (same hash)
 */
export function hasSameContent(id1: string, id2: string): boolean {
  return getDocumentHash(id1) === getDocumentHash(id2);
}

/**
 * Check if a document ID uses the new uuid_hash format
 */
export function isUuidHashFormat(id: string): boolean {
  const parts = parseDocumentId(id);
  if (!parts) return false;

  // Check if it looks like a UUID (has dashes and proper length)
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(parts.uuid);
}

/**
 * Migrate a legacy ID to uuid_hash format
 * If already in new format, returns as-is
 */
export function migrateToUuidHashFormat(legacyId: string, content: string = ''): string {
  if (isUuidHashFormat(legacyId)) {
    return legacyId;
  }

  // Generate new ID with new UUID
  return generateDocumentId(content);
}

// ================================
// Version ID Operations
// ================================

/**
 * Generate a version ID for a document
 * Format: {documentUuid}_v{timestamp}_{hash}
 */
export function generateVersionId(documentId: string, content: string): string {
  const uuid = getDocumentUUID(documentId);
  const timestamp = Date.now().toString(36);
  const hash = hashContent(content);
  return `${uuid}_v${timestamp}_${hash}`;
}

/**
 * Parse a version ID
 */
export interface VersionIdParts {
  documentUuid: string;
  timestamp: number;
  hash: string;
}

export function parseVersionId(versionId: string): VersionIdParts | null {
  const parts = versionId.split('_v');
  if (parts.length !== 2) return null;

  const documentUuid = parts[0];
  const [timestampStr, hash] = parts[1].split('_');

  if (!timestampStr || !hash) return null;

  const timestamp = parseInt(timestampStr, 36);
  if (isNaN(timestamp)) return null;

  return { documentUuid, timestamp, hash };
}

/**
 * Get all versions for a document ID
 * Filters versions by matching document UUID
 */
export function getVersionsForDocument(documentId: string, allVersionIds: string[]): string[] {
  const uuid = getDocumentUUID(documentId);
  return allVersionIds.filter((versionId) => {
    const parts = parseVersionId(versionId);
    return parts?.documentUuid === uuid;
  });
}
