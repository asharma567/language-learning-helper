export const ENTRIES_PER_LESSON = 7;

export const lessonForSeq = (seq: number): number =>
  Math.ceil(seq / ENTRIES_PER_LESSON);
