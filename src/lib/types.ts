// Row shapes shared by Dexie and Supabase. Column names match Postgres
// (snake_case) so sync can move rows without mapping.

export interface BaseRow {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type Role = 'reviewee' | 'supporter';
export type Session = 'AM' | 'PM';

export interface Profile extends BaseRow {
  role: Role;
  display_name: string | null;
  partner_id: string | null;
}

export interface ExamConfig extends BaseRow {
  name: string;
  day1: string;
  day2: string;
  day3: string;
  am_start: string;
  am_end: string;
  pm_start: string;
  pm_end: string;
  questions_per_subject: number;
  points_per_question: number;
  coverage_cutoff: string;
  passing_gwa: number;
  is_active: boolean;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Subject extends BaseRow {
  code: string;
  name: string;
  weight: number;
  exam_day: number;
  session: Session;
  color: string;
  difficulty: Difficulty;
  sort: number;
}

export type NodeStatus = 'not_started' | 'read_once' | 'reviewed' | 'confident';

export interface SyllabusNode extends BaseRow {
  subject_id: string;
  parent_id: string | null;
  marker: string;
  title: string;
  sort: number;
  depth: number;
  status: NodeStatus;
  needs_work: boolean;
  notes: string;
  starred: boolean;
  last_studied_at: string | null;
  times_studied: number;
  unmatched: boolean;
}

export interface SplitPattern {
  regex: string;
  kind: 'provision' | 'heading';
  /** Label template; $1 is the first capture group. Empty for context-only headings. */
  label: string;
  /** For headings: whether provision labels below it are prefixed with it (Rule 70, Sec. 1). */
  prefix?: boolean;
  caseSensitive?: boolean;
}

export interface Law extends BaseRow {
  title: string;
  short_name: string;
  citation: string;
  primary_subject_id: string | null;
  source_url: string;
  split_patterns: SplitPattern[] | null;
}

export interface Provision extends BaseRow {
  law_id: string;
  label: string;
  heading: string;
  text: string;
  sort: number;
  read_count: number;
  last_read_at: string | null;
  notes: string;
  starred: boolean;
}

export interface Highlight extends BaseRow {
  provision_id: string;
  start: number;
  end: number;
  color_key: string;
  needs_review: boolean;
}

export type Division = 'en_banc' | 'division';

export interface Digest extends BaseRow {
  subject_id: string | null;
  title: string;
  gr_no: string;
  promulgated_on: string | null;
  ponente: string;
  division: Division | null;
  doctrine: string;
  facts: string;
  issues: string;
  ruling: string;
  notes: string;
  separate_opinions: string;
  source_url: string;
  starred: boolean;
}

export type CardType = 'basic' | 'cloze';
export type SourceType = 'provision' | 'digest' | 'mistake' | 'question' | 'manual' | 'import';

export interface CardRow extends BaseRow {
  subject_id: string | null;
  type: CardType;
  front: string;
  back: string;
  cloze_text: string;
  source_type: SourceType | null;
  source_id: string | null;
  tags: string[];
  suspended: boolean;
  starred: boolean;
}

// FSRS state fields exactly as in ts-fsrs's Card, with dates as ISO strings.
export interface CardItem extends BaseRow {
  card_id: string;
  cloze_index: number | null;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

export interface ReviewLogRow extends BaseRow {
  card_item_id: string;
  rating: number;
  reviewed_at: string;
  duration_ms: number;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  review: string;
}

export type QuestionType = 'essay' | 'practical';

export interface Question extends BaseRow {
  subject_id: string | null;
  type: QuestionType;
  source_label: string;
  year: number | null;
  number: string;
  text: string;
  points: number;
  reference_answer: string;
  form_type: string;
  notes: string;
}

export type AttemptMode = 'drill' | 'mock' | 'bar_day';
export type AttemptStatus = 'in_progress' | 'submitted' | 'graded';

export interface Attempt extends BaseRow {
  mode: AttemptMode;
  subject_id: string | null;
  started_at: string;
  time_limit_sec: number;
  submitted_at: string | null;
  status: AttemptStatus;
  device_id: string;
  bar_day_group_id: string | null;
}

export type StructureMark = 'yes' | 'partly' | 'no';

export interface AttemptItem extends BaseRow {
  attempt_id: string;
  question_id: string;
  position: number;
  answer: string;
  time_spent_sec: number;
  flagged: boolean;
  score: number | null;
  structure: Record<string, StructureMark> | null;
  error_tags: string[];
  checklist: Record<string, boolean> | null;
  grader_notes: string;
  ai_notes: unknown | null;
}

export type MistakeSource = 'attempt' | 'card' | 'manual';

export interface Mistake extends BaseRow {
  subject_id: string | null;
  node_id: string | null;
  source_type: MistakeSource;
  source_id: string | null;
  what_went_wrong: string;
  correct_rule: string;
  error_type: string;
  status: 'open' | 'fixed';
  card_id: string | null;
}

export type SessionKind = 'reading' | 'cards' | 'practice' | 'lecture' | 'other';
export type SessionSource = 'timer' | 'cards' | 'exam' | 'manual';

export interface StudySession extends BaseRow {
  subject_id: string | null;
  node_id: string | null;
  kind: SessionKind;
  source: SessionSource;
  started_at: string;
  ended_at: string | null;
  duration_sec: number;
  paused_sec: number;
  paused_at: string | null;
  note: string;
}

export interface PhaseDef {
  key: 'first_read' | 'second_read' | 'mocks' | 'final';
  label: string;
  start: string;
  end: string;
}

export interface Plan extends BaseRow {
  start_date: string;
  hours_by_weekday: number[];
  rest_rules: { restDays: string[]; halfDays: string[]; daysBeforeDay1?: number };
  max_subjects_per_day: number;
  phases: PhaseDef[];
  generated_at: string;
}

export type BlockStatus = 'planned' | 'done' | 'skipped' | 'moved';

export interface PlanBlock extends BaseRow {
  plan_id: string;
  date: string;
  subject_id: string;
  minutes: number;
  kind: SessionKind;
  status: BlockStatus;
  continue_node_id: string | null;
}

export interface EventRow extends BaseRow {
  title: string;
  starts_at: string;
  ends_at: string;
  kind: 'lecture' | 'mock' | 'personal';
  subject_id: string | null;
}

export type LinkTarget = 'provision' | 'digest' | 'card' | 'question' | 'mistake';

export interface NodeLink extends BaseRow {
  node_id: string;
  target_type: LinkTarget;
  target_id: string;
}

export interface FormChecklist extends BaseRow {
  form_type: string;
  items: string[];
}

export interface BaonNote {
  id: string;
  author_id: string;
  recipient_id: string;
  body: string;
  show_on: string | null;
  seen_at: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface HighlightColor {
  key: string;
  label: string;
  color: string;
}

export interface SettingsData {
  greetingName: string;
  leafScores: Record<NodeStatus, number>;
  desiredRetention: number;
  newCardsPerDay: number;
  maxReviewsPerDay: number;
  minutesPerProblem: number;
  dailyCapHours: number;
  neglectDays: number;
  pomodoroWork: number;
  pomodoroBreak: number;
  theme: 'system' | 'light' | 'dark' | 'sepia';
  textSize: number;
  lineHeight: number;
  highlightLegend: HighlightColor[];
  structureTemplate: string[];
  errorTags: string[];
  baonEnabled: boolean;
  allowPasteInExam: boolean;
  lastExportAt: string | null;
  examDayChecklist: string[];
  cramReschedules: boolean;
  aiNotesEnabled: boolean;
  aiMonthlyCap: number;
  pomodoro: boolean;
  /** Daily weighted coverage, for the trend line. */
  coverageHistory: { date: string; value: number }[];
}

export interface SettingsRow extends BaseRow {
  data: SettingsData;
}

export interface TableMap {
  profiles: Profile;
  exam_configs: ExamConfig;
  subjects: Subject;
  syllabus_nodes: SyllabusNode;
  laws: Law;
  provisions: Provision;
  highlights: Highlight;
  digests: Digest;
  cards: CardRow;
  card_items: CardItem;
  review_logs: ReviewLogRow;
  questions: Question;
  attempts: Attempt;
  attempt_items: AttemptItem;
  mistakes: Mistake;
  study_sessions: StudySession;
  plans: Plan;
  plan_blocks: PlanBlock;
  events: EventRow;
  node_links: NodeLink;
  form_checklists: FormChecklist;
  baon_notes: BaonNote;
  settings: SettingsRow;
}

export type TableName = keyof TableMap;
