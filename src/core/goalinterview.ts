// Goal discovery interview: understand the person before any plan exists. Pure — no React Native, no AI.
// The AI may rephrase a question or supply goal-specific options, but the flow, the gate and the stored
// answers are decided here, deterministically, so an interview can stop and resume and be tested.

export const GOAL_CATEGORIES = ['education', 'financial', 'business', 'career', 'fitness', 'personal', 'lifestyle'] as const;
export type GoalCategory = (typeof GOAL_CATEGORIES)[number];

export type Slot =
  | 'outcome' | 'outcome_detail' | 'success' | 'baseline_value' | 'target_value' | 'min_ideal'
  | 'why' | 'why_genuine' | 'meaning'
  | 'baseline' | 'tried' | 'tried_why' | 'validated'
  | 'deadline' | 'deadline_fixed' | 'weekly_hours' | 'days' | 'best_time' | 'session'
  | 'resources' | 'budget' | 'skill_gaps' | 'dependencies'
  | 'obstacles' | 'stall' | 'pressure'
  | 'encourage' | 'reward' | 'accountability';

export type Phase = 'goal' | 'motivation' | 'situation' | 'time' | 'resources' | 'risks' | 'style' | 'success';
export type AnswerStatus = 'answered' | 'skipped' | 'unknown';
export type AnswerSource = 'user' | 'app' | 'calendar';

export interface InterviewAnswer {
  slot: Slot;
  status: AnswerStatus;
  /** what the person picked or said, in their words */
  value?: string;
  /** chip values when the question allows several */
  picks?: string[];
  /** a number when the question asks for one (hours, amounts, …) */
  num?: number;
  source: AnswerSource;
  at: string;
}

export interface InterviewState {
  goal_title: string;
  category: GoalCategory;
  /** every answer ever given, in order — a changed answer is appended, never overwritten */
  answers: InterviewAnswer[];
  /** goal-specific options the AI suggested for a slot, kept so a resumed interview shows the same choices */
  ai_options?: Partial<Record<Slot, { question?: string; options: string[] }>>;
  /** slots the person asked to see even though enough is known */
  extra?: boolean;
}

export type Option = { value: string; label: string };
export interface Question {
  slot: Slot;
  phase: Phase;
  text: string;
  why?: string;
  options: Option[];
  multi?: boolean;
  /** 'number' shows a numeric keypad plus the options as quick picks */
  kind: 'choice' | 'number' | 'text';
  unit?: string;
  essential: boolean;
  followup?: boolean;
}

type Lang = 'ar' | 'en';
type QText = { text: string; why?: string; options?: [string, string][]; unit?: string };
type QDef = {
  phase: Phase;
  kind: Question['kind'];
  multi?: boolean;
  essential?: boolean;
  ar: QText;
  en: QText;
  byCat?: Partial<Record<GoalCategory, { ar: QText; en: QText }>>;
};

const o = (...p: [string, string][]) => p;

