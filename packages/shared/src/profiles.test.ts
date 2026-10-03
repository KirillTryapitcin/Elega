import { describe, expect, it } from 'vitest';
import {
  ALWAYS_VISIBLE_PARTS,
  audienceAllows,
  canViewProfileHeader,
  consentScopeFor,
  defaultAudience,
  effectiveAudience,
  effectiveAudiences,
  FIELD_AUDIENCES,
  normalizeProfileUrl,
  PROFILE_FIELDS,
  PROFILE_TEXT_LIMITS,
  profileCompleteness,
  publicFields,
  scopeNotCovered,
  visibleFields,
  type FieldAudience,
  type ProfileOwnerFacts,
  type ViewerRelation,
} from './profiles.js';

const RELATIONS: ViewerRelation[] = [
  'self',
  'friend',
  'fof',
  'follower',
  'stranger',
  'blocked',
  'anon',
];

// Written out by hand from brief §9.2 and the matrix, independent of the implementation.
const EXPECTED: Record<FieldAudience, Record<ViewerRelation, boolean>> = {
  public: {
    self: true,
    friend: true,
    fof: true,
    follower: true,
    stranger: true,
    blocked: false,
    anon: true,
  },
  friends: {
    self: true,
    friend: true,
    fof: false,
    follower: false,
    stranger: false,
    blocked: false,
    anon: false,
  },
  friends_of_friends: {
    self: true,
    friend: true,
    fof: true,
    follower: false,
    stranger: false,
    blocked: false,
    anon: false,
  },
  only_me: {
    self: true,
    friend: false,
    fof: false,
    follower: false,
    stranger: false,
    blocked: false,
    anon: false,
  },
  custom_list: {
    self: true,
    friend: false,
    fof: false,
    follower: false,
    stranger: false,
    blocked: false,
    anon: false,
  },
};

const ADULT: ProfileOwnerFacts = { isMinor: false, active: true, anonVisible: false };
const ADULT_PUBLIC: ProfileOwnerFacts = { isMinor: false, active: true, anonVisible: true };
const MINOR: ProfileOwnerFacts = { isMinor: true, active: true, anonVisible: false };
const INACTIVE: ProfileOwnerFacts = { isMinor: false, active: false, anonVisible: true };

describe('audienceAllows', () => {
  for (const audience of FIELD_AUDIENCES) {
    for (const relation of RELATIONS) {
      it(`${audience} × ${relation} → ${EXPECTED[audience][relation]}`, () => {
        expect(audienceAllows(audience, relation)).toBe(EXPECTED[audience][relation]);
      });
    }
  }
});

describe('effectiveAudience', () => {
  it('falls back to the field default for missing, unknown and unsupported values', () => {
    expect(effectiveAudience({}, 'city', false)).toBe('friends');
    expect(effectiveAudience({ city: 'everyone' }, 'city', false)).toBe('friends');
    expect(effectiveAudience({ city: 42 }, 'city', false)).toBe('friends');
    expect(effectiveAudience({ city: 'custom_list' }, 'city', false)).toBe('friends');
    expect(effectiveAudience(null, 'city', false)).toBe('friends');
    expect(effectiveAudience('public', 'city', false)).toBe('friends');
    expect(effectiveAudience([], 'city', false)).toBe('friends');
  });

  it('uses the stricter default for the birth year', () => {
    expect(defaultAudience('birthYear')).toBe('only_me');
    expect(defaultAudience('bio')).toBe('friends');
    expect(effectiveAudience({}, 'birthYear', false)).toBe('only_me');
    expect(effectiveAudience({ birthYear: 'public' }, 'birthYear', false)).toBe('public');
  });

  it('keeps supported values for adults', () => {
    for (const audience of ['public', 'friends', 'friends_of_friends', 'only_me'] as const) {
      expect(effectiveAudience({ bio: audience }, 'bio', false)).toBe(audience);
    }
  });

  it('clamps a minor to friends at most', () => {
    expect(effectiveAudience({ bio: 'public' }, 'bio', true)).toBe('friends');
    expect(effectiveAudience({ bio: 'friends_of_friends' }, 'bio', true)).toBe('friends');
    expect(effectiveAudience({ bio: 'friends' }, 'bio', true)).toBe('friends');
    expect(effectiveAudience({ bio: 'only_me' }, 'bio', true)).toBe('only_me');
    expect(effectiveAudience({}, 'birthYear', true)).toBe('only_me');
  });

  it('ignores inherited keys', () => {
    const stored = Object.create({ city: 'public' }) as object;
    expect(effectiveAudience(stored, 'city', false)).toBe('friends');
  });

  it('returns an audience for every field', () => {
    const all = effectiveAudiences({ bio: 'public' }, false);
    expect(Object.keys(all)).toEqual([...PROFILE_FIELDS]);
    expect(all.bio).toBe('public');
    expect(all.birthYear).toBe('only_me');
    expect(all.photos).toBe('friends');
  });
});

describe('canViewProfileHeader', () => {
  const cases: [ViewerRelation, ProfileOwnerFacts, boolean][] = [
    ['self', ADULT, true],
    ['self', INACTIVE, true],
    ['self', MINOR, true],
    ['friend', ADULT, true],
    ['fof', ADULT, true],
    ['follower', ADULT, true],
    ['stranger', ADULT, true],
    ['blocked', ADULT, false],
    ['anon', ADULT, false],
    ['anon', ADULT_PUBLIC, true],
    ['friend', INACTIVE, false],
    ['stranger', INACTIVE, false],
    ['anon', INACTIVE, false],
    ['friend', MINOR, true],
    ['fof', MINOR, false],
    ['follower', MINOR, false],
    ['stranger', MINOR, false],
    ['blocked', MINOR, false],
    ['anon', MINOR, false],
    ['anon', { isMinor: true, active: true, anonVisible: true }, false],
  ];
  for (const [relation, owner, expected] of cases) {
    it(`${relation} on ${JSON.stringify(owner)} → ${expected}`, () => {
      expect(canViewProfileHeader(relation, owner)).toBe(expected);
    });
  }
});

