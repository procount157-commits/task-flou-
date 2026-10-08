export interface Base {
  id: string;
  created_date: string;
  updated_date: string;
  created_by_id: string;
}

export type Priority = 'low' | 'medium' | 'high';
export type GoalLevel = 'life' | 'ten_years' | 'three_years' | 'one_year' | 'three_months' | 'one_month' | 'one_week';
export type GoalStatus = 'not_started' | 'in_progress' | 'completed' | 'cancelled';
export type Mood = 'great' | 'good' | 'okay' | 'bad' | 'terrible';

export interface RewardFields {
  reward_title?: string;
  reward_icon?: string;
  reward_description?: string;
}

export interface UserProfile extends Base {
  onboarding_complete?: boolean;
  birth_date?: string;
  target_age?: number;
  full_name?: string;
  wake_time?: string;
  sleep_time?: string;
  work_hours_start?: string;
  work_hours_end?: string;
  work_days?: string;
  free_time_hours?: number;
  study_hours_daily?: number;
  study_subjects?: string;
  daily_intention?: string;
  last_intention_date?: string;
}

export interface Goal extends Base, RewardFields {
  title: string;
  level: GoalLevel;
  parent_id?: string;
  status?: GoalStatus;
  progress?: number;
  // when set, progress is the average of the child goals instead of the manual number
  auto_progress?: boolean;
  priority?: Priority;
  due_date?: string;
  description?: string;
  color?: string;
}

export interface DailyTask extends Base {
  title: string;
  date: string;
  time?: string;
  end_time?: string;
  completed?: boolean;
  priority?: Priority;
  repeat_days?: number[];
  // the repeating task this day's copy was generated from
  repeat_source_id?: string;
  parent_id?: string;
  goal_id?: string;
  habit_id?: string;
  content_id?: string;
  learning_id?: string;
  calendar_event_id?: string;
  reminder_sent?: boolean;
  notes?: string;
  // a user-made list (see TaskList); tasks without one live in the inbox
  list_id?: string;
}

export type TaskList = { id: string; name: string; color: string };

export interface Habit extends Base, RewardFields {
  title: string;
  frequency?: 'daily' | 'weekly';
  repeat_days?: number[];
  target_days?: number;
  daily_count?: number;
  weekly_target?: number;
  start_date?: string;
  end_date?: string;
  time?: string;
  color?: string;
  streak?: number;
  goal_id?: string;
  is_active?: boolean;
  order?: number;
}

export interface HabitLog extends Base {
  habit_id: string;
  date: string;
  completed?: boolean;
  // how many of the habit's daily_count repetitions are done
  count?: number;
  note?: string;
}

export interface JournalEntry extends Base {
  date: string;
  mood?: Mood;
  energy?: number;
  content?: string;
  gratitude?: string;
  wins?: string;
  improvements?: string;
  tomorrow_focus?: string;
  reflection_answers?: Record<string, string>;
  tags?: string[];
  audio_urls?: string[];
}

export interface PomodoroSession extends Base {
  date: string;
  focus_minutes?: number;
  break_minutes?: number;
  sessions_completed?: number;
  cycles_completed?: number;
  task_title?: string;
  start_time?: string;
  end_time?: string;
  sound_preference?: string;
}

export type FinanceCategory = 'savings' | 'investment' | 'emergency' | 'travel' | 'house' | 'car' | 'education' | 'retirement' | 'other';
export interface FinanceGoal extends Base {
  title: string;
  target_amount: number;
  current_amount?: number;
  deadline?: string;
  category?: FinanceCategory;
  is_completed?: boolean;
}

export type TxCategory = 'salary' | 'freelance' | 'investment' | 'food' | 'transport' | 'housing' | 'health' | 'education' | 'entertainment' | 'shopping' | 'utilities' | 'savings' | 'other';
export interface Transaction extends Base {
  title: string;
  amount: number;
  type: 'income' | 'expense';
  category?: TxCategory;
  date: string;
  note?: string;
  goal_id?: string;
  recurring?: boolean;
}

export interface Salary extends Base {
  title: string;
  amount: number;
  date: string;
  source?: string;
  type?: 'monthly' | 'bonus' | 'commission' | 'freelance' | 'other';
  note?: string;
}