// ── the question bank ────────────────────────────────────────────────────
// Options are [value, label]; values are stable keys the planner understands, labels are what the person sees.
const Q: Record<Slot, QDef> = {
  outcome: {
    phase: 'goal', kind: 'choice', essential: true,
    ar: { text: 'ما الذي تريد تحقيقه بالضبط؟', why: 'كل خطوة في الخطة ستُبنى على هذه النتيجة، فالدقة هنا توفّر عليك وقتاً لاحقاً.' },
    en: { text: 'What exactly do you want to achieve?', why: 'Every step of the plan is built on this result, so being precise here saves time later.' },
    byCat: {
      education: {
        ar: { text: 'ما الشهادة أو المؤهل الذي تقصده بالتحديد؟', why: 'كل شهادة لها منهج ووزن واختبار مختلف، والخطة تُبنى على شهادتك أنت.', options: o(['CMA', 'CMA'], ['CPA', 'CPA'], ['ACCA', 'ACCA'], ['PMP', 'PMP'], ['IELTS', 'IELTS / TOEFL'], ['masters', 'ماجستير']) },
        en: { text: 'Which certification or qualification exactly?', why: 'Each certification has its own syllabus, weight and exam; the plan is built on yours.', options: o(['CMA', 'CMA'], ['CPA', 'CPA'], ['ACCA', 'ACCA'], ['PMP', 'PMP'], ['IELTS', 'IELTS / TOEFL'], ['masters', "Master's degree"]) },
      },
      financial: {
        ar: { text: 'ماذا يعني هذا الهدف المالي في حالتك؟', why: 'دخل شهري ثابت يحتاج خطة مختلفة تماماً عن ادخار مبلغ أو سداد دين.', options: o(['income', 'دخل شهري محدد'], ['savings', 'ادخار مبلغ محدد'], ['assets', 'أصول تدرّ دخلاً'], ['debt', 'سداد ديون'], ['independence', 'استقلال مالي كامل']) },
        en: { text: 'What does this financial goal mean in your situation?', why: 'A steady monthly income needs a very different plan from saving a sum or paying off debt.', options: o(['income', 'A specific monthly income'], ['savings', 'Save a specific amount'], ['assets', 'Income-generating assets'], ['debt', 'Pay off debt'], ['independence', 'Full financial independence']) },
      },
      business: {
        ar: { text: 'ما شكل المشروع الذي تقصده؟', options: o(['ecommerce', 'متجر إلكتروني'], ['service', 'خدمة أو استشارات'], ['app', 'تطبيق أو منصة'], ['local', 'مشروع محلي (محل، مطعم)'], ['grow', 'توسعة مشروع قائم']) },
        en: { text: 'What kind of business do you mean?', options: o(['ecommerce', 'Online store'], ['service', 'Service or consulting'], ['app', 'App or platform'], ['local', 'Local business (shop, restaurant)'], ['grow', 'Grow an existing business']) },
      },
      career: {
        ar: { text: 'ما النتيجة المهنية التي تريدها؟', options: o(['promotion', 'ترقية'], ['new_job', 'وظيفة جديدة'], ['switch', 'تغيير المجال'], ['raise', 'زيادة الراتب'], ['freelance', 'العمل الحر']) },
        en: { text: 'What career result do you want?', options: o(['promotion', 'A promotion'], ['new_job', 'A new job'], ['switch', 'Change field'], ['raise', 'A raise'], ['freelance', 'Go freelance']) },
      },
      fitness: {
        ar: { text: 'ما الذي تريده لجسمك وصحتك بالضبط؟', options: o(['lose', 'خسارة وزن محدد'], ['muscle', 'بناء عضلات'], ['endurance', 'لياقة أو جري مسافة'], ['health', 'صحة عامة وطاقة'], ['event', 'سباق أو بطولة']) },
        en: { text: 'What exactly do you want for your body and health?', options: o(['lose', 'Lose a set amount of weight'], ['muscle', 'Build muscle'], ['endurance', 'Endurance or a running distance'], ['health', 'General health and energy'], ['event', 'A race or competition']) },
      },
      personal: {
        ar: { text: 'ما التغيير الذي تريده في نفسك؟', options: o(['habit', 'بناء عادة جديدة'], ['quit', 'التخلص من عادة'], ['skill', 'مهارة شخصية'], ['confidence', 'ثقة وتواصل'], ['spiritual', 'جانب روحاني']) },
        en: { text: 'What change do you want in yourself?', options: o(['habit', 'Build a new habit'], ['quit', 'Break a habit'], ['skill', 'A personal skill'], ['confidence', 'Confidence and communication'], ['spiritual', 'Spiritual growth']) },
      },
      lifestyle: {
        ar: { text: 'ما الذي تريد تغييره في حياتك اليومية؟', options: o(['travel', 'سفر أو رحلة'], ['buy', 'شراء بيت أو سيارة'], ['organize', 'تنظيم حياتي'], ['family', 'وقت أكثر للعائلة'], ['hobby', 'هواية']) },
        en: { text: 'What do you want to change in your daily life?', options: o(['travel', 'Travel or a trip'], ['buy', 'Buy a home or car'], ['organize', 'Get organised'], ['family', 'More family time'], ['hobby', 'A hobby']) },
      },
    },
  },
  outcome_detail: {
    phase: 'goal', kind: 'text',
    ar: { text: 'صِف النتيجة بجملة واحدة أدق: ماذا سيكون مختلفاً بالضبط عندما تصل؟', why: 'الإجابة السابقة عامة قليلاً، وبدون نتيجة واضحة ستكون المهام عشوائية.' },
    en: { text: 'Describe the result more precisely in one sentence: what exactly will be different when you get there?', why: 'The last answer was a little general; without a clear result the tasks would be random.' },
  },
  success: {
    phase: 'success', kind: 'choice', essential: true,
    ar: { text: 'كيف سنعرف أن الهدف تحقق؟', why: 'نقيس التقدم من نتيجة حقيقية، لا من مرور الوقت.', options: o(['pass', 'اجتياز اختبار أو قبول رسمي'], ['number', 'رقم يصل إلى قيمة محددة'], ['deliver', 'تسليم أو إطلاق شيء محدد'], ['routine', 'الالتزام بعادة لمدة محددة']) },
    en: { text: 'How will we know the goal is achieved?', why: 'Progress is measured from a real result, not from time passing.', options: o(['pass', 'Passing an exam or an official acceptance'], ['number', 'A number reaching a set value'], ['deliver', 'Delivering or launching something specific'], ['routine', 'Keeping a habit for a set period']) },
    byCat: {
      education: {
        ar: { text: 'ما الذي يثبت أنك وصلت؟', options: o(['pass', 'اجتياز الاختبار النهائي'], ['score', 'الحصول على درجة محددة'], ['parts', 'اجتياز كل الأجزاء'], ['certificate', 'استلام الشهادة رسمياً']) },
        en: { text: 'What proves you made it?', options: o(['pass', 'Passing the final exam'], ['score', 'Getting a specific score'], ['parts', 'Passing every part'], ['certificate', 'Receiving the certificate']) },
      },
      business: {
        ar: { text: 'ما الذي يثبت أن المشروع نجح؟', options: o(['first_customers', 'أول عملاء يدفعون'], ['revenue', 'إيراد شهري محدد'], ['launch', 'إطلاق المنتج'], ['profit', 'الوصول إلى الربح']) },
        en: { text: 'What proves the business worked?', options: o(['first_customers', 'First paying customers'], ['revenue', 'A set monthly revenue'], ['launch', 'Launching the product'], ['profit', 'Reaching profit']) },
      },
    },
  },
  baseline_value: {
    phase: 'situation', kind: 'number', essential: true,
    ar: { text: 'أين أنت الآن بالأرقام؟', why: 'نقطة البداية الحقيقية هي ما يجعل الخطة واقعية.', unit: 'درهم' },
    en: { text: 'Where are you now, in numbers?', why: 'A real starting point is what makes the plan realistic.', unit: 'AED' },
    byCat: { fitness: { ar: { text: 'ما رقمك الحالي (الوزن أو المسافة أو غيره)؟', unit: 'كغ' }, en: { text: 'What is your current number (weight, distance, …)?', unit: 'kg' } } },
  },
  target_value: {
    phase: 'success', kind: 'number', essential: true,
    ar: { text: 'وما الرقم الذي تريد الوصول إليه؟', unit: 'درهم' },
    en: { text: 'And what number do you want to reach?', unit: 'AED' },
    byCat: { fitness: { ar: { text: 'وما الرقم الذي تريد الوصول إليه؟', unit: 'كغ' }, en: { text: 'And what number do you want to reach?', unit: 'kg' } } },
  },
  min_ideal: {
    phase: 'success', kind: 'choice',
    ar: { text: 'هل هناك حدّ أدنى ترضى به لو لم تصل إلى المثالي؟', options: o(['half', 'نصف الهدف مقبول'], ['most', 'أغلب الهدف (٧٥٪)'], ['all', 'لا، أريده كاملاً']) },
    en: { text: 'Is there a minimum you would accept if you miss the ideal?', options: o(['half', 'Half of it is fine'], ['most', 'Most of it (75%)'], ['all', 'No, I want all of it']) },
  },
  why: {
    phase: 'motivation', kind: 'choice', multi: true, essential: true,
    ar: { text: 'لماذا هذا الهدف مهم لك؟', why: 'السبب الحقيقي هو ما يبقيك مستمراً في الأيام الصعبة، وسنذكّرك به حين تحتاج.', options: o(['income', 'تحسين دخلي'], ['family', 'مستقبل أفضل لعائلتي'], ['self', 'أن أثبت لنفسي'], ['work', 'متطلب في عملي'], ['passion', 'أحب هذا المجال فعلاً'], ['should', 'أشعر أنه واجب عليّ']) },
    en: { text: 'Why does this goal matter to you?', why: 'The real reason is what keeps you going on hard days; we will remind you of it when you need it.', options: o(['income', 'Better income'], ['family', 'A better future for my family'], ['self', 'To prove it to myself'], ['work', 'My job requires it'], ['passion', 'I genuinely love this field'], ['should', 'I feel I should']) },
  },
  why_genuine: {
    phase: 'motivation', kind: 'choice',
    ar: { text: 'سؤال صريح: هل تريده أنت فعلاً، أم تشعر أن عليك أن تفعله؟', why: 'الهدف الذي نريده نحن يحتاج خطة مختلفة عن الهدف المفروض علينا — كلاهما مقبول.', options: o(['want', 'أريده فعلاً'], ['mixed', 'الاثنان معاً'], ['pressure', 'أشعر أنه مفروض عليّ']) },
    en: { text: 'Honest question: do you genuinely want it, or do you feel you have to?', why: 'A goal we want needs a different plan from one imposed on us — both are fine.', options: o(['want', 'I genuinely want it'], ['mixed', 'A bit of both'], ['pressure', 'It feels imposed']) },
  },
  meaning: {
    phase: 'motivation', kind: 'choice', multi: true,
    ar: { text: 'ما الذي سيتغيّر في حياتك عندما تصل؟', options: o(['money', 'وضع مالي أفضل'], ['freedom', 'حرية ووقت'], ['respect', 'تقدير واحترام'], ['peace', 'راحة بال'], ['opportunity', 'فرص جديدة']) },
    en: { text: 'What will change in your life when you get there?', options: o(['money', 'Better finances'], ['freedom', 'Freedom and time'], ['respect', 'Recognition'], ['peace', 'Peace of mind'], ['opportunity', 'New opportunities']) },
  },
  baseline: {
    phase: 'situation', kind: 'choice', essential: true,
    ar: { text: 'أين أنت الآن من هذا الهدف؟', why: 'من يبدأ من الصفر يحتاج مراحل تأسيس، ومن عنده أساس يبدأ مباشرة.', options: o(['zero', 'أبدأ من الصفر'], ['some', 'عندي أساس بسيط'], ['half', 'قطعت جزءاً جيداً'], ['close', 'قريب من النهاية']) },
    en: { text: 'Where are you now with this goal?', why: 'Starting from zero needs foundation stages; with a base you can start straight away.', options: o(['zero', 'Starting from zero'], ['some', 'I have some basics'], ['half', 'I am well into it'], ['close', 'Close to the end']) },
    byCat: {
      education: {
        ar: { text: 'ما مستواك الحالي في مادة هذه الشهادة؟', why: 'خلفيتك تحدد كم نحتاج من التأسيس قبل حل الأسئلة.', options: o(['zero', 'مبتدئ تماماً'], ['study', 'درستها في الجامعة'], ['work', 'أعمل في المجال'], ['tried', 'ذاكرتها سابقاً ولم أختبر'], ['part', 'اجتزت جزءاً منها']) },
        en: { text: 'What is your current level in this subject?', why: 'Your background decides how much foundation we need before practice questions.', options: o(['zero', 'Complete beginner'], ['study', 'Studied it at university'], ['work', 'I work in the field'], ['tried', 'Studied before, never sat the exam'], ['part', 'Passed part of it']) },
      },
      business: {
        ar: { text: 'إلى أين وصلت في المشروع؟', options: o(['idea', 'فكرة فقط'], ['research', 'بدأت أبحث'], ['product', 'عندي منتج أولي'], ['selling', 'أبيع فعلاً']) },
        en: { text: 'How far along is the business?', options: o(['idea', 'Just an idea'], ['research', 'Started researching'], ['product', 'I have a first version'], ['selling', 'Already selling']) },
      },
    },
  },
  tried: {
    phase: 'situation', kind: 'choice',
    ar: { text: 'هل حاولت الوصول لهذا الهدف من قبل؟', options: o(['first', 'لا، هذه أول مرة'], ['stopped', 'نعم وتوقفت'], ['partial', 'نعم ونجحت جزئياً']) },
    en: { text: 'Have you tried to reach this goal before?', options: o(['first', 'No, first time'], ['stopped', 'Yes, and I stopped'], ['partial', 'Yes, with partial success']) },
  },
  tried_why: {
    phase: 'risks', kind: 'choice', multi: true,
    ar: { text: 'ما الذي أوقفك في المرة السابقة؟', why: 'سنبني الخطة بحيث لا يتكرر نفس السبب.', options: o(['time', 'ضيق الوقت'], ['motivation', 'فقدت الحماس'], ['hard', 'كان أصعب مما توقعت'], ['life', 'ظروف طارئة'], ['plan', 'لم تكن عندي خطة']) },
    en: { text: 'What stopped you last time?', why: 'We will build the plan so the same thing does not stop you again.', options: o(['time', 'Not enough time'], ['motivation', 'Lost motivation'], ['hard', 'Harder than expected'], ['life', 'Life got in the way'], ['plan', 'I had no plan']) },
  },
  validated: {
    phase: 'situation', kind: 'choice', essential: true,
    ar: { text: 'هل تأكدت أن هناك من يدفع مقابل ما ستقدمه؟', why: 'لو لم يُختبر السوق بعد، فاختباره يأتي قبل بناء المنتج أو صرف المال على التسويق.', options: o(['no', 'لا، ليس بعد'], ['talked', 'تحدثت مع بعض العملاء المحتملين'], ['paying', 'عندي عملاء يدفعون']) },
    en: { text: 'Have you confirmed people will pay for what you offer?', why: 'If the market is untested, testing it comes before building the product or spending on marketing.', options: o(['no', 'Not yet'], ['talked', 'Talked to a few potential customers'], ['paying', 'I have paying customers']) },
  },
  deadline: {
    phase: 'time', kind: 'choice', essential: true,
    ar: { text: 'متى تريد أن تصل؟', options: o(['30', 'خلال شهر'], ['90', 'خلال ٣ أشهر'], ['180', 'خلال ٦ أشهر'], ['365', 'خلال سنة'], ['730', 'خلال سنتين']) },
    en: { text: 'When do you want to get there?', options: o(['30', 'Within a month'], ['90', 'Within 3 months'], ['180', 'Within 6 months'], ['365', 'Within a year'], ['730', 'Within two years']) },
  },
  deadline_fixed: {
    phase: 'time', kind: 'choice',
    ar: { text: 'هل هذا الموعد ثابت أم مرن؟', why: 'الموعد الثابت (اختبار محجوز مثلاً) يُخطط له بهامش أمان، والمرن يمكن تحريكه إن لزم.', options: o(['fixed', 'ثابت (اختبار أو موعد خارجي)'], ['soft', 'مرن، أنا من حدّده']) },
    en: { text: 'Is that date fixed or flexible?', why: 'A fixed date (a booked exam, say) is planned with a safety margin; a flexible one can move if needed.', options: o(['fixed', 'Fixed (exam or outside date)'], ['soft', 'Flexible, I chose it']) },
  },
  weekly_hours: {
    phase: 'time', kind: 'number', essential: true,
    ar: { text: 'كم ساعة في الأسبوع تستطيع أن تعطي هذا الهدف بواقعية — دون أن تؤثر على التزاماتك الأخرى؟', why: 'لن نضع جدولاً يفترض وقتاً ليس عندك.', unit: 'ساعة', options: o(['2', '٢'], ['4', '٤'], ['6', '٦'], ['8', '٨'], ['10', '١٠'], ['15', '١٥']) },
    en: { text: 'How many hours a week can you realistically give this goal without hurting your other commitments?', why: 'We will not build a schedule that assumes time you do not have.', unit: 'hours', options: o(['2', '2'], ['4', '4'], ['6', '6'], ['8', '8'], ['10', '10'], ['15', '15']) },
  },
  days: {
    phase: 'time', kind: 'choice', multi: true,
    ar: { text: 'أي أيام الأسبوع تناسبك للعمل على الهدف؟', options: o(['0', 'الأحد'], ['1', 'الاثنين'], ['2', 'الثلاثاء'], ['3', 'الأربعاء'], ['4', 'الخميس'], ['5', 'الجمعة'], ['6', 'السبت']) },
    en: { text: 'Which days of the week suit you for this goal?', options: o(['0', 'Sun'], ['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat']) },
  },
  best_time: {
    phase: 'style', kind: 'choice',
    ar: { text: 'متى تكون طاقتك وتركيزك في أعلى مستوى؟', options: o(['dawn', 'الفجر'], ['morning', 'الصباح'], ['noon', 'الظهر'], ['evening', 'المساء'], ['night', 'الليل']) },
    en: { text: 'When are your energy and focus highest?', options: o(['dawn', 'Dawn'], ['morning', 'Morning'], ['noon', 'Midday'], ['evening', 'Evening'], ['night', 'Night']) },
  },
  session: {
    phase: 'style', kind: 'choice',
    ar: { text: 'كم تحب أن تكون مدة جلسة العمل الواحدة؟', why: 'نقسّم المهام على مقاس جلساتك، فلا نضع مهمة معقدة في ربع ساعة.', options: o(['25', '٢٥ دقيقة'], ['50', '٥٠ دقيقة'], ['90', 'ساعة ونصف'], ['120', 'ساعتان أو أكثر']) },
    en: { text: 'How long do you like one work session to be?', why: 'Tasks are sized to your sessions, so a complex task is not squeezed into 15 minutes.', options: o(['25', '25 min'], ['50', '50 min'], ['90', '90 min'], ['120', '2 hours or more']) },
  },
  resources: {
    phase: 'resources', kind: 'choice', multi: true,
    ar: { text: 'ما الموارد المتوفرة لديك الآن؟', options: o(['books', 'كتب أو مراجع'], ['course', 'دورة أو منهج'], ['mentor', 'مدرب أو مرشد'], ['tools', 'الأدوات اللازمة'], ['none', 'لا شيء بعد']) },
    en: { text: 'What resources do you have right now?', options: o(['books', 'Books or references'], ['course', 'A course or syllabus'], ['mentor', 'A coach or mentor'], ['tools', 'The tools needed'], ['none', 'Nothing yet']) },
    byCat: {
      education: {
        ar: { text: 'ما الذي عندك من مواد التحضير؟', options: o(['official', 'المنهج الرسمي'], ['qbank', 'بنك أسئلة'], ['course', 'دورة تحضيرية'], ['tutor', 'مدرّس'], ['none', 'لا شيء بعد']) },
        en: { text: 'What preparation material do you have?', options: o(['official', 'Official syllabus'], ['qbank', 'A question bank'], ['course', 'A prep course'], ['tutor', 'A tutor'], ['none', 'Nothing yet']) },
      },
    },
  },
  budget: {
    phase: 'resources', kind: 'choice',
    ar: { text: 'هل عندك ميزانية لهذا الهدف؟', options: o(['none', 'لا'], ['small', 'قليلة'], ['medium', 'متوسطة'], ['enough', 'كافية']) },
    en: { text: 'Do you have a budget for this goal?', options: o(['none', 'No'], ['small', 'Small'], ['medium', 'Moderate'], ['enough', 'Enough']) },
  },
  skill_gaps: {
    phase: 'resources', kind: 'choice', multi: true,
    ar: { text: 'ما الأجزاء الجديدة عليك أو الصعبة؟', options: o(['theory', 'الجانب النظري'], ['practice', 'التطبيق العملي'], ['language', 'اللغة'], ['tech', 'الجانب التقني'], ['sales', 'البيع والتسويق'], ['unknown', 'لا أعرف بعد']) },
    en: { text: 'Which parts are new or hard for you?', options: o(['theory', 'The theory'], ['practice', 'Practical application'], ['language', 'The language'], ['tech', 'The technical side'], ['sales', 'Sales and marketing'], ['unknown', 'I do not know yet']) },
  },
  dependencies: {
    phase: 'resources', kind: 'choice', multi: true,
    ar: { text: 'هل يعتمد تقدمك على أشخاص أو جهات أخرى؟', options: o(['none', 'لا'], ['partner', 'شريك'], ['employer', 'جهة العمل'], ['authority', 'جهة رسمية أو ترخيص'], ['family', 'العائلة']) },
    en: { text: 'Does your progress depend on other people or bodies?', options: o(['none', 'No'], ['partner', 'A partner'], ['employer', 'My employer'], ['authority', 'An authority or licence'], ['family', 'Family']) },
  },
  obstacles: {
    phase: 'risks', kind: 'choice', multi: true,
    ar: { text: 'ما أكبر عائق يمكن أن يوقفك؟', why: 'كل عائق سنضع له خطة وقاية وخطة عودة.', options: o(['time', 'ضيق الوقت'], ['procrastination', 'التسويف'], ['motivation', 'فقدان الحماس'], ['work', 'ضغط العمل'], ['family', 'ظروف عائلية'], ['money', 'المال'], ['start', 'لا أعرف من أين أبدأ']) },
    en: { text: 'What is the biggest thing that could stop you?', why: 'Every obstacle gets a prevention plan and a way back.', options: o(['time', 'Lack of time'], ['procrastination', 'Procrastination'], ['motivation', 'Losing motivation'], ['work', 'Work pressure'], ['family', 'Family circumstances'], ['money', 'Money'], ['start', 'Not knowing where to start']) },
  },
  stall: {
    phase: 'risks', kind: 'choice',
    ar: { text: 'أين تتعثر عادةً؟', options: o(['start', 'في البداية'], ['consistency', 'في الاستمرار'], ['finish', 'في الإنهاء']) },
    en: { text: 'Where do you usually get stuck?', options: o(['start', 'Starting'], ['consistency', 'Staying consistent'], ['finish', 'Finishing']) },
  },
  pressure: {
    phase: 'style', kind: 'choice',
    ar: { text: 'المواعيد النهائية: تحفّزك أم تضغطك؟', options: o(['motivates', 'تحفّزني'], ['pressures', 'تضغطني'], ['depends', 'حسب الموقف']) },
    en: { text: 'Deadlines: do they motivate you or stress you?', options: o(['motivates', 'Motivate me'], ['pressures', 'Stress me'], ['depends', 'Depends']) },
  },
  encourage: {
    phase: 'motivation', kind: 'choice', multi: true,
    ar: { text: 'ما الذي يساعدك على الاستمرار؟', options: o(['small_wins', 'انتصارات يومية صغيرة'], ['milestones', 'محطات كبيرة'], ['progress', 'رؤية التقدم'], ['reason', 'تذكيري بالسبب'], ['streaks', 'سلاسل الأيام']) },
    en: { text: 'What helps you keep going?', options: o(['small_wins', 'Small daily wins'], ['milestones', 'Big milestones'], ['progress', 'Seeing progress'], ['reason', 'Being reminded of why'], ['streaks', 'Streaks']) },
  },
  reward: {
    phase: 'motivation', kind: 'choice',
    ar: { text: 'بماذا تحب أن تكافئ نفسك عند كل محطة؟', why: 'المكافأة من اختيارك أنت، ولن نفرض شيئاً.', options: o(['dinner', 'عشاء مميز'], ['trip', 'رحلة قصيرة'], ['buy', 'شراء شيء أحبه'], ['rest', 'يوم راحة'], ['none', 'بدون مكافأة']) },
    en: { text: 'How would you like to reward yourself at each milestone?', why: 'You choose the reward; nothing is imposed.', options: o(['dinner', 'A special dinner'], ['trip', 'A short trip'], ['buy', 'Buy something I like'], ['rest', 'A day off'], ['none', 'No reward']) },
  },
  accountability: {
    phase: 'style', kind: 'choice',
    ar: { text: 'كيف تحب أن نتابع معك؟', options: o(['none', 'بدون تذكيرات'], ['gentle', 'تذكير لطيف'], ['daily', 'متابعة يومية'], ['weekly', 'مراجعة أسبوعية'], ['milestone', 'عند كل محطة']) },
    en: { text: 'How would you like us to follow up?', options: o(['none', 'No reminders'], ['gentle', 'Gentle reminders'], ['daily', 'Daily check-ins'], ['weekly', 'Weekly reviews'], ['milestone', 'At each milestone']) },
  },
};

