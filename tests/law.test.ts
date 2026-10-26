import { describe, expect, it } from 'vitest';
import { joinProvisions, splitLaw, stripWhitespace } from '../src/lib/parsers/law';

const NCC = `REPUBLIC ACT NO. 386
AN ACT TO ORDAIN AND INSTITUTE THE CIVIL CODE OF THE PHILIPPINES

BOOK IV
OBLIGATIONS AND CONTRACTS
TITLE I. - OBLIGATIONS
CHAPTER 1
GENERAL PROVISIONS

Article 1156. An obligation is a juridical necessity to give, to do or not to do. (n)

Article 1157. Obligations arise from:
(1) Law;
(2) Contracts;
(3) Quasi-contracts;
(4) Acts or omissions punished by law; and
(5) Quasi-delicts. (1089a)

Art. 1158. Obligations derived from law are not presumed. Only those expressly determined in this Code
or in special laws are demandable, and shall be regulated by the precepts of the law which establishes them;
and as to what has not been foreseen, by the provisions of this Book. (1090)
Art. 1159. Obligations arising from contracts have the force of law between the contracting parties and should be complied with in good faith. (1091a)`;

const CONST = `THE 1987 CONSTITUTION OF THE REPUBLIC OF THE PHILIPPINES
PREAMBLE
We, the sovereign Filipino people, imploring the aid of Almighty God...

ARTICLE III
BILL OF RIGHTS
Section 1. No person shall be deprived of life, liberty, or property without due process of law, nor shall any person be denied the equal protection of the laws.
Section 2. The right of the people to be secure in their persons, houses, papers, and effects against unreasonable searches and seizures...

ARTICLE IV
CITIZENSHIP
Section 1. The following are citizens of the Philippines:`;

const ROC = `RULE 70
Forcible Entry and Unlawful Detainer
Section 1. Who may institute proceedings, and when. — Subject to the provisions of the next succeeding section, a person deprived of the possession
Rule 3 of these Rules applies only by reference here and must not start a heading.
Section 2. Lessor to proceed against lessee only after demand.`;

describe('splitLaw', () => {
  it('splits the Civil Code at Article / Art. headings', () => {
    const ps = splitLaw(NCC);
    expect(ps.map((p) => p.label)).toEqual(['Preamble', 'Art. 1156', 'Art. 1157', 'Art. 1158', 'Art. 1159']);
    expect(ps[1].heading).toContain('BOOK IV');
    expect(ps[1].heading).toContain('GENERAL PROVISIONS');
    expect(ps[2].text).toContain('(5) Quasi-delicts.');
    expect(ps[3].text).toContain('provisions of this Book. (1090)');
  });

  it('prefixes labels with the larger heading', () => {
    expect(splitLaw(CONST).map((p) => p.label)).toEqual([
      'Preamble',
      'Art. III, Sec. 1',
      'Art. III, Sec. 2',
      'Art. IV, Sec. 1',
    ]);
    const roc = splitLaw(ROC);
    expect(roc.map((p) => p.label)).toEqual(['Rule 70, Sec. 1', 'Rule 70, Sec. 2']);
    expect(roc[0].text).toContain('Rule 3 of these Rules');
  });

  it('never loses text', () => {
    for (const t of [NCC, CONST, ROC]) {
      expect(stripWhitespace(joinProvisions(splitLaw(t)))).toBe(stripWhitespace(t));
    }
  });
});