export type LearningType = 'course' | 'book' | 'video' | 'article' | 'podcast' | 'workshop' | 'other';
export type LearningStatus = 'wishlist' | 'in_progress' | 'completed' | 'paused';
export interface LearningItem extends Base {
  title: string;
  type?: LearningType;
  status?: LearningStatus;
  source_url?: string;
  platform?: string;
  cover_url?: string;
  progress_percent?: number;
  total_lessons?: number;
  completed_lessons?: number;
  notes?: string;
  tags?: string[];
  field_id?: string;
  goal_id?: string;
  habit_id?: string;
  brainstorm_id?: string;
  is_starred?: boolean;
  attachments?: string[];
}

export interface LearningField extends Base {
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  goal_id?: string;
  is_active?: boolean;
}

export interface LearningTask extends Base {
  title: string;
  learning_item_id: string;
  completed?: boolean;
  priority?: Priority;
  due_date?: string;
  notes?: string;
}

export type ContentType = 'idea' | 'script' | 'post' | 'article' | 'video' | 'image' | 'link' | 'template';
export type ContentPlatform = 'instagram' | 'twitter' | 'youtube' | 'tiktok' | 'linkedin' | 'blog' | 'podcast' | 'other';
export type ContentStatus = 'idea' | 'draft' | 'ready' | 'scheduled' | 'published';
export interface ContentItem extends Base {
  title: string;
  description?: string;
  type?: ContentType;
  platform?: ContentPlatform;
  status?: ContentStatus;
  content_body?: string;
  media_url?: string;
  external_link?: string;
  scheduled_date?: string;
  tags?: string[];
  goal_id?: string;
  habit_id?: string;
  task_id?: string;
  brainstorm_id?: string;
  is_starred?: boolean;
}

export type BrainCategory = 'idea' | 'project' | 'problem' | 'opportunity' | 'note';
export interface BrainstormIdea extends Base {
  title: string;
  content?: string;
  category?: BrainCategory;
  tags?: string[];
  starred?: boolean;
  audio_url?: string;
}

export interface KolbSession extends Base {
  title: string;
  date: string;
  is_followup?: boolean;
  audio_urls?: string[];
  // the four stages' answers, keyed exp_*, ref_*, abs_*, act_*
  [field: string]: any;
}

export interface GiftSuggestion extends Base {
  recipient_name: string;
  occasion: string;
  budget_min?: number;
  budget_max?: number;
  suggestions?: string[];
  selected_gift?: string;
  purchase_date?: string;
  notes?: string;
  is_purchased?: boolean;
}

export interface Client extends Base {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  status?: 'active' | 'inactive' | 'prospect';
  total_paid?: number;
  notes?: string;
}

export interface MotivationSettings extends Base {
  email?: string;
  send_daily_email?: boolean;
  send_daily_reminder?: boolean;
  reminder_time?: string;
  last_email_sent?: string;
  motivational_quote?: string;
}

export interface Reward extends Base {
  title: string;
  description?: string;
  icon?: string;
  type?: 'goal' | 'habit';
  linked_id?: string;
  is_claimed?: boolean;
  claimed_date?: string;
}

// One answer to the hourly "what were you doing?" check-in.
export interface ActivityLog extends Base {
  date: string;
  time: string;
  text?: string;
  audio_url?: string;
  // the reflective exchange that followed: the coach's questions and the spoken answers
  dialog?: { role: 'ai' | 'me'; text: string }[];
  audio_urls?: string[];
}

export type Alarm = { id: string; time: string; days: number[]; sound: 'ambulance' | 'whistle' | 'wail'; challenge: 'steps' | 'math'; enabled: boolean; label?: string };

export interface EntityMap {
  ActivityLog: ActivityLog;
  UserProfile: UserProfile;
  Goal: Goal;
  DailyTask: DailyTask;
  Habit: Habit;
  HabitLog: HabitLog;
  JournalEntry: JournalEntry;
  PomodoroSession: PomodoroSession;
  FinanceGoal: FinanceGoal;
  Transaction: Transaction;
  Salary: Salary;
  LearningItem: LearningItem;
  LearningField: LearningField;
  LearningTask: LearningTask;
  ContentItem: ContentItem;
  BrainstormIdea: BrainstormIdea;
  KolbSession: KolbSession;
  GiftSuggestion: GiftSuggestion;
  Client: Client;
  MotivationSettings: MotivationSettings;
  Reward: Reward;
}
export type EntityName = keyof EntityMap;