// ── interview paths per category ─────────────────────────────────────────
// Essentials first (in the order of the discovery workflow), optional questions after. Not every goal gets
// every question: a fitness goal is never asked about market validation, a business goal is.
const PATHS: Record<GoalCategory, Slot[]> = {
  education: ['outcome', 'success', 'why', 'baseline', 'tried', 'deadline', 'deadline_fixed', 'weekly_hours', 'days', 'best_time', 'session', 'resources', 'skill_gaps', 'obstacles', 'stall', 'encourage', 'reward', 'accountability'],
  financial: ['outcome', 'baseline_value', 'target_value', 'why', 'tried', 'deadline', 'deadline_fixed', 'weekly_hours', 'budget', 'resources', 'obstacles', 'min_ideal', 'stall', 'encourage', 'reward', 'accountability'],
  business: ['outcome', 'success', 'why', 'baseline', 'validated', 'deadline', 'weekly_hours', 'budget', 'resources', 'skill_gaps', 'dependencies', 'obstacles', 'days', 'best_time', 'session', 'stall', 'reward', 'accountability'],
  career: ['outcome', 'success', 'why', 'baseline', 'tried', 'deadline', 'weekly_hours', 'skill_gaps', 'resources', 'dependencies', 'obstacles', 'days', 'best_time', 'session', 'stall', 'reward', 'accountability'],
  fitness: ['outcome', 'baseline_value', 'target_value', 'why', 'tried', 'deadline', 'weekly_hours', 'days', 'best_time', 'session', 'resources', 'obstacles', 'stall', 'encourage', 'reward', 'accountability'],
  personal: ['outcome', 'success', 'why', 'meaning', 'baseline', 'tried', 'deadline', 'weekly_hours', 'days', 'best_time', 'obstacles', 'stall', 'encourage', 'reward', 'accountability'],
  lifestyle: ['outcome', 'success', 'why', 'baseline', 'deadline', 'weekly_hours', 'budget', 'resources', 'obstacles', 'days', 'reward', 'accountability'],
};

