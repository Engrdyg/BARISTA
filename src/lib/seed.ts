import seed from '../seed/bar2027.json';
import { db } from './db';
import { getUserId, stableId } from './identity';
import { installBank } from './bank';
import { makeRow, putRows } from './repo';
import type { ExamConfig, SettingsData, SettingsRow, Subject } from './types';

export const SEED = seed;

export function defaultSettings(): SettingsData {
  const d = seed.defaults;
  return {
    greetingName: '',
    leafScores: d.leafScores as SettingsData['leafScores'],
    desiredRetention: d.desiredRetention,
    newCardsPerDay: d.newCardsPerDay,
    maxReviewsPerDay: d.maxReviewsPerDay,
    minutesPerProblem: d.minutesPerProblem,
    dailyCapHours: d.dailyCapHours,
    neglectDays: d.neglectDays,
    pomodoroWork: 25,
    pomodoroBreak: 5,
    theme: 'dark',
    textSize: 100,
    lineHeight: 1.6,
    highlightLegend: d.highlightLegend,
    structureTemplate: d.structureTemplate,
    errorTags: d.errorTags,
    baonEnabled: true,
    allowPasteInExam: false,
    lastExportAt: null,
    examDayChecklist: [
      'Laptop charged, charger packed',
      'Admission slip and valid ID',
      'Water and snacks',
      'Leave early for the testing center',
    ],
    cramReschedules: false,
    aiNotesEnabled: false,
    aiMonthlyCap: 50,
    pomodoro: false,
    coverageHistory: [],
  };
}

// Seed rows carry an old timestamp so any real edit, from any device, wins
// last-write-wins against a fresh seed made offline on another device.
const SEED_TIME = '2026-01-01T00:00:00.000Z';
const seedStamp = { created_at: SEED_TIME, updated_at: SEED_TIME };
const KEEP = { keepTimestamps: true };

export const settingsId = () => stableId(getUserId(), 'settings');

/**
 * Creates the exam config, the six subjects and the settings row for the
 * current user if they don't exist yet. Ids are derived from the user id so
 * two devices seeding offline produce the same rows.
 */
export async function ensureSeed(): Promise<void> {
  const uid = getUserId();
  const examId = await stableId(uid, 'exam_config', seed.examConfig.name);
  const sid = await settingsId();

  if (!(await db.exam_configs.get(examId))) {
    const e = seed.examConfig;
    const row = makeRow('exam_configs', {
      id: examId,
      name: e.name,
      day1: e.day1,
      day2: e.day2,
      day3: e.day3,
      am_start: e.amStart,
      am_end: e.amEnd,
      pm_start: e.pmStart,
      pm_end: e.pmEnd,
      questions_per_subject: e.questionsPerSubject,
      points_per_question: e.pointsPerQuestion,
      coverage_cutoff: e.coverageCutoff,
      passing_gwa: e.passingGwa,
      is_active: true,
      ...seedStamp,
    } as Partial<ExamConfig> as never);
    await putRows('exam_configs', [row], KEEP);
  }

  const subjects: Subject[] = [];
  for (const [i, s] of seed.subjects.entries()) {
    const id = await stableId(uid, 'subject', s.code);
    if (await db.subjects.get(id)) continue;
    subjects.push(
      makeRow('subjects', {
        id,
        code: s.code,
        name: s.name,
        weight: s.weight,
        exam_day: s.examDay,
        session: s.session as Subject['session'],
        color: s.color,
        difficulty: 'normal',
        sort: i,
        ...seedStamp,
      } as never),
    );
  }
  await putRows('subjects', subjects, KEEP);

  if (!(await db.settings.get(sid))) {
    await putRows(
      'settings',
      [makeRow('settings', { id: sid, data: defaultSettings(), ...seedStamp } as never) as SettingsRow],
      KEEP,
    );
  }
  void installBank();
}