describe('visibleFields', () => {
  const stored = {
    bio: 'public',
    city: 'friends',
    workplace: 'friends_of_friends',
    photos: 'public',
  };

  it('shows the owner everything', () => {
    expect(visibleFields('self', ADULT, stored)).toEqual([...PROFILE_FIELDS]);
  });

  it('filters by audience for members', () => {
    expect(visibleFields('stranger', ADULT, stored)).toEqual(['bio', 'photos']);
    expect(visibleFields('fof', ADULT, stored)).toEqual(['bio', 'workplace', 'photos']);
    expect(visibleFields('friend', ADULT, stored)).toEqual(
      PROFILE_FIELDS.filter((field) => field !== 'birthYear'),
    );
  });

  it('never shows the avatar history to anonymous visitors', () => {
    expect(visibleFields('anon', ADULT_PUBLIC, stored)).toEqual(['bio']);
  });

  it('shows nothing when the header is hidden', () => {
    expect(visibleFields('anon', ADULT, stored)).toEqual([]);
    expect(visibleFields('blocked', ADULT, stored)).toEqual([]);
    expect(visibleFields('stranger', MINOR, stored)).toEqual([]);
  });

  it("shows a minor's friends at most friends-level fields", () => {
    expect(visibleFields('friend', MINOR, { bio: 'public', city: 'only_me' })).toEqual(
      PROFILE_FIELDS.filter((field) => field !== 'city' && field !== 'birthYear'),
    );
  });
});

describe('consent scope', () => {
  it('lists public fields and the always-visible header', () => {
    const stored = { bio: 'public', city: 'friends', website: 'public' };
    expect(publicFields(stored, false)).toEqual(['bio', 'website']);
    expect(publicFields(stored, true)).toEqual([]);
    expect(consentScopeFor(stored, false)).toEqual([...ALWAYS_VISIBLE_PARTS, 'bio', 'website']);
  });

  it('reports what a granted scope does not cover', () => {
    expect(scopeNotCovered(['name', 'bio', 'city'], ['name', 'bio'])).toEqual(['city']);
    expect(scopeNotCovered(['name'], ['name', 'bio'])).toEqual([]);
  });
});

describe('profileCompleteness', () => {
  const empty = { hasAvatar: false, bio: null, city: null, workplace: null, education: null };

  it('needs an avatar and two text fields', () => {
    expect(profileCompleteness(empty)).toEqual({
      complete: false,
      missing: ['avatar', 'bio', 'city', 'workplace', 'education'],
    });
    expect(profileCompleteness({ ...empty, hasAvatar: true, bio: 'Hi', city: 'Kazan' })).toEqual({
      complete: true,
      missing: ['workplace', 'education'],
    });
    expect(profileCompleteness({ ...empty, hasAvatar: true, bio: 'Hi' }).complete).toBe(false);
    expect(profileCompleteness({ ...empty, bio: 'Hi', city: 'Kazan' }).complete).toBe(false);
  });

  it('treats whitespace as empty', () => {
    expect(
      profileCompleteness({ ...empty, hasAvatar: true, bio: '  ', city: 'Kazan' }).complete,
    ).toBe(false);
  });
});

describe('normalizeProfileUrl', () => {
  const ok: [string, string, string][] = [
    ['example.com', 'https://example.com/', 'example.com'],
    ['  https://Example.com/a?b=1  ', 'https://example.com/a?b=1', 'example.com'],
    ['http://example.com', 'http://example.com/', 'example.com'],
    ['example.com:8080/path', 'https://example.com:8080/path', 'example.com'],
    ['www.example.com.', 'https://www.example.com./', 'www.example.com'],
    ['пример.рф', 'https://xn--e1afmkfd.xn--p1ai/', 'xn--e1afmkfd.xn--p1ai'],
  ];
  for (const [input, url, host] of ok) {
    it(`accepts ${input}`, () => {
      expect(normalizeProfileUrl(input)).toEqual({ ok: true, url, host });
    });
  }

  const bad: [string, string][] = [
    ['', 'invalid'],
    ['   ', 'invalid'],
    ['javascript:alert(1)', 'scheme'],
    ['data:text/html,hi', 'scheme'],
    ['ftp://example.com', 'scheme'],
    ['mailto:a@example.com', 'scheme'],
    ['https://user:pass@example.com', 'credentials'],
    ['https://user@example.com', 'credentials'],
    ['https://localhost', 'host'],
    ['https://app.localhost', 'host'],
    ['https://intranet', 'host'],
    ['https://127.0.0.1', 'host'],
    ['http://0x7f.1', 'host'],
    ['https://[::1]', 'host'],
    ['https://exa mple.com', 'invalid'],
    [`https://example.com/${'a'.repeat(PROFILE_TEXT_LIMITS.url)}`, 'too_long'],
    // Short enough as typed, too long once spaces are percent-encoded.
    [`example.com/${'a b'.repeat(600)}`, 'too_long'],
  ];
  for (const [input, reason] of bad) {
    it(`rejects ${input.slice(0, 40)} as ${reason}`, () => {
      expect(normalizeProfileUrl(input)).toEqual({ ok: false, reason });
    });
  }
});