/** Follow-ups that open only when an earlier answer calls for them; asked right after their trigger. */
const FOLLOWUPS: { slot: Slot; after: Slot; when: (s: InterviewState) => boolean }[] = [
  { slot: 'outcome_detail', after: 'outcome', when: (s) => isVague(latest(s, 'outcome')) },
  { slot: 'why_genuine', after: 'why', when: (s) => !!latest(s, 'why')?.picks?.includes('should') },
  { slot: 'tried_why', after: 'tried', when: (s) => latest(s, 'tried')?.value === 'stopped' },
];

// Once these are known the plan can be built; the rest refine it.
const MIN_QUESTIONS_BEFORE_OFFER = 6;

// ── helpers ──────────────────────────────────────────────────────────────
export const latest = (s: InterviewState, slot: Slot): InterviewAnswer | undefined => {
  for (let i = s.answers.length - 1; i >= 0; i--) if (s.answers[i].slot === slot) return s.answers[i];
  return undefined;
};

const VAGUE = /^(?:أكثر|أفضل|كثير|شوي|شيء|اي شي|أي شيء|كل شي|كل شيء|نجاح|تحسين|تطوير|more|better|success|improve|something|anything|everything|stuff)$/i;
/** A free-text answer too short or too generic to plan on. Chip answers are never vague. */
export function isVague(a?: InterviewAnswer) {
  if (!a || a.status !== 'answered' || a.source !== 'user') return false;
  if (a.picks?.length || a.num != null) return false;
  const v = (a.value ?? '').trim();
  if (!v) return true;
  if (VAGUE.test(v)) return true;
  // a known option value (e.g. 'CMA', 'income') is specific; a two-word free answer is not
  if (/^[A-Za-z0-9_]+$/.test(v)) return false;
  return v.split(/\s+/).length < 3;
}

