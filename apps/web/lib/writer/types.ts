export type ContentSampleKind = 'golden' | 'avoid';
export type ContentSampleOrigin = 'pasted' | 'published' | 'imported';
export type ContentDnaProfileStatus = 'building' | 'active' | 'failed' | 'superseded';
export type DnaConfidenceLevel = 'low' | 'provisional' | 'usable' | 'precise';

export type ContentDnaFeatureKey =
  | 'sentence_length'
  | 'paragraph_length'
  | 'first_person'
  | 'questions'
  | 'exclamations'
  | 'lists'
  | 'cta'
  | 'opening_shapes'
  | 'whitespace';

export interface ContentSampleRow {
  id: string;
  workspace_id: string;
  kind: ContentSampleKind;
  origin: ContentSampleOrigin;
  platform: string | null;
  content: string;
  source_post_item_id: string | null;
  source_url: string | null;
  label: string | null;
  active: boolean;
  content_hash: string;
  embedding: string | number[] | null;
  created_at: string;
  updated_at: string;
}

export interface ContentDnaProfile {
  medianSentenceLength: number;
  medianParagraphLength: number;
  firstPersonRate: number;
  questionRate: number;
  exclamationRate: number;
  listUsage: number;
  ctaPresence: number;
  commonOpeningShapes: string[];
  preferredWhitespaceDensity: number;
}

export interface DnaFeatureConfidence {
  level: DnaConfidenceLevel;
  sampleCount: number;
}

export interface ContentDnaConfidence {
  overall: DnaConfidenceLevel;
  features: Record<ContentDnaFeatureKey, DnaFeatureConfidence>;
}

export interface DnaPromptRule {
  key: string;
  instruction: string;
  locked: boolean;
}

export interface DnaLockedRule extends DnaPromptRule {
  locked: true;
}

export interface ContentDnaProfileRow {
  id: string;
  workspace_id: string;
  version: number;
  status: ContentDnaProfileStatus;
  sample_set_hash: string;
  schema_version: string;
  profile: ContentDnaProfile;
  confidence: ContentDnaConfidence;
  prompt_rules: DnaPromptRule[];
  locked_rules: DnaLockedRule[];
  sample_count: number;
  model: string;
  prompt_version: string;
  created_at: string;
}

export interface DnaSampleInput {
  kind: ContentSampleKind;
  content: string;
  active?: boolean;
}

export interface ContentDnaAnalysis {
  profile: ContentDnaProfile;
  confidence: ContentDnaConfidence;
  promptRules: DnaPromptRule[];
  lockedRules: DnaLockedRule[];
  sampleCount: number;
}

export interface SampleSetHashInput {
  kind: ContentSampleKind;
  contentHash: string;
}

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

// Future persistence services import these allowlists instead of `select('*')`.
export const CONTENT_SAMPLE_ROW_COLUMNS = [
  'id',
  'workspace_id',
  'kind',
  'origin',
  'platform',
  'content',
  'source_post_item_id',
  'source_url',
  'label',
  'active',
  'content_hash',
  'embedding',
  'created_at',
  'updated_at',
].join(', ');

export const CONTENT_DNA_PROFILE_ROW_COLUMNS = [
  'id',
  'workspace_id',
  'version',
  'status',
  'sample_set_hash',
  'schema_version',
  'profile',
  'confidence',
  'prompt_rules',
  'locked_rules',
  'sample_count',
  'model',
  'prompt_version',
  'created_at',
].join(', ');
