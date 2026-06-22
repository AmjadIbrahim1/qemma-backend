// backend/src/modules/auth/subject-stream.map.js
// ✅ NEW: canonical subject → stream mapping for TEACHERS only (per user decision).
// Students pick their stream manually (Literary/Science-Maths/Science-Biology); teachers do NOT
// choose a stream — it is derived automatically from the subject they select (planning_prompts task).
//
// Stream values (5): Literary, Science-Maths, Science-Biology (shared with Student.stream & Contest.stream
// so the notification join `teacher.stream = contest.stream` works) + general, science (teacher-only).
// NOTE: the 2 extra values (general, science) extend planning_prompts' 3-value stream definition.

// Allowed Teacher.stream values (must match the DB CHECK constraint + auth.validator.js).
export const TEACHER_STREAMS = [
  'Literary',
  'Science-Maths',
  'Science-Biology',
  'general',
  'science',
];

// Subject (Arabic, canonical registration form values) → Teacher.stream
const SUBJECT_TO_STREAM = {
  'اللغة العربية':   'general',
  'اللغة الإنجليزية': 'general',
  'الجغرافيا':        'Literary',
  'التاريخ':          'Literary',
  'الرياضيات':        'Science-Maths',
  'الإحصاء':          'Science-Maths',
  'الأحياء':          'Science-Biology',
  'الفيزياء':         'science',
  'الكيمياء':         'science',
};

// ✅ Derive a teacher's stream from their selected subject.
// Accepts a single subject string OR an array (uses the first mappable subject).
// Returns null if no subject maps to a stream (caller should then leave stream null).
export const getStreamFromSubject = (subject) => {
  if (!subject) return null;
  const subjects = Array.isArray(subject) ? subject : [subject];
  for (const s of subjects) {
    if (s && SUBJECT_TO_STREAM[s]) return SUBJECT_TO_STREAM[s];
  }
  return null;
};

// ✅ NEW (contests feature): teacher stream → allowed contest streams mapping.
// Per task spec:
//   - general  → ALL contest streams (Literary, Science-Maths, Science-Biology)
//   - science  → Science-Maths + Science-Biology
//   - the remaining 3 teacher streams map 1-to-1 to their same-named contest stream.
// Contest streams (per planning_prompts): Literary, Science-Maths, Science-Biology (3 values).
// Teacher streams (5): the 3 above + general + science.
const CONTEST_STREAMS = ['Literary', 'Science-Maths', 'Science-Biology'];

const TEACHER_STREAM_TO_CONTEST_STREAMS = {
  'general':         ['Literary', 'Science-Maths', 'Science-Biology'],   // general → ALL
  'science':         ['Science-Maths', 'Science-Biology'],               // science → both science streams
  'Literary':        ['Literary'],                                        // 1-to-1
  'Science-Maths':   ['Science-Maths'],                                  // 1-to-1
  'Science-Biology': ['Science-Biology'],                                // 1-to-1
};

// ✅ Returns the list of contest streams a teacher with the given stream is allowed to add questions to.
// Returns [] for unknown/null streams (caller should deny).
export const getAllowedContestStreams = (teacherStream) => {
  if (!teacherStream) return [];
  return TEACHER_STREAM_TO_CONTEST_STREAMS[teacherStream] || [];
};

// ✅ Checks whether a teacher with the given stream may add questions to a contest of the given stream.
export const canTeacherAddToContest = (teacherStream, contestStream) => {
  return getAllowedContestStreams(teacherStream).includes(contestStream);
};

export { CONTEST_STREAMS, TEACHER_STREAM_TO_CONTEST_STREAMS };

export default SUBJECT_TO_STREAM;