const CAT_WORDS: [GoalCategory, RegExp][] = [
  ['education', /شهاد|اختبار|امتحان|دراس|جامع|ماجستير|دكتور|cma|cpa|acca|pmp|ielts|toefl|certif|exam|degree|course|study|learn|تعلم|لغة/i],
  ['financial', /مال|مليون|دخل|ادخار|توفير|دين|ثرو|استثمار|درهم|دولار|money|income|sav|debt|invest|wealth|financ|million/i],
  ['business', /مشروع|شرك|متجر|بزنس|عملاء|منتج|business|startup|company|store|shop|product|customers/i],
  ['career', /وظيف|ترقي|راتب|عمل حر|مسار مهني|job|promotion|career|salary|freelanc/i],
  ['fitness', /وزن|كيلو|رياض|لياق|جري|عضل|صح|ماراثون|weight|kg|fit|gym|run|muscle|health|marathon/i],
  ['lifestyle', /سفر|رحل|بيت|سيار|عائل|هواي|travel|trip|house|home|car|family|hobby/i],
];
/** First guess of the goal's category from its title. The person can change it at the top of the interview. */
export function classifyGoal(title: string): GoalCategory {
  for (const [cat, re] of CAT_WORDS) if (re.test(title)) return cat;
  return 'personal';
}

