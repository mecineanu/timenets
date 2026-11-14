import type { Sex } from '../model/genealogy';

export const sexColor = (s: Sex) => (s === 'Male' ? 'var(--male)' : s === 'Female' ? 'var(--female)' : 'var(--nosex)');
