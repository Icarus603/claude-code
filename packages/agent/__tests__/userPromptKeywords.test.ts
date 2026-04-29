import { describe, expect, test } from 'bun:test'
import {
  matchesKeepGoingKeyword,
  matchesNegativeKeyword,
} from '../userPromptKeywords/userPromptKeywords.js'

describe('matchesNegativeKeyword — direct profanity / frustration', () => {
  test('matches "wtf"', () => {
    expect(matchesNegativeKeyword('wtf is happening')).toBe(true)
  })
  test('matches "wth"', () => {
    expect(matchesNegativeKeyword('wth is going on')).toBe(true)
  })
  test('matches "ffs"', () => {
    expect(matchesNegativeKeyword('come on ffs')).toBe(true)
  })
  test('matches "shit"', () => {
    expect(matchesNegativeKeyword('this is shit')).toBe(true)
  })
  test('matches "shitty"', () => {
    expect(matchesNegativeKeyword('shitty result')).toBe(true)
  })
  test('matches "shittiest"', () => {
    expect(matchesNegativeKeyword('the shittiest thing')).toBe(true)
  })
  test('matches "horrible"', () => {
    expect(matchesNegativeKeyword('this is horrible')).toBe(true)
  })
  test('matches "awful"', () => {
    expect(matchesNegativeKeyword('awful design')).toBe(true)
  })
})

describe('matchesNegativeKeyword — phrasal patterns', () => {
  test('matches "what the fuck"', () => {
    expect(matchesNegativeKeyword('what the fuck is this')).toBe(true)
  })
  test('matches "what the hell"', () => {
    expect(matchesNegativeKeyword('what the hell happened')).toBe(true)
  })
  test('matches "fucking broken"', () => {
    expect(matchesNegativeKeyword('this is fucking broken')).toBe(true)
  })
  test('matches "fucking useless"', () => {
    expect(matchesNegativeKeyword('completely fucking useless')).toBe(true)
  })
  test('matches "fuck you"', () => {
    expect(matchesNegativeKeyword('fuck you bot')).toBe(true)
  })
  test('matches "screw this"', () => {
    expect(matchesNegativeKeyword('screw this nonsense')).toBe(true)
  })
  test('matches "screw you"', () => {
    expect(matchesNegativeKeyword('screw you')).toBe(true)
  })
  test('matches "this sucks"', () => {
    expect(matchesNegativeKeyword('this sucks badly')).toBe(true)
  })
  test('matches "so frustrating"', () => {
    expect(matchesNegativeKeyword('so frustrating to deal with')).toBe(true)
  })
  test('matches "damn it"', () => {
    expect(matchesNegativeKeyword('damn it')).toBe(true)
  })
  test('matches "piece of shit"', () => {
    expect(matchesNegativeKeyword('this piece of shit')).toBe(true)
  })
  test('matches "piece of crap"', () => {
    expect(matchesNegativeKeyword('what a piece of crap')).toBe(true)
  })
  test('matches "pissed off"', () => {
    expect(matchesNegativeKeyword('I am pissed off')).toBe(true)
  })
})

describe('matchesNegativeKeyword — case insensitivity', () => {
  test('uppercase WTF matches', () => {
    expect(matchesNegativeKeyword('WTF')).toBe(true)
  })
  test('mixed-case "What The Fuck" matches', () => {
    expect(matchesNegativeKeyword('What The Fuck')).toBe(true)
  })
})

describe('matchesNegativeKeyword — non-matches', () => {
  test('plain prose returns false', () => {
    expect(matchesNegativeKeyword('please help me with this')).toBe(false)
  })
  test('empty string returns false', () => {
    expect(matchesNegativeKeyword('')).toBe(false)
  })
  test('non-frustration "shit" mentions are matched per the regex (no semantic check)', () => {
    // Contract: this is a *keyword* matcher, not a semantic classifier.
    // It WILL match phrases like "give a shit" — but we lock in a few
    // edge cases to document its breadth.
    expect(matchesNegativeKeyword('I do not give a shit')).toBe(true)
  })
  test('mid-word substrings do NOT match (\\b boundary)', () => {
    // "shitlock" or "wthings" should not match because \b requires
    // word-boundary on both sides.
    expect(matchesNegativeKeyword('mythits is a word')).toBe(false)
    expect(matchesNegativeKeyword('wthings happen')).toBe(false)
  })
})

describe('matchesKeepGoingKeyword — exact "continue"', () => {
  test('"continue" alone matches', () => {
    expect(matchesKeepGoingKeyword('continue')).toBe(true)
  })
  test('case-insensitive: "CONTINUE" matches', () => {
    expect(matchesKeepGoingKeyword('CONTINUE')).toBe(true)
  })
  test('with surrounding whitespace, "continue" matches (trim is applied)', () => {
    expect(matchesKeepGoingKeyword('  continue  ')).toBe(true)
  })
  test('"continue with..." does NOT match (must be alone)', () => {
    expect(matchesKeepGoingKeyword('continue with the task')).toBe(false)
  })
  test('"please continue" does NOT match (must be alone, not embedded)', () => {
    expect(matchesKeepGoingKeyword('please continue')).toBe(false)
  })
})

describe('matchesKeepGoingKeyword — "keep going" / "go on"', () => {
  test('"keep going" anywhere in text matches', () => {
    expect(matchesKeepGoingKeyword('please keep going')).toBe(true)
  })
  test('"go on" anywhere in text matches', () => {
    expect(matchesKeepGoingKeyword('please go on')).toBe(true)
  })
  test('with surrounding text matches (substring contract)', () => {
    expect(matchesKeepGoingKeyword('yes, keep going with that')).toBe(true)
  })
  test('case-insensitive: "GO ON" matches', () => {
    expect(matchesKeepGoingKeyword('GO ON')).toBe(true)
  })
})

describe('matchesKeepGoingKeyword — non-matches', () => {
  test('plain prose without keywords returns false', () => {
    expect(matchesKeepGoingKeyword('I have a question')).toBe(false)
  })
  test('empty string returns false', () => {
    expect(matchesKeepGoingKeyword('')).toBe(false)
  })
  test('"going to" does NOT match (different phrase)', () => {
    expect(matchesKeepGoingKeyword('I am going to do this')).toBe(false)
  })
  test('"keep doing" does NOT match', () => {
    expect(matchesKeepGoingKeyword('keep doing it')).toBe(false)
  })
})