const NUM_WORDS: Record<string, number> = { 'واحد': 1, 'شهر': 1, 'شهرين': 2, 'اثنين': 2, 'ثلاث': 3, 'ثلاثة': 3, 'أربع': 4, 'اربع': 4, 'أربعة': 4, 'خمس': 5, 'خمسة': 5, 'ست': 6, 'ستة': 6, 'سبع': 7, 'ثمان': 8, 'تسع': 9, 'عشر': 10, 'عشرة': 10, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'twelve': 12 };
const toNum = (w: string) => (/^\d+$/.test(w) ? Number(w) : NUM_WORDS[w.toLowerCase()]);
/** "within six months" / "خلال ستة أشهر" / "in 2 years" → days. Undefined when the title names no horizon. */
export function detectHorizonDays(title: string): number | undefined {
  const t = title.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (/(?:خلال|في)\s+(?:سنة|عام)(?!\s*\d)|within\s+a\s+year|in\s+a\s+year/i.test(t)) return 365;
  if (/(?:خلال|في)\s+شهرين/.test(t)) return 60;
  if (/(?:خلال|في)\s+شهر(?!\s*\d)|within\s+a\s+month/i.test(t)) return 30;
  if (/(?:خلال|في)\s+سنتين|within\s+two\s+years/i.test(t)) return 730;
  const m = t.match(/(?:خلال|في|بعد|within|in)\s+(\S+)\s+(أشهر|اشهر|شهور|شهر|سنوات|سنين|أسابيع|اسابيع|months?|years?|weeks?)/i);
  if (!m) return undefined;
  const n = toNum(m[1]);
  if (!n) return undefined;
  const u = m[2].toLowerCase();
  if (/^(?:أسابيع|اسابيع|weeks?)$/.test(u)) return n * 7;
  if (/^(?:سنوات|سنين|years?)$/.test(u)) return n * 365;
  return n * 30;
}

/** What the app already knows, so the interview never asks it again. */
export type Known = { horizonDays?: number; weeklyHours?: number; bestTime?: string; days?: number[] };

export function startInterview(title: string, nowIso: string, known: Known = {}, category = classifyGoal(title)): InterviewState {
  const s: InterviewState = { goal_title: title.trim(), category, answers: [] };
  const horizon = known.horizonDays ?? detectHorizonDays(title);
  if (horizon) s.answers.push({ slot: 'deadline', status: 'answered', value: String(horizon), num: horizon, source: 'app', at: nowIso });
  if (known.weeklyHours) s.answers.push({ slot: 'weekly_hours', status: 'answered', value: String(known.weeklyHours), num: known.weeklyHours, source: 'app', at: nowIso });
  if (known.days?.length) s.answers.push({ slot: 'days', status: 'answered', picks: known.days.map(String), source: 'app', at: nowIso });
  return s;
}

/** Records an answer by appending it. Earlier answers stay in the history. */
export function answer(s: InterviewState, a: Omit<InterviewAnswer, 'at' | 'source'> & { source?: AnswerSource }, nowIso: string): InterviewState {
  return { ...s, answers: [...s.answers, { source: 'user', ...a, at: nowIso }] };
}

/** The ordered list of slots for this interview, with follow-ups slotted in where they apply. */
export function plannedSlots(s: InterviewState): Slot[] {
  const out: Slot[] = [];
  for (const slot of PATHS[s.category]) {
    out.push(slot);
    for (const f of FOLLOWUPS) if (f.after === slot && f.when(s)) out.push(f.slot);
  }
  return out;
}

/** Builds the question for a slot in the person's language, preferring the category wording and AI options. */
export function questionFor(slot: Slot, s: InterviewState, lang: Lang): Question {
  const d = Q[slot];
  const base = d[lang];
  const cat = d.byCat?.[s.category]?.[lang];
  const ai = s.ai_options?.[slot];
  const opts = (cat?.options ?? base.options ?? []).map(([value, label]) => ({ value, label }));
  const aiOpts = ai?.options?.map((x) => ({ value: x, label: x })) ?? [];
  // AI options are goal-specific (e.g. the actual sections of the named certificate); the static ones stay as a fallback
  const options = aiOpts.length ? [...aiOpts.slice(0, 6), ...opts.filter((x) => !aiOpts.some((y) => y.label === x.label))] : opts;
  return {
    slot, phase: d.phase, kind: d.kind, multi: d.multi, essential: !!d.essential,
    text: ai?.question || cat?.text || base.text,
    why: cat?.why ?? base.why,
    unit: cat?.unit ?? base.unit,
    options,
    followup: FOLLOWUPS.some((f) => f.slot === slot),
  };
}

/**
 * The next question to ask, or null when the interview should stop and offer the plan.
 * Asks essentials first; once they are settled and a handful of questions has been answered, optional
 * questions are offered only if the person asked for more (`extra`) — the interview should not drag on.
 */
export function nextQuestion(s: InterviewState, lang: Lang): Question | null {
  const slots = plannedSlots(s);
  const open = slots.filter((slot) => !latest(s, slot));
  if (!open.length) return null;
  const essentialOpen = open.filter((slot) => Q[slot].essential || FOLLOWUPS.some((f) => f.slot === slot));
  if (essentialOpen.length) {
    // keep the workflow order: an optional question that comes earlier in the path is still asked in turn
    const firstEss = slots.indexOf(essentialOpen[0]);
    const earlier = open.find((slot) => slots.indexOf(slot) < firstEss);
    return questionFor(earlier ?? essentialOpen[0], s, lang);
  }
  const asked = s.answers.filter((a) => a.source === 'user').length;
  if (!s.extra && asked >= MIN_QUESTIONS_BEFORE_OFFER) return null;
  return questionFor(open[0], s, lang);
}

/** How far through the planned questions the person is (for a quiet progress line, not a judgement). */
export function interviewProgress(s: InterviewState) {
  const slots = plannedSlots(s);
  const done = slots.filter((slot) => latest(s, slot)).length;
  return { done, total: slots.length };
}

// ── readiness gate ──────────────────────────────────────────────────────
export type ReadinessField = 'goal_clarity' | 'outcome_definition' | 'deadline_clarity' | 'time_capacity' | 'current_baseline' | 'resources' | 'motivation' | 'obstacles' | 'success_criteria';
const FIELD_SLOTS: Record<ReadinessField, Slot[]> = {
  goal_clarity: ['outcome', 'outcome_detail'],
  outcome_definition: ['success', 'target_value'],
  deadline_clarity: ['deadline'],
  time_capacity: ['weekly_hours'],
  current_baseline: ['baseline', 'baseline_value', 'validated'],
  resources: ['resources', 'budget'],
  motivation: ['why'],
  obstacles: ['obstacles', 'tried_why'],
  success_criteria: ['success', 'target_value', 'min_ideal'],
};
const ESSENTIAL_FIELDS: ReadinessField[] = ['goal_clarity', 'outcome_definition', 'deadline_clarity', 'time_capacity', 'current_baseline'];

export interface Readiness {
  fields: Partial<Record<ReadinessField, number>>;
  overall: number;
  missing: { field: ReadinessField; slot: Slot; essential: boolean }[];
  uncertain: Slot[];
  canGenerate: boolean;
}

const scoreOf = (s: InterviewState, slot: Slot) => {
  const a = latest(s, slot);
  if (!a || a.status === 'skipped') return 0;
  if (a.status === 'unknown') return 40;
  if (slot === 'outcome' && latest(s, 'outcome_detail')?.status === 'answered') return 100;
  return isVague(a) ? 60 : 100;
};

/**
 * Field-level completeness for this goal. Fields whose questions are not on this goal's path are left out
 * rather than counted against it. "I don't know" is recorded uncertainty (40), not a blank.
 */
export function readiness(s: InterviewState): Readiness {
  const path = new Set(plannedSlots(s));
  const fields: Readiness['fields'] = {};
  const missing: Readiness['missing'] = [];
  for (const f of Object.keys(FIELD_SLOTS) as ReadinessField[]) {
    const slots = FIELD_SLOTS[f].filter((x) => path.has(x));
    if (!slots.length) continue;
    const score = Math.max(...slots.map((x) => scoreOf(s, x)));
    fields[f] = score;
    if (score < 40) missing.push({ field: f, slot: slots[0], essential: ESSENTIAL_FIELDS.includes(f) });
  }
  const vals = Object.values(fields) as number[];
  const overall = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  const uncertain = s.answers.filter((a) => a.status === 'unknown' && latest(s, a.slot) === a).map((a) => a.slot);
  return { fields, overall, missing, uncertain, canGenerate: !missing.some((m) => m.essential) };
}

// ── capacity ─────────────────────────────────────────────────────────────
export const TIME_WINDOWS: Record<string, { start: string; end: string }> = {
  dawn: { start: '04:30', end: '07:30' },
  morning: { start: '07:00', end: '12:00' },
  noon: { start: '12:00', end: '16:00' },
  evening: { start: '16:00', end: '21:00' },
  night: { start: '20:00', end: '23:30' },
};

export interface Capacity {
  /** what the person said, in minutes per week (undefined if they did not know) */
  statedMinutes?: number;
  /** free minutes the calendar shows inside their preferred window, per week (undefined without calendar) */
  calendarMinutes?: number;
  /** what the plan will actually use */
  usableMinutes: number;
  limitedBy: 'stated' | 'calendar' | 'default';
  calendar: 'read' | 'none' | 'failed';
}

/** Realistic weekly time: the smaller of what the person said and what their calendar leaves free. */
export function weeklyCapacity(statedHours: number | undefined, calendarFreeMinutes: number | undefined, calendar: Capacity['calendar']): Capacity {
  const stated = statedHours && statedHours > 0 ? Math.round(statedHours * 60) : undefined;
  const cal = calendar === 'read' && calendarFreeMinutes != null ? Math.max(0, Math.round(calendarFreeMinutes)) : undefined;
  if (stated != null && cal != null) return cal < stated ? { statedMinutes: stated, calendarMinutes: cal, usableMinutes: cal, limitedBy: 'calendar', calendar } : { statedMinutes: stated, calendarMinutes: cal, usableMinutes: stated, limitedBy: 'stated', calendar };
  if (stated != null) return { statedMinutes: stated, usableMinutes: stated, limitedBy: 'stated', calendar };
  // unknown hours: a cautious three hours a week, capped by the calendar, and said so in the plan's assumptions
  const dflt = 180;
  if (cal != null) return { calendarMinutes: cal, usableMinutes: Math.min(dflt, cal), limitedBy: cal < dflt ? 'calendar' : 'default', calendar };
  return { usableMinutes: dflt, limitedBy: 'default', calendar };
}

// ── the brief handed to the planner ──────────────────────────────────────
export interface GoalMotivationProfile { reasons: string[]; genuine?: string; meaning: string[]; stall?: string; encouragement: string[]; deadline_pressure?: string; reward?: string }
export interface GoalTimeCapacity { horizon_days?: number; deadline_fixed?: boolean; weekly_minutes: number; stated_minutes?: number; calendar_minutes?: number; limited_by: Capacity['limitedBy']; calendar: Capacity['calendar']; days: number[] }
export interface GoalExecutionPreferences { best_time?: string; window?: { start: string; end: string }; session_minutes: number; accountability?: string }
export interface GoalBrief {
  title: string;
  category: GoalCategory;
  outcome?: string;
  outcome_detail?: string;
  success?: string;
  baseline?: string;
  baseline_value?: number;
  target_value?: number;
  unit?: string;
  min_ideal?: string;
  tried?: string;
  tried_why: string[];
  validated?: string;
  resources: string[];
  budget?: string;
  skill_gaps: string[];
  dependencies: string[];
  obstacles: string[];
  motivation: GoalMotivationProfile;
  time: GoalTimeCapacity;
  execution: GoalExecutionPreferences;
  unknown: Slot[];
  skipped: Slot[];
}

/** Labels instead of option keys, so the planner and the preview read the person's own words. */
function labelled(s: InterviewState, slot: Slot, lang: Lang): string[] {
  const a = latest(s, slot);
  if (!a || a.status !== 'answered') return [];
  const q = questionFor(slot, s, lang);
  const lab = (v: string) => q.options.find((x) => x.value === v)?.label ?? v;
  if (a.picks?.length) return [...a.picks.map(lab), ...(a.value ? [a.value] : [])];
  return a.value ? [lab(a.value)] : a.num != null ? [String(a.num)] : [];
}
const one = (s: InterviewState, slot: Slot, lang: Lang) => labelled(s, slot, lang).join('، ') || undefined;
const key = (s: InterviewState, slot: Slot) => { const a = latest(s, slot); return a?.status === 'answered' ? a.value : undefined; };

export function buildBrief(s: InterviewState, cap: Capacity, lang: Lang): GoalBrief {
  const days = (latest(s, 'days')?.picks ?? []).map(Number).filter((d) => d >= 0 && d <= 6);
  const best = key(s, 'best_time');
  const session = Number(key(s, 'session')) || 50;
  const horizon = latest(s, 'deadline');
  const unit = questionFor('target_value', s, lang).unit;
  const n = (slot: Slot) => { const a = latest(s, slot); return a?.status === 'answered' && a.num != null ? a.num : undefined; };
  return {
    title: s.goal_title,
    category: s.category,
    outcome: one(s, 'outcome', lang),
    outcome_detail: one(s, 'outcome_detail', lang),
    success: one(s, 'success', lang),
    baseline: one(s, 'baseline', lang),
    baseline_value: n('baseline_value'),
    target_value: n('target_value'),
    unit: n('target_value') != null ? unit : undefined,
    min_ideal: one(s, 'min_ideal', lang),
    tried: one(s, 'tried', lang),
    tried_why: labelled(s, 'tried_why', lang),
    validated: key(s, 'validated'),
    resources: labelled(s, 'resources', lang),
    budget: one(s, 'budget', lang),
    skill_gaps: labelled(s, 'skill_gaps', lang),
    dependencies: labelled(s, 'dependencies', lang),
    obstacles: labelled(s, 'obstacles', lang),
    motivation: {
      reasons: labelled(s, 'why', lang),
      genuine: key(s, 'why_genuine'),
      meaning: labelled(s, 'meaning', lang),
      stall: key(s, 'stall'),
      encouragement: labelled(s, 'encourage', lang),
      deadline_pressure: key(s, 'pressure'),
      reward: key(s, 'reward') === 'none' ? undefined : one(s, 'reward', lang),
    },
    time: {
      horizon_days: horizon?.status === 'answered' ? horizon.num ?? (Number(horizon.value) || undefined) : undefined,
      deadline_fixed: key(s, 'deadline_fixed') === 'fixed',
      weekly_minutes: cap.usableMinutes,
      stated_minutes: cap.statedMinutes,
      calendar_minutes: cap.calendarMinutes,
      limited_by: cap.limitedBy,
      calendar: cap.calendar,
      days: days.length ? days : [0, 1, 2, 3, 4, 6],
    },
    execution: { best_time: best, window: best ? TIME_WINDOWS[best] : undefined, session_minutes: session, accountability: key(s, 'accountability') },
    unknown: [...new Set(s.answers.filter((a) => a.status === 'unknown' && latest(s, a.slot) === a).map((a) => a.slot))],
    skipped: [...new Set(s.answers.filter((a) => a.status === 'skipped' && latest(s, a.slot) === a).map((a) => a.slot))],
  };
}
